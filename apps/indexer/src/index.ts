import "dotenv/config";
import Redis from "ioredis";
import { parseAbiItem, type Address, type Hex, type Log } from "viem";
import { eq } from "drizzle-orm";
import { zeroAddress } from "viem";
import { createDb, tokens } from "@terminal/db";
import { loadChainConfigsFromEnv, type ChainConfig } from "@terminal/adapters";
import { clientFor } from "./config.js";
import { EventHandlers } from "./handlers.js";
import { rescoreRecentTokens } from "./bundle.js";
import { loadCursor, saveCursor } from "./cursor.js";
import { enrichMissingTokenMeta } from "./meta.js";

const evCoinCreated = parseAbiItem(
  "event CoinCreated(address indexed creator, address indexed token, address curve, string name, string symbol, string logoURI, address pairAsset, uint16 buyTaxBps, uint16 sellTaxBps, uint16 divShareBps, uint16 buybackShareBps, uint16 lpShareBps, uint256 minHold, bool antiSnipe, bool antiBundle, bool loyaltyVest, address feeReceiver)",
);
const evBuy = parseAbiItem("event Buy(address indexed buyer, uint256 ethIn, uint256 quoteIn, uint256 tokensOut)");
const evSell = parseAbiItem("event Sell(address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 ethOut)");
const evGraduated = parseAbiItem(
  "event Graduated(bytes32 indexed poolId, uint256 quoteForLp, uint256 tokenForLp, uint256 dividendLeftoverQ, uint256 burnedTokens)",
);
const evSwap = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
const evModifyLiq = parseAbiItem(
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
);

const BATCH = 15_000n;
const ADDR_CHUNK = 80;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function logOrder(a: Log, b: Log): number {
  const ab = a.blockNumber ?? 0n;
  const bb = b.blockNumber ?? 0n;
  if (ab !== bb) return ab < bb ? -1 : 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

function errText(e: unknown): string {
  return `${(e as { details?: string })?.details ?? ""} ${(e as Error)?.message ?? ""}`;
}

/** 429 重试;日志条数超 RPC 上限时对区块区间对半拆 */
type GetLogsArgs = NonNullable<Parameters<ReturnType<typeof clientFor>["getLogs"]>[0]>;

async function getLogsWithRetry(
  client: ReturnType<typeof clientFor>,
  args: GetLogsArgs,
  tries = 10,
): Promise<Log[]> {
  for (let i = 0; ; i++) {
    try {
      return await client.getLogs(args) as Log[];
    } catch (e: unknown) {
      const text = errText(e);
      if (text.includes("exceeds limit") && args.fromBlock != null && args.toBlock != null) {
        const from = BigInt(args.fromBlock as bigint);
        const to = BigInt(args.toBlock as bigint);
        if (to > from) {
          const mid = from + (to - from) / 2n;
          const [left, right] = await Promise.all([
            getLogsWithRetry(client, { ...args, fromBlock: from, toBlock: mid } as GetLogsArgs, tries),
            getLogsWithRetry(client, { ...args, fromBlock: mid + 1n, toBlock: to } as GetLogsArgs, tries),
          ]);
          return [...left, ...right];
        }
      }
      const is429 = (e as { code?: number })?.code === 429 || text.includes("Too Many Requests");
      if (!is429 || i >= tries) throw e;
      const wait = Math.min(2000 * 2 ** i, 60_000);
      console.log(`  rate limited, retry in ${wait / 1000}s ...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function curveFromCreated(log: Log): Address | null {
  const curve = (log as Log & { args?: { curve?: Address } }).args?.curve;
  return curve ? (curve.toLowerCase() as Address) : null;
}

function poolFromGrad(log: Log): Hex | null {
  const id = (log as Log & { args?: { poolId?: string } }).args?.poolId;
  return id ? (id.toLowerCase() as Hex) : null;
}

function serialQueue(onErr: (e: unknown) => void) {
  let tail = Promise.resolve();
  return (fn: () => Promise<void>) => {
    tail = tail.then(fn).catch(onErr);
  };
}

async function runChain(cfg: ChainConfig, db: ReturnType<typeof createDb>, redis: Redis) {
  const client = clientFor(cfg);
  const publish = (ch: string, payload: unknown) => void redis.publish(ch, JSON.stringify(payload));
  const h = new EventHandlers(db, client, cfg, publish);
  const onErr = (e: unknown) => console.error(e);

  const tokenRows = await db
    .select({ curveAddress: tokens.curveAddress, poolId: tokens.poolId })
    .from(tokens)
    .where(eq(tokens.chainId, cfg.chainId));
  const curveSet = new Set<Address>(tokenRows.map((r) => r.curveAddress.toLowerCase() as Address));
  const poolSet = new Set<Hex>(
    tokenRows.map((r) => r.poolId).filter((id): id is string => Boolean(id)).map((id) => id.toLowerCase() as Hex),
  );

  const stored = await loadCursor(db, cfg.chainId);
  let from = stored != null ? stored + 1n : cfg.deployBlock;
  let head = await client.getBlockNumber();
  console.log(`[chain ${cfg.chainId}] backfilling ${from} → ${head} (cursor=${stored ?? "none"})`);

  async function fetchCurveLogs(fromBlock: bigint, toBlock: bigint, curves: Address[]) {
    const buys: Log[] = [];
    const sells: Log[] = [];
    const grads: Log[] = [];
    if (curves.length === 0) return { buys, sells, grads };
    for (const addrs of chunk(curves, ADDR_CHUNK)) {
      const [b, s, g] = await Promise.all([
        getLogsWithRetry(client, { address: addrs, event: evBuy, fromBlock, toBlock }),
        getLogsWithRetry(client, { address: addrs, event: evSell, fromBlock, toBlock }),
        getLogsWithRetry(client, { address: addrs, event: evGraduated, fromBlock, toBlock }),
      ]);
      buys.push(...b);
      sells.push(...s);
      grads.push(...g);
    }
    return { buys, sells, grads };
  }

  async function fetchPoolLogs(fromBlock: bigint, toBlock: bigint, poolIds: Hex[]) {
    const swaps: Log[] = [];
    const liqs: Log[] = [];
    if (poolIds.length === 0) return { swaps, liqs };
    for (const ids of chunk(poolIds, ADDR_CHUNK)) {
      const [s, m] = await Promise.all([
        getLogsWithRetry(client, {
          address: cfg.poolManager, event: evSwap, args: { id: ids }, fromBlock, toBlock,
        }),
        getLogsWithRetry(client, {
          address: cfg.poolManager, event: evModifyLiq, args: { id: ids }, fromBlock, toBlock,
        }),
      ]);
      swaps.push(...s);
      liqs.push(...m);
    }
    return { swaps, liqs };
  }

  async function processRange(fromBlock: bigint, toBlock: bigint) {
    const created = await getLogsWithRetry(client, {
      address: cfg.factory, event: evCoinCreated, fromBlock, toBlock,
    });
    created.sort(logOrder);
    await h.prefetchBlockTimes(created.map((l) => l.blockNumber));
    for (const log of created) {
      await h.onCoinCreated(log as never);
      const curve = curveFromCreated(log);
      if (curve) curveSet.add(curve);
    }

    const curves = [...curveSet];
    const knownPools = [...poolSet];
    const [{ buys, sells, grads }, poolKnown] = await Promise.all([
      fetchCurveLogs(fromBlock, toBlock, curves),
      fetchPoolLogs(fromBlock, toBlock, knownPools),
    ]);

    const extraPools = grads
      .map(poolFromGrad)
      .filter((id): id is Hex => id != null)
      .filter((id) => !poolSet.has(id));
    for (const id of extraPools) poolSet.add(id);
    const poolExtra = extraPools.length > 0 ? await fetchPoolLogs(fromBlock, toBlock, extraPools) : { swaps: [], liqs: [] };
    const swaps = [...poolKnown.swaps, ...poolExtra.swaps];
    const liqs = [...poolKnown.liqs, ...poolExtra.liqs];

    const rest: Array<{ kind: "buy" | "sell" | "grad" | "swap" | "liq"; log: Log }> = [
      ...buys.map((log) => ({ kind: "buy" as const, log })),
      ...sells.map((log) => ({ kind: "sell" as const, log })),
      ...grads.map((log) => ({ kind: "grad" as const, log })),
      ...swaps.map((log) => ({ kind: "swap" as const, log })),
      ...liqs.map((log) => ({ kind: "liq" as const, log })),
    ];
    rest.sort((a, b) => logOrder(a.log, b.log));
    await h.prefetchBlockTimes(rest.map((e) => e.log.blockNumber));
    for (const e of rest) {
      if (e.kind === "buy") await h.onCurveTrade(e.log as never, true);
      else if (e.kind === "sell") await h.onCurveTrade(e.log as never, false);
      else if (e.kind === "grad") {
        const poolId = await h.onGraduated(e.log as never);
        if (poolId) poolSet.add(poolId.toLowerCase() as Hex);
      } else if (e.kind === "liq") await h.onModifyLiquidity(e.log as never);
      else await h.onPoolSwap(e.log as never);
    }
  }

  while (from <= head) {
    const to = from + BATCH - 1n > head ? head : from + BATCH - 1n;
    await processRange(from, to);
    await saveCursor(db, cfg.chainId, to);
    if (from % (BATCH * 20n) === 0n) console.log(`[chain ${cfg.chainId}] backfill ${to}/${head}`);
    from = to + 1n;
    if (from <= head) continue;
    // 追上头部后再看是否有新块;回填过程中不 sleep
    head = await client.getBlockNumber();
  }
  console.log(`[chain ${cfg.chainId}] backfill done, starting live watchers from ${head}`);

  const qPools = (await db
    .select({
      address: tokens.address,
      poolId: tokens.poolId,
      quoteAsset: tokens.quoteAsset,
      createdAtBlock: tokens.createdAtBlock,
    })
    .from(tokens)
    .where(eq(tokens.chainId, cfg.chainId)))
    .filter((r) => r.poolId && r.quoteAsset && r.quoteAsset.toLowerCase() !== zeroAddress);
  if (qPools.length > 0) {
    console.log(`[chain ${cfg.chainId}] backfilling Q-pool swaps for ${qPools.length} graduated tokens`);
    for (const t of qPools) {
      let pf = t.createdAtBlock ?? cfg.deployBlock;
      if (pf > head) continue;
      while (pf <= head) {
        const pt = pf + BATCH - 1n > head ? head : pf + BATCH - 1n;
        const logs = await getLogsWithRetry(client, {
          address: cfg.poolManager,
          event: evSwap,
          args: { id: t.poolId as Hex },
          fromBlock: pf,
          toBlock: pt,
        } as GetLogsArgs);
        logs.sort(logOrder);
        if (logs.length > 0) {
          console.log(`[chain ${cfg.chainId}] Q-pool ${t.address.slice(0, 10)} ${logs.length} swaps blocks ${pf}-${pt}`);
        }
        await h.prefetchBlockTimes(logs.map((l) => l.blockNumber));
        for (const l of logs) await h.onPoolSwap(l as never);
        pf = pt + 1n;
      }
    }
    console.log(`[chain ${cfg.chainId}] Q-pool swap backfill done`);
  }
  await h.refreshGraduatedSpotPrices();
  console.log(`[chain ${cfg.chainId}] graduated spot prices refreshed`);

  const enqueue = serialQueue(onErr);

  async function handleLive(logs: Log[], kind: "created" | "buy" | "sell" | "grad" | "swap" | "liq") {
    const sorted = [...logs].sort(logOrder);
    await h.prefetchBlockTimes(sorted.map((l) => l.blockNumber));
    for (const l of sorted) {
      if (kind === "created") {
        await h.onCoinCreated(l as never);
        const curve = curveFromCreated(l);
        if (curve) curveSet.add(curve);
      } else if (kind === "buy") await h.onCurveTrade(l as never, true);
      else if (kind === "sell") await h.onCurveTrade(l as never, false);
      else if (kind === "grad") {
        const poolId = await h.onGraduated(l as never);
        if (poolId) poolSet.add(poolId.toLowerCase() as Hex);
      } else if (kind === "liq") await h.onModifyLiquidity(l as never);
      else await h.onPoolSwap(l as never);
    }
  }

  client.watchEvent({
    address: cfg.factory,
    event: evCoinCreated,
    fromBlock: head,
    onLogs: (logs) => enqueue(() => handleLive(logs, "created")),
  });
  client.watchEvent({
    event: evBuy,
    fromBlock: head,
    onLogs: (logs) => enqueue(() => handleLive(logs, "buy")),
  });
  client.watchEvent({
    event: evSell,
    fromBlock: head,
    onLogs: (logs) => enqueue(() => handleLive(logs, "sell")),
  });
  client.watchEvent({
    event: evGraduated,
    fromBlock: head,
    onLogs: (logs) => enqueue(() => handleLive(logs, "grad")),
  });
  client.watchEvent({
    address: cfg.poolManager,
    event: evSwap,
    fromBlock: head,
    onLogs: (logs) => enqueue(() => handleLive(logs, "swap")),
  });
  client.watchEvent({
    address: cfg.poolManager,
    event: evModifyLiq,
    fromBlock: head,
    onLogs: (logs) => enqueue(() => handleLive(logs, "liq")),
  });

  setInterval(() => rescoreRecentTokens(db, cfg.chainId).catch(onErr), 10 * 60 * 1000);
  void enrichMissingTokenMeta(db, cfg.chainId).catch(onErr);
}

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const redis = new Redis(process.env.REDIS_URL!, { retryStrategy: (n) => Math.min(n * 500, 10_000) });
  redis.on("error", (e) => console.error("[redis]", e.message));
  const chains = loadChainConfigsFromEnv();
  if (chains.length === 0) throw new Error("ENABLED_CHAINS is empty");
  await Promise.all(chains.map((cfg) => runChain(cfg, db, redis)));
  console.log(`indexer running on chains: ${chains.map((c) => c.chainId).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
