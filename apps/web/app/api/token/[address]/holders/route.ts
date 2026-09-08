import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { createPublicClient, http, zeroAddress, type Address, type Hex } from "viem";
import { snowAbis, readPoolSqrtP, readPoolLiquidity } from "@terminal/adapters";
import { tokens } from "@terminal/db";
import { chainById } from "@/lib/chains";
import { getChainConfig } from "@/lib/chainConfigs";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { ttlMap } from "@/lib/ttlCache";

/** 曲线恒定总量 10 亿枚 */
const DEFAULT_SUPPLY = 1_000_000_000n * 10n ** 18n;
const Q96 = 2n ** 96n;
const DEAD = "0x000000000000000000000000000000000000dead" as Address;
const BURN_SET = new Set([zeroAddress.toLowerCase(), DEAD.toLowerCase()]);

type Onchain = {
  totalSupply: bigint;
  zeroBal: bigint;
  deadBal: bigint;
  curveBal: bigint;
  poolBal: bigint;
  poolQuote: bigint;
  managerBal: bigint;
};

const onchainCache = ttlMap<string, Onchain>(60_000);
const resultCache = ttlMap<string, unknown>(20_000);

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

function toWei(s: unknown): bigint {
  try {
    return BigInt(String(s ?? "0").split(".")[0] || "0");
  } catch {
    return 0n;
  }
}

function whole(n: bigint): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(19, "0");
  const intPart = s.slice(0, -18).replace(/^0+/, "") || "0";
  const frac = s.slice(-18).replace(/0+$/, "");
  return `${neg ? "-" : ""}${intPart}${frac ? `.${frac}` : ""}`;
}

/** 占总量百分比,精度到 0.0001% */
function pctOf(part: bigint, wholeAmt: bigint): number {
  if (wholeAmt <= 0n || part <= 0n) return 0;
  return Number((part * 10_000_000n) / wholeAmt) / 100_000;
}

function parseLabels(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return [];
    try {
      const j = JSON.parse(t) as unknown;
      if (Array.isArray(j)) return j.map(String);
    } catch {
      /* 非 JSON 当单个标签 */
    }
    return [t];
  }
  return [];
}

function isPhishWallet(funderLabel: string | null | undefined, labels: string[]): boolean {
  const blob = `${funderLabel ?? ""} ${labels.join(" ")}`.toLowerCase();
  return funderLabel === "mixer" || /(phish|scam|mixer|钓鱼|诈骗)/.test(blob);
}

function isBundleWallet(labels: string[], clusterSize: number): boolean {
  if (clusterSize >= 2) return true;
  return /(bundler|bundle|sniper|捆)/.test(labels.join(" ").toLowerCase());
}

function amountsFromSqrt(sqrtP: bigint, L: bigint) {
  if (sqrtP === 0n || L === 0n) return { amt0: 0n, amt1: 0n };
  return { amt0: (L * Q96) / sqrtP, amt1: (L * sqrtP) / Q96 };
}

function settledBig(r: PromiseSettledResult<unknown>, fallback = 0n): bigint {
  if (r.status !== "fulfilled" || r.value == null) return fallback;
  try {
    return BigInt(r.value as bigint | string | number);
  } catch {
    return fallback;
  }
}

async function readOnchain(
  addr: Address,
  curveAddress: string | null,
  graduated: boolean,
  poolId: string | null,
): Promise<Onchain> {
  const hit = onchainCache.get(addr);
  if (hit) return hit;
  const empty: Onchain = {
    totalSupply: DEFAULT_SUPPLY,
    zeroBal: 0n,
    deadBal: 0n,
    curveBal: 0n,
    poolBal: 0n,
    poolQuote: 0n,
    managerBal: 0n,
  };
  try {
    const cfg = await getChainConfig(CHAIN_ID);
    if (!cfg) return empty;
    const client = createPublicClient({
      chain: chainById(cfg.chainId),
      transport: http(cfg.rpcUrl, { batch: false, timeout: 5_000 }),
    });
    const abi = snowAbis.erc20Abi;
    const curve = (curveAddress ?? zeroAddress) as Address;
    const manager = (cfg.poolManager ?? zeroAddress) as Address;
    const reads: Array<Promise<unknown>> = [
      client.readContract({ address: addr, abi, functionName: "totalSupply" }),
      client.readContract({ address: addr, abi, functionName: "balanceOf", args: [zeroAddress] }),
      client.readContract({ address: addr, abi, functionName: "balanceOf", args: [DEAD] }),
      curve !== zeroAddress
        ? client.readContract({ address: addr, abi, functionName: "balanceOf", args: [curve] })
        : Promise.resolve(0n),
      graduated && manager !== zeroAddress
        ? client.readContract({ address: addr, abi, functionName: "balanceOf", args: [manager] })
        : Promise.resolve(0n),
    ];
    if (graduated && poolId && manager !== zeroAddress) {
      reads.push(
        readPoolSqrtP(client, manager, poolId as Hex),
        readPoolLiquidity(client, manager, poolId as Hex),
      );
    }
    const settled = await Promise.allSettled(reads);
    const totalSupply = settledBig(settled[0], DEFAULT_SUPPLY) || DEFAULT_SUPPLY;
    const zeroBal = settledBig(settled[1]);
    const deadBal = settledBig(settled[2]);
    const curveBal = settledBig(settled[3]);
    const managerBal = settledBig(settled[4]);
    let poolBal = 0n;
    let poolQuote = 0n;
    if (settled.length >= 7 && settled[5].status === "fulfilled" && settled[6].status === "fulfilled") {
      const sqrtP = (settled[5].value as bigint | null) ?? 0n;
      const L = settledBig(settled[6]);
      const { amt0, amt1 } = amountsFromSqrt(sqrtP, L);
      const tokenIsC1 = addr.toLowerCase() > zeroAddress;
      poolQuote = tokenIsC1 ? amt0 : amt1;
      poolBal = tokenIsC1 ? amt1 : amt0;
    }
    if (poolBal <= 0n && managerBal > 0n) poolBal = managerBal;
    const out: Onchain = { totalSupply, zeroBal, deadBal, curveBal, poolBal, poolQuote, managerBal };
    onchainCache.set(addr, out);
    return out;
  } catch {
    return empty;
  }
}

/** 持有者(买入+转入,按余额) + 流动池 + 成本/盈亏 + 同资金来源簇 + 钓鱼/捆绑标记 + 销毁地址 */
const HOLDER_LIST_CAP = 1000;
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const addr = address.toLowerCase() as Address;
    const cached = resultCache.get(addr);
    if (cached) return NextResponse.json(cached);

    const [tokRows, holdersRes, statsRes] = await Promise.all([
      db
        .select({
          curveAddress: tokens.curveAddress,
          graduated: tokens.graduated,
          poolId: tokens.poolId,
          lpTokenWei: tokens.lpTokenWei,
          lpQuoteWei: tokens.lpQuoteWei,
          lpLockedForever: tokens.lpLockedForever,
          quoteAsset: tokens.quoteAsset,
          creator: tokens.creator,
        })
        .from(tokens)
        .where(and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, addr)))
        .limit(1),
      db.execute(sql`
        WITH ranked AS (
          SELECT
            p.wallet,
            p.balance,
            p.cost_basis_eth,
            p.realized_pnl_eth,
            p.buy_count,
            p.sell_count,
            w.first_funder,
            w.funder_label,
            w.labels,
            w.first_seen_at,
            w.last_seen_at,
            lp.price_eth,
            row_number() OVER (ORDER BY p.balance DESC) AS rn
          FROM positions p
          LEFT JOIN wallets w ON w.chain_id = p.chain_id AND w.address = p.wallet
          LEFT JOIN latest_prices lp
            ON lp.chain_id = p.chain_id AND lp.token_address = p.token_address
          WHERE p.chain_id = ${CHAIN_ID} AND p.token_address = ${addr} AND p.balance > 0
        ),
        clusters AS (
          SELECT w.first_funder, count(*)::int AS n
          FROM positions p
          JOIN wallets w ON w.chain_id = p.chain_id AND w.address = p.wallet
          WHERE p.chain_id = ${CHAIN_ID}
            AND p.token_address = ${addr}
            AND p.balance > 0
            AND w.first_funder IS NOT NULL
            AND w.first_funder <> ''
          GROUP BY w.first_funder
          HAVING count(*) >= 2
        )
        SELECT
          r.wallet,
          r.balance::numeric::text AS "balanceRaw",
          (r.balance::numeric / 1e18)::text AS "balanceWhole",
          (r.cost_basis_eth::numeric / 1e18)::text AS "costBasisEth",
          (r.realized_pnl_eth::numeric / 1e18)::text AS "realizedPnlEth",
          CASE WHEN r.balance::numeric > 0
            THEN (r.cost_basis_eth::numeric / r.balance::numeric)::text
            ELSE NULL
          END AS "avgCostEth",
          r.price_eth::text AS "priceEth",
          r.buy_count AS "buyCount",
          r.sell_count AS "sellCount",
          r.first_funder AS "firstFunder",
          r.funder_label AS "funderLabel",
          r.labels,
          to_json(r.first_seen_at)#>>'{}' AS "firstSeenAt",
          to_json(r.last_seen_at)#>>'{}' AS "lastSeenAt",
          coalesce(c.n, 0)::int AS "clusterSize"
        FROM ranked r
        LEFT JOIN clusters c ON c.first_funder = r.first_funder
        WHERE r.rn <= ${HOLDER_LIST_CAP}
        ORDER BY r.rn
      `),
      db.execute(sql`
        SELECT
          count(*) FILTER (
            WHERE wallet NOT IN (${zeroAddress}, ${DEAD})
          )::int AS "holderCount",
          coalesce(sum(balance) FILTER (
            WHERE wallet NOT IN (${zeroAddress}, ${DEAD})
          ), 0)::text AS "totalBalance",
          coalesce((
            SELECT sum(bal) FROM (
              SELECT balance AS bal FROM positions
              WHERE chain_id = ${CHAIN_ID}
                AND token_address = ${addr}
                AND balance > 0
                AND wallet NOT IN (${zeroAddress}, ${DEAD})
              ORDER BY balance DESC LIMIT 10
            ) t
          ), 0)::text AS "top10Balance",
          (
            SELECT sum(cost_basis_eth::numeric) / nullif(sum(balance::numeric), 0)
            FROM (
              SELECT balance, cost_basis_eth FROM positions
              WHERE chain_id = ${CHAIN_ID}
                AND token_address = ${addr}
                AND balance > 0
                AND wallet NOT IN (${zeroAddress}, ${DEAD})
              ORDER BY balance DESC LIMIT 10
            ) c10
          )::text AS "top10AvgCostEth",
          (
            SELECT sum(cost_basis_eth::numeric) / nullif(sum(balance::numeric), 0)
            FROM (
              SELECT balance, cost_basis_eth FROM positions
              WHERE chain_id = ${CHAIN_ID}
                AND token_address = ${addr}
                AND balance > 0
                AND wallet NOT IN (${zeroAddress}, ${DEAD})
              ORDER BY balance DESC LIMIT 100
            ) c100
          )::text AS "top100AvgCostEth"
        FROM positions
        WHERE chain_id = ${CHAIN_ID} AND token_address = ${addr} AND balance > 0
      `),
    ]);

    const tok = tokRows[0];
    const onchain = await readOnchain(
      addr,
      tok?.curveAddress ?? null,
      !!tok?.graduated,
      tok?.poolId ?? null,
    );

    const rawHolders = asRows<{
      wallet: string;
      balanceRaw: string;
      balanceWhole: string;
      costBasisEth: string;
      realizedPnlEth: string;
      avgCostEth: string | null;
      priceEth: string | null;
      buyCount: number;
      sellCount: number;
      firstFunder: string | null;
      funderLabel: string | null;
      labels: unknown;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
      clusterSize: number;
    }>(holdersRes);
    const stats = asRows<{
      holderCount: number;
      totalBalance: string;
      top10Balance: string;
      top10AvgCostEth: string | null;
      top100AvgCostEth: string | null;
    }>(statsRes)[0] ?? {
      holderCount: 0, totalBalance: "0", top10Balance: "0", top10AvgCostEth: null, top100AvgCostEth: null,
    };

    // ── 开发者系地址:creator 本人 + 资金链两级关联(开发者出资的小号、小号再出资的二级小号) ──
    const creator = tokRows[0]?.creator?.toLowerCase() || null;
    let devRelated = new Set<string>();
    if (creator) {
      devRelated = new Set([creator]);
      for (let hop = 0; hop < 2; hop++) {
        const frontier = [...devRelated];
        const rows = asRows<{ address: string }>(await db.execute(sql`
          SELECT address FROM wallets
          WHERE chain_id = ${CHAIN_ID} AND first_funder IN (${sql.join(frontier.map((a) => sql`${a}`), sql`, `)})
        `));
        const before = devRelated.size;
        for (const r of rows) devRelated.add(r.address.toLowerCase());
        if (devRelated.size === before) break;
      }
      devRelated.delete(creator); // 小号集合不含开发者本人
    }

    let totalSupply = onchain.totalSupply > 0n ? onchain.totalSupply : DEFAULT_SUPPLY;
    const tracked = toWei(stats.totalBalance);
    const burned = onchain.zeroBal + onchain.deadBal;
    if (totalSupply === 0n && tracked > 0n) totalSupply = tracked + burned;

    const denom = totalSupply > 0n ? totalSupply : 1n;
    const cfg = await getChainConfig(CHAIN_ID).catch(() => undefined);
    const skip = new Set(BURN_SET);
    if (tok?.curveAddress) skip.add(tok.curveAddress.toLowerCase());
    if (cfg?.poolManager) skip.add(cfg.poolManager.toLowerCase());
    if (cfg?.swapRouter) skip.add(cfg.swapRouter.toLowerCase());
    if (cfg?.hook) skip.add(cfg.hook.toLowerCase());
    if (cfg?.factory) skip.add(cfg.factory.toLowerCase());

    const priceEth = rawHolders.find((h) => h.priceEth != null)?.priceEth ?? null;
    const priceN = priceEth == null ? null : Number(priceEth);

    const remain = totalSupply > tracked + burned ? totalSupply - tracked - burned : 0n;
    let poolBal = onchain.poolBal;
    let poolQuote = onchain.poolQuote;
    let poolKind: "curve" | "v4" = tok?.graduated ? "v4" : "curve";
    if (tok?.graduated) {
      if (poolBal <= 0n) poolBal = onchain.managerBal;
      if (poolBal <= 0n) poolBal = toWei(tok.lpTokenWei);
      if (poolBal <= 0n) poolBal = remain;
      if (poolQuote <= 0n) poolQuote = toWei(tok.lpQuoteWei);
    } else {
      poolBal = onchain.curveBal;
      if (poolBal <= 0n) poolBal = remain;
      poolKind = "curve";
    }
    const quoteSymbol = !tok?.quoteAsset || tok.quoteAsset === zeroAddress ? "ETH" : "Q";

    const pool = poolBal > 0n
      ? {
          kind: poolKind,
          label: "流动池",
          wallet: poolKind === "curve" ? (tok?.curveAddress ?? "") : (tok?.poolId ?? cfg?.poolManager ?? ""),
          balanceWhole: whole(poolBal),
          sharePct: pctOf(poolBal, denom),
          quoteWhole: poolQuote > 0n ? whole(poolQuote) : null,
          quoteSymbol,
          valueEth: priceN != null && Number.isFinite(priceN) ? String(priceN * Number(whole(poolBal))) : null,
          locked: !!(tok?.graduated && tok.lpLockedForever),
        }
      : null;

    const holders = rawHolders
      .filter((h) => !skip.has(h.wallet.toLowerCase()))
      .slice(0, HOLDER_LIST_CAP)
      .map((h) => {
        const bal = toWei(h.balanceRaw);
        const labels = parseLabels(h.labels);
        const clusterSize = Number(h.clusterSize ?? 0);
        const wallet = h.wallet.toLowerCase();
        const funder = h.firstFunder?.toLowerCase() ?? null;
        // 开发者 = 代币 creator;开发小号 = 本身在开发者资金链内,或直接出资人是开发者/小号
        const isDev = creator != null && wallet === creator;
        const isDevAlt = !isDev && (devRelated.has(wallet) || (funder != null && (funder === creator || devRelated.has(funder))));
        const balanceWhole = Number(h.balanceWhole);
        const costBasisEth = Number(h.costBasisEth);
        const rowPrice = h.priceEth == null ? null : Number(h.priceEth);
        const valueEth =
          rowPrice != null && Number.isFinite(balanceWhole) ? rowPrice * balanceWhole : null;
        const unrealizedPnlEth =
          valueEth != null && Number.isFinite(costBasisEth) ? valueEth - costBasisEth : null;
        const realizedPnlEth = Number(h.realizedPnlEth);
        const totalPnlEth =
          unrealizedPnlEth != null && Number.isFinite(realizedPnlEth)
            ? unrealizedPnlEth + realizedPnlEth
            : unrealizedPnlEth;
        const avgCostEth =
          h.avgCostEth != null
            ? h.avgCostEth
            : Number.isFinite(balanceWhole) && balanceWhole > 0 && Number.isFinite(costBasisEth)
              ? String(costBasisEth / balanceWhole)
              : null;
        const pnlPct =
          Number.isFinite(costBasisEth) && costBasisEth > 0 && unrealizedPnlEth != null
            ? unrealizedPnlEth / costBasisEth
            : null;
        return {
          wallet: h.wallet,
          isDev,
          isDevAlt,
          balanceWhole: h.balanceWhole,
          costBasisEth: h.costBasisEth,
          avgCostEth,
          priceEth: h.priceEth,
          valueEth: valueEth != null && Number.isFinite(valueEth) ? String(valueEth) : null,
          realizedPnlEth: h.realizedPnlEth,
          unrealizedPnlEth: unrealizedPnlEth != null ? String(unrealizedPnlEth) : null,
          totalPnlEth: totalPnlEth != null ? String(totalPnlEth) : null,
          pnlPct: pnlPct != null && Number.isFinite(pnlPct) ? String(pnlPct) : null,
          buyCount: h.buyCount,
          sellCount: h.sellCount,
          sharePct: pctOf(bal, denom),
          firstFunder: h.firstFunder,
          funderLabel: h.funderLabel,
          firstSeenAt: h.firstSeenAt,
          lastSeenAt: h.lastSeenAt,
          clusterSize,
          sameFunder: clusterSize >= 2,
          isPhish: isPhishWallet(h.funderLabel, labels),
          isBundle: isBundleWallet(labels, clusterSize),
        };
      });

    const burns: Array<{ address: string; label: string; balanceWhole: string; sharePct: number }> = [];
    if (onchain.zeroBal > 0n) {
      burns.push({
        address: zeroAddress,
        label: "零地址",
        balanceWhole: whole(onchain.zeroBal),
        sharePct: pctOf(onchain.zeroBal, denom),
      });
    }
    if (onchain.deadBal > 0n) {
      burns.push({
        address: DEAD,
        label: "销毁地址",
        balanceWhole: whole(onchain.deadBal),
        sharePct: pctOf(onchain.deadBal, denom),
      });
    }

    const top10 = toWei(stats.top10Balance);

    // 开发者系(开发者 + 小号)合计持仓占比
    let devSharePct: number | null = null;
    let devAltCount = 0;
    if (creator) {
      const devAddrs = [creator, ...devRelated].slice(0, 500);
      const r = asRows<{ bal: string; n: number }>(await db.execute(sql`
        SELECT coalesce(sum(balance), 0)::text AS bal,
               count(*) FILTER (WHERE wallet <> ${creator})::int AS n
        FROM positions
        WHERE chain_id = ${CHAIN_ID} AND token_address = ${addr} AND balance > 0
          AND wallet IN (${sql.join(devAddrs.map((a) => sql`${a}`), sql`, `)})
      `));
      devSharePct = pctOf(toWei(r[0]?.bal), denom);
      devAltCount = Number(r[0]?.n ?? 0);
    }

    const body = {
      holders,
      pool,
      creator,
      devSharePct,
      devAltCount,
      holderCount: stats.holderCount ?? 0,
      top10Share: pctOf(top10, denom) / 100,
      top10AvgCostEth: stats.top10AvgCostEth,
      top100AvgCostEth: stats.top100AvgCostEth,
      totalSupplyWhole: whole(totalSupply),
      burnedWhole: burned > 0n ? whole(burned) : null,
      burnedPct: burned > 0n ? pctOf(burned, denom) : null,
      burns,
    };
    resultCache.set(addr, body);
    return NextResponse.json(body);
  } catch (e) {
    return apiError(e);
  }
}
