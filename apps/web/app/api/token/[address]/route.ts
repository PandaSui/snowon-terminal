import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { fetchTokenOffchainMeta } from "@terminal/adapters";
import { bundleScores, tokens } from "@terminal/db";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

/** 总手续费 = 协议 1% + 估算 Gas。不含创建者税(页面「总税率」另列)。
 * 买入 ethAmount=用户实付(毛额),卖出=用户实收(净额)。Gas 按每笔约 250k × 1 gwei 估。 */
const PROTOCOL_BPS = 100n;
const GAS_PER_TX_WEI = 250_000n * 1_000_000_000n;

function estimateFeesWei(buyVolWei: string, sellVolWei: string, tradeCount: number): string {
  let buyVol = 0n;
  let sellVol = 0n;
  try { buyVol = BigInt(buyVolWei || "0"); } catch { buyVol = 0n; }
  try { sellVol = BigInt(sellVolWei || "0"); } catch { sellVol = 0n; }
  const buyProto = (buyVol * PROTOCOL_BPS) / 10_000n;
  const sellDenom = 10_000n - PROTOCOL_BPS;
  const sellProto = sellDenom > 0n ? (sellVol * PROTOCOL_BPS) / sellDenom : 0n;
  const gas = BigInt(Math.max(0, tradeCount | 0)) * GAS_PER_TX_WEI;
  return (buyProto + sellProto + gas).toString();
}

/** DB 行含 BigInt 列(createdAtBlock 等),JSON.stringify 不认,统一转 string */
function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

const enriching = new Set<string>();

/** 代币详情:基本信息 + 捆绑评分(也是未来 AI 分析端点的数据源) */
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const addr = address.toLowerCase();
    const [[t], [bundle], aggRows] = await Promise.all([
      db.select().from(tokens).where(and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, addr))).limit(1),
      db
        .select()
        .from(bundleScores)
        .where(and(eq(bundleScores.chainId, CHAIN_ID), eq(bundleScores.tokenAddress, addr)))
        .limit(1),
      db.execute(sql`
        SELECT
          count(*) FILTER (
            WHERE kind IN ('buy', 'sell') AND block_timestamp >= now() - interval '1 hour'
          )::int AS "heat1h",
          count(*) FILTER (
            WHERE kind IN ('buy', 'sell') AND block_timestamp >= now() - interval '24 hours'
          )::int AS "heat24h",
          coalesce(sum(eth_amount) FILTER (WHERE is_buy AND kind IN ('buy', 'sell') AND price_eth > 1e-14 AND price_eth < 0.01 AND eth_amount::numeric < 1e22), 0)::text AS "buyVol",
          coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy AND kind IN ('buy', 'sell') AND price_eth > 1e-14 AND price_eth < 0.01 AND eth_amount::numeric < 1e22), 0)::text AS "sellVol",
          count(*) FILTER (WHERE kind IN ('buy', 'sell'))::int AS "tradeCount",
          (
            SELECT lp.price_eth::text FROM latest_prices lp
            WHERE lp.chain_id = ${CHAIN_ID} AND lp.token_address = ${addr}
              AND lp.price_eth > 1e-14 AND lp.price_eth < 0.01
          ) AS "livePriceEth",
          (
            SELECT tr.price_eth::text FROM trades tr
            WHERE tr.chain_id = ${CHAIN_ID} AND tr.token_address = ${addr}
              AND tr.kind IN ('buy', 'sell') AND tr.price_eth > 1e-14 AND tr.price_eth < 0.01
            ORDER BY tr.block_timestamp DESC LIMIT 1
          ) AS "lastPriceEth"
        FROM trades
        WHERE chain_id = ${CHAIN_ID} AND token_address = ${addr}
      `),
    ]);
    if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
    const agg = asRows<{
      heat1h: number; heat24h: number; buyVol: string; sellVol: string; tradeCount: number;
      livePriceEth: string | null; lastPriceEth: string | null;
    }>(aggRows)[0];
    const priceEth = agg?.livePriceEth || agg?.lastPriceEth || null;
    const mcapEth = priceEth != null && Number(priceEth) > 0
      ? String(Number(priceEth) * 1_000_000_000)
      : null;

    const socialsMissing = t.website == null && t.twitter == null && t.telegram == null && t.github == null;
    if ((t.description == null || socialsMissing) && !enriching.has(addr)) {
      enriching.add(addr);
      // IPFS/Pinata 不挡首屏;后台写入后下次请求带上社交字段
      void fetchTokenOffchainMeta(addr)
        .then(async (meta) => {
          const patch = meta
            ? {
                description: t.description ?? meta.description ?? "",
                skill: t.skill ?? meta.skill,
                website: meta.website ?? "",
                twitter: meta.twitter ?? "",
                telegram: meta.telegram ?? "",
                github: meta.github ?? "",
                ...(meta.logo ? { logoUri: meta.logo } : {}),
              }
            : {
                website: t.website ?? "",
                twitter: t.twitter ?? "",
                telegram: t.telegram ?? "",
                github: t.github ?? "",
                ...(t.description == null ? { description: "" } : {}),
              };
          await db.update(tokens).set(patch).where(and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, addr)));
        })
        .catch(() => {})
        .finally(() => enriching.delete(addr));
    }

    return NextResponse.json(jsonSafe({
      ...t,
      bundleScore: bundle ?? null,
      heat1h: agg?.heat1h ?? 0,
      heat24h: agg?.heat24h ?? 0,
      priceEth,
      mcapEth,
      totalFeesWei: estimateFeesWei(agg?.buyVol ?? "0", agg?.sellVol ?? "0", agg?.tradeCount ?? 0),
    }));
  } catch (e) {
    return apiError(e);
  }
}
