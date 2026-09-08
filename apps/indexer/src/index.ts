import "dotenv/config";
import Redis from "ioredis";
import { parseAbiItem, type Address, type Hex, type Log } from "viem";
import { eq } from "drizzle-orm";
import { zeroAddress } from "viem";
import { chainConfigs, createDb, tokens } from "@terminal/db";
import { loadChainConfigsFromEnv, mergePonsConfig, type ChainConfig, type PonsEnv } from "@terminal/adapters";
import { clientFor } from "./config.js";
import { EventHandlers } from "./handlers.js";
import { rescoreRecentTokens } from "./bundle.js";
import { backfillMissingFunders } from "./funding.js";
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
const evTransfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const evPonsLaunched = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
const evPonsBuy = parseAbiItem(
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
);
const evPonsSell = parseAbiItem(
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
);
const evPonsPoolGrad = parseAbiItem(
  "event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)",
);

const BATCH = 80n;
const ADDR_CHUNK = 80;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    const part = await Promise.all(items.slice(i, i + n).map(fn));
    out.push(...part);
  }
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

async function getBlockNumberWithRetry(
  client: ReturnType<typeof clientFor>,
  tries = 10,
): Promise<bigint> {
  for (let i = 0; ; i++) {
    try {
      return await client.getBlockNumber();
    } catch (e: unknown) {
      const text = errText(e);
      const is429 = (e as { code?: number })?.code === 429 || text.includes("Too Many Requests");
      if (!is429 || i >= tries) throw e;
      const wait = Math.min(2000 * 2 ** i, 60_000);
      console.log(`  rate limited (getBlockNumber), retry in ${wait / 1000}s ...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function curveFromCreated(log: Log): Address | null {
  const curve = (log as Log & { args?: { curve?: Address } }).args?.curve;
  return curve ? (curve.toLowerCase() as Address) : null;
}

function tokenFromCreated(log: Log): Address | null {
  const token = (log as Log & { args?: { token?: Address } }).args?.token;
  return token ? (token.toLowerCase() as Address) : null;
}

function poolFromGrad(log: Log): Hex | null {
  const id = (log as Log & { args?: { poolId?: string } }).args?.poolId;
  return id ? (id.toLowerCase() as Hex) : null;
}

async function resolvePons(cfg: ChainConfig, db: ReturnType<typeof createDb>): Promise<PonsEnv | null> {
  try {
    const [row] = await db.select().from(chainConfigs).where(eq(chainConfigs.chainId, cfg.chainId)).limit(1);
    if (row && row.ponsEnabled === false) return null;
    return mergePonsConfig(cfg.chainId, cfg.poolManager, row);
  } catch (e) {
    console.warn(`[chain ${cfg.chainId}] pons DB merge failed, env/defaults:`, (e as Error).message);
    return mergePonsConfig(cfg.chainId, cfg.poolManager);
  }
}

async function runChain(cfg: ChainConfig, db: ReturnType<typeof createDb>, redis: Redis) {
  const client = clientFor(cfg);
  const publish = (ch: string, payload: unknown) => void redis.publish(ch, JSON.stringify(payload));
  const [cfgRow] = await db.select().from(chainConfigs).where(eq(chainConfigs.chainId, cfg.chainId)).limit(1);
  const snowonOn = cfgRow?.enabled !== false && cfgRow?.snowonEnabled !== false;
  const ponsOn = cfgRow?.enabled !== false && cfgRow?.ponsEnabled !== false;
  const ponsEnv = ponsOn ? await resolvePons(cfg, db) : null;
  const h = new EventHandlers(
    db, client, cfg, publish,
    ponsEnv ? { factory: ponsEnv.factory, hook: ponsEnv.hook } : undefined,
  );
  const onErr = (e: unknown) => console.error(e);
  console.log(`[chain ${cfg.chainId}] launchpads snowon=${snowonOn} pons=${!!ponsEnv}`);

  const tokenRows = await db
    .select({
      address: tokens.address,
      curveAddress: tokens.curveAddress,
      poolId: tokens.poolId,
      createdAtBlock: tokens.createdAtBlock,
      platformId: tokens.platformId,
      graduated: tokens.graduated,
    })
    .from(tokens)
    .where(eq(tokens.chainId, cfg.chainId));
  const liveRows = tokenRows.filter((r) => (r.platformId === "pons" ? ponsOn : snowonOn));
  const curveSet = new Set<Address>(
    liveRows.filter((r) => r.platformId !== "pons").map((r) => r.curveAddress.toLowerCase() as Address),
  );
  // 已毕业的 Pons 走 V4 池,live 不必再扫曲线 Buy/Sell(上千条地址会把 RPC 打满 429)
  const ponsCurveSet = new Set<Address>(
    liveRows
      .filter((r) => r.platformId === "pons" && !r.graduated)
      .map((r) => r.curveAddress.toLowerCase() as Address),
  );
  const tokenSet = new Set<Address>(liveRows.map((r) => r.address.toLowerCase() as Address));
  const curveOfToken = new Map<string, Address>(
    tokenRows.map((r) => [r.address.toLowerCase(), r.curveAddress.toLowerCase() as Address]),
  );
  const poolSet = new Set<Hex>(
    liveRows.map((r) => r.poolId).filter((id): id is string => Boolean(id)).map((id) => id.toLowerCase() as Hex),
  );

  const stored = await loadCursor(db, cfg.chainId);
  let from = stored != null ? stored + 1n : cfg.deployBlock;
  let head = await getBlockNumberWithRetry(client);
  const catchUpTo = head;
  console.log(`[chain ${cfg.chainId}] backfilling ${from} → ${catchUpTo} (cursor=${stored ?? "none"} tokens=${tokenRows.length} ponsCurves=${ponsCurveSet.size} pools=${poolSet.size})`);

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

  async function fetchTransferLogs(fromBlock: bigint, toBlock: bigint, addrs: Address[]) {
    const out: Log[] = [];
    if (addrs.length === 0) return out;
    for (const addrsChunk of chunk(addrs, ADDR_CHUNK)) {
      const logs = await getLogsWithRetry(client, {
        address: addrsChunk, event: evTransfer, fromBlock, toBlock,
      });
      out.push(...logs);
    }
    return out;
  }

  async function fetchPonsCurveLogs(fromBlock: bigint, toBlock: bigint, curves: Address[]) {
    const buys: Log[] = [];
    const sells: Log[] = [];
    if (curves.length === 0) return { buys, sells };
    const span = toBlock - fromBlock;
    // 1800 条曲线按地址分片会把 RPC 打满;500 块以内改为按事件拉取,超时则回退分片
    if (curves.length > 200 && span <= 800n) {
      try {
        const [b, s] = await Promise.all([
          getLogsWithRetry(client, { event: evPonsBuy, fromBlock, toBlock }),
          getLogsWithRetry(client, { event: evPonsSell, fromBlock, toBlock }),
        ]);
        const allow = new Set(curves.map((a) => a.toLowerCase()));
        return {
          buys: b.filter((l) => allow.has((l.address ?? "").toLowerCase())),
          sells: s.filter((l) => allow.has((l.address ?? "").toLowerCase())),
        };
      } catch (e) {
        console.warn(`[chain] unfiltered pons logs failed, fallback chunks:`, (e as Error).message?.slice(0, 120));
      }
    }
    const parts = await mapPool(chunk(curves, ADDR_CHUNK), 2, async (addrs) => {
      const [b, s] = await Promise.all([
        getLogsWithRetry(client, { address: addrs, event: evPonsBuy, fromBlock, toBlock }),
        getLogsWithRetry(client, { address: addrs, event: evPonsSell, fromBlock, toBlock }),
      ]);
      return { b, s };
    });
    for (const p of parts) {
      buys.push(...p.b);
      sells.push(...p.s);
    }
    return { buys, sells };
  }

  async function processRange(fromBlock: bigint, toBlock: bigint, opts?: { includeTransfers?: boolean }) {
    console.log(`[chain ${cfg.chainId}] range ${fromBlock}-${toBlock} ponsCurves=${ponsCurveSet.size}`);
    const created = snowonOn
      ? await getLogsWithRetry(client, {
          address: cfg.factory, event: evCoinCreated, fromBlock, toBlock,
        })
      : [];
    created.sort(logOrder);
    await h.prefetchBlockTimes(created.map((l) => l.blockNumber));
    for (const log of created) {
      await h.onCoinCreated(log as never);
      const curve = curveFromCreated(log);
      if (curve) curveSet.add(curve);
      const token = tokenFromCreated(log);
      if (token) tokenSet.add(token);
    }

    let ponsLaunched: Log[] = [];
    let ponsGrads: Log[] = [];
    if (ponsEnv) {
      const [launched, grads] = await Promise.all([
        getLogsWithRetry(client, { address: ponsEnv.factory, event: evPonsLaunched, fromBlock, toBlock }),
        getLogsWithRetry(client, { address: ponsEnv.factory, event: evPonsPoolGrad, fromBlock, toBlock }),
      ]);
      ponsLaunched = launched;
      ponsGrads = grads;
      ponsLaunched.sort(logOrder);
      await h.prefetchBlockTimes(ponsLaunched.map((l) => l.blockNumber));
      for (const group of chunk(ponsLaunched, 4)) {
        const rows = await Promise.all(group.map((log) => h.onPonsLaunched(log as never)));
        for (const row of rows) {
          if (!row) continue;
          ponsCurveSet.add(row.curve);
          tokenSet.add(row.token);
          curveOfToken.set(row.token.toLowerCase(), row.curve);
        }
      }
    }

    const curves = [...curveSet];
    const knownPools = [...poolSet];
    const tokenAddrs = [...tokenSet];
    const includeTransfers = opts?.includeTransfers !== false;
    const [{ buys, sells, grads }, poolKnown, transfers, ponsCurve] = await Promise.all([
      fetchCurveLogs(fromBlock, toBlock, curves),
      fetchPoolLogs(fromBlock, toBlock, knownPools),
      includeTransfers ? fetchTransferLogs(fromBlock, toBlock, tokenAddrs) : Promise.resolve([] as Log[]),
      fetchPonsCurveLogs(fromBlock, toBlock, [...ponsCurveSet]),
    ]);

    const extraPools = grads
      .map(poolFromGrad)
      .filter((id): id is Hex => id != null)
      .filter((id) => !poolSet.has(id));
    for (const id of extraPools) poolSet.add(id);
    const poolExtra = extraPools.length > 0 ? await fetchPoolLogs(fromBlock, toBlock, extraPools) : { swaps: [], liqs: [] };
    const swaps = [...poolKnown.swaps, ...poolExtra.swaps];
    const liqs = [...poolKnown.liqs, ...poolExtra.liqs];

    const rest: Array<{ kind: "buy" | "sell" | "grad" | "swap" | "liq" | "xfer" | "ponsBuy" | "ponsSell" | "ponsPool"; log: Log }> = [
      ...buys.map((log) => ({ kind: "buy" as const, log })),
      ...sells.map((log) => ({ kind: "sell" as const, log })),
      ...grads.map((log) => ({ kind: "grad" as const, log })),
      ...swaps.map((log) => ({ kind: "swap" as const, log })),
      ...liqs.map((log) => ({ kind: "liq" as const, log })),
      ...transfers.map((log) => ({ kind: "xfer" as const, log })),
      ...ponsCurve.buys.map((log) => ({ kind: "ponsBuy" as const, log })),
      ...ponsCurve.sells.map((log) => ({ kind: "ponsSell" as const, log })),
      ...ponsGrads.map((log) => ({ kind: "ponsPool" as const, log })),
    ];
    rest.sort((a, b) => logOrder(a.log, b.log));
    await h.prefetchBlockTimes(rest.map((e) => e.log.blockNumber));
    for (const e of rest) {
      if (e.kind === "xfer") continue;
      if (e.kind === "buy") await h.onCurveTrade(e.log as never, true);
      else if (e.kind === "sell") await h.onCurveTrade(e.log as never, false);
      else if (e.kind === "grad") {
        const poolId = await h.onGraduated(e.log as never);
        if (poolId) poolSet.add(poolId.toLowerCase() as Hex);
      } else if (e.kind === "liq") await h.onModifyLiquidity(e.log as never);
      else if (e.kind === "ponsBuy") await h.onPonsCurveTrade(e.log as never, true);
      else if (e.kind === "ponsSell") await h.onPonsCurveTrade(e.log as never, false);
      else if (e.kind === "ponsPool") {
        const poolId = await h.onPonsPoolGraduated(e.log as never);
        if (poolId) poolSet.add(poolId.toLowerCase() as Hex);
        const tok = (e.log as Log & { args?: { token?: Address } }).args?.token;
        if (tok) {
          const curve = curveOfToken.get(tok.toLowerCase());
          if (curve) ponsCurveSet.delete(curve);
        }
      } else await h.onPoolSwap(e.log as never);
    }
    // 互转放在买卖之后处理,便于跳过同一笔成交里的代币划转,避免持仓双计
    for (const e of rest) {
      if (e.kind === "xfer") await h.onTokenTransfer(e.log as never);
    }
  }

  let batches = 0;
  while (from <= catchUpTo) {
    const to = from + BATCH - 1n > catchUpTo ? catchUpTo : from + BATCH - 1n;
    await processRange(from, to, { includeTransfers: stored == null });
    await saveCursor(db, cfg.chainId, to);
    batches++;
    console.log(`[chain ${cfg.chainId}] backfill ${to}/${catchUpTo}`);
    from = to + 1n;
  }
  head = await getBlockNumberWithRetry(client);
  console.log(`[chain ${cfg.chainId}] backfill done at ${head}`);

  // 实时监听必须立刻挂上,不能等毕业池历史 Swap 回填(可能扫上百万块)。
  // 自研轮询替代 watchEvent:
  // 1) 该 RPC 不支持 eth_newFilter(viem 默认 filter 模式静默收不到事件);
  // 2) watchEvent 轮询命中"日志超 1 万条"会卡死在同一区间,而 processRange
  //    走 getLogsWithRetry 会自动对半拆分,且 Swap 按 poolId 过滤,量小。
  const liveHead = head;
  let liveFrom = liveHead + 1n;
  const gate = { liveBusy: false };
  const LIVE_BATCH = 2_000n;
  async function liveTick() {
    if (gate.liveBusy) return;
    gate.liveBusy = true;
    try {
      const snap = await getBlockNumberWithRetry(client);
      if (snap < liveFrom) return;
      const gap = snap - liveFrom + 1n;
      if (gap > 20n) {
        console.log(`[chain ${cfg.chainId}] live ${liveFrom} → ${snap} (${gap} blocks)`);
      }
      let from = liveFrom;
      while (from <= snap) {
        const to = from + LIVE_BATCH - 1n > snap ? snap : from + LIVE_BATCH - 1n;
        await processRange(from, to, { includeTransfers: false });
        from = to + 1n;
        await saveCursor(db, cfg.chainId, to);
      }
      liveFrom = snap + 1n;
    } catch (e) {
      console.error("[live]", e);
    } finally {
      gate.liveBusy = false;
    }
  }
  setInterval(() => void liveTick(), 2_000);
  void liveTick();
  console.log(`[chain ${cfg.chainId}] live watchers started from ${liveFrom} (pons curves ${ponsCurveSet.size})`);
  if (ponsEnv) console.log(`[chain ${cfg.chainId}] pons v2 factory ${ponsEnv.factory}`);

  const wantHistorical = process.env.INDEXER_HISTORICAL === "1";
  if (!wantHistorical) {
    console.log(`[chain ${cfg.chainId}] skip historical backfill (INDEXER_HISTORICAL=1 to enable)`);
  } else {
    void (async () => {
      if (!ponsEnv || stored == null) return;
      const until: bigint = stored;
      let pf: bigint = ponsEnv.deployBlock;
      if (pf > until) return;
      console.log(`[chain ${cfg.chainId}] backfilling pons v2 ${pf} → ${until}`);
      let n = 0;
      while (pf <= until) {
        while (gate.liveBusy) await new Promise((r) => setTimeout(r, 150));
        const pt: bigint = pf + BATCH - 1n > until ? until : pf + BATCH - 1n;
        const [launched, grads] = await Promise.all([
          getLogsWithRetry(client, { address: ponsEnv.factory, event: evPonsLaunched, fromBlock: pf, toBlock: pt }),
          getLogsWithRetry(client, { address: ponsEnv.factory, event: evPonsPoolGrad, fromBlock: pf, toBlock: pt }),
        ]);
        launched.sort(logOrder);
        await h.prefetchBlockTimes(launched.map((l) => l.blockNumber));
        for (const log of launched) {
          const row = await h.onPonsLaunched(log as never);
          if (row) {
            ponsCurveSet.add(row.curve);
            tokenSet.add(row.token);
            curveOfToken.set(row.token.toLowerCase(), row.curve);
          }
        }
        const curveLogs = await fetchPonsCurveLogs(pf, pt, [...ponsCurveSet]);
        const rest = [
          ...curveLogs.buys.map((log) => ({ kind: "buy" as const, log })),
          ...curveLogs.sells.map((log) => ({ kind: "sell" as const, log })),
          ...grads.map((log) => ({ kind: "grad" as const, log })),
        ];
        rest.sort((a, b) => logOrder(a.log, b.log));
        await h.prefetchBlockTimes(rest.map((e) => e.log.blockNumber));
        for (const e of rest) {
          if (e.kind === "buy") await h.onPonsCurveTrade(e.log as never, true);
          else if (e.kind === "sell") await h.onPonsCurveTrade(e.log as never, false);
          else {
            const poolId = await h.onPonsPoolGraduated(e.log as never);
            if (poolId) poolSet.add(poolId.toLowerCase() as Hex);
          }
        }
        n++;
        if (n % 10 === 0 || pt === until) {
          console.log(`[chain ${cfg.chainId}] pons backfill ${pt}/${until}`);
        }
        pf = pt + 1n;
      }
      console.log(`[chain ${cfg.chainId}] pons v2 backfill done`);
    })().catch(onErr);

    void (async () => {
      if (stored == null || tokenRows.length === 0) return;
      const until: bigint = stored;
      const addrs = [...tokenSet];
      let pf: bigint = tokenRows[0].createdAtBlock;
      for (const t of tokenRows) {
        if (t.createdAtBlock < pf) pf = t.createdAtBlock;
      }
      if (pf > until) return;
      console.log(`[chain ${cfg.chainId}] backfilling transfers ${pf} → ${until} for ${addrs.length} tokens`);
      let n = 0;
      while (pf <= until) {
        while (gate.liveBusy) await new Promise((r) => setTimeout(r, 150));
        const pt: bigint = pf + BATCH - 1n > until ? until : pf + BATCH - 1n;
        const logs = await fetchTransferLogs(pf, pt, addrs);
        logs.sort(logOrder);
        if (logs.length > 0) {
          await h.prefetchBlockTimes(logs.map((l) => l.blockNumber));
          for (const l of logs) await h.onTokenTransfer(l as never);
        }
        n++;
        if (n % 10 === 0 || pt === until) {
          console.log(`[chain ${cfg.chainId}] transfer backfill ${pt}/${until}`);
        }
        pf = pt + 1n;
      }
      console.log(`[chain ${cfg.chainId}] transfer backfill done`);
    })().catch(onErr);

    void (async () => {
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
          if (pf > liveHead) continue;
          while (pf <= liveHead) {
            while (gate.liveBusy) await new Promise((r) => setTimeout(r, 150));
            const pt = pf + BATCH - 1n > liveHead ? liveHead : pf + BATCH - 1n;
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
    })().catch(onErr);
  }

  setInterval(() => rescoreRecentTokens(db, cfg.chainId).catch(onErr), 10 * 60 * 1000);
  setInterval(() => {
    if (gate.liveBusy) return;
    backfillMissingFunders(db, client, cfg.chainId).catch(onErr);
  }, 20_000);
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
