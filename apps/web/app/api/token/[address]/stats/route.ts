import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

type WindowKey = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";

function pick(r: Record<string, unknown>, key: WindowKey) {
  return {
    vol: String(r[`vol${key}`] ?? "0"),
    buyVol: String(r[`buyVol${key}`] ?? "0"),
    sellVol: String(r[`sellVol${key}`] ?? "0"),
    buys: Number(r[`buys${key}`] ?? 0),
    sells: Number(r[`sells${key}`] ?? 0),
  };
}

/**
 * 代币时段统计:1m / 5m / 15m / 1h / 4h / 1D
 * 总成交量 + 买入成交量 + 卖出成交量(ETH wei 字符串) + 买/卖笔数。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const res = await db.execute(sql`
      SELECT
        coalesce(sum(eth_amount) FILTER (WHERE block_timestamp >= now() - interval '1 minute'), 0)::text AS "vol1m",
        coalesce(sum(eth_amount) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '1 minute'), 0)::text AS "buyVol1m",
        coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '1 minute'), 0)::text AS "sellVol1m",
        count(*) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '1 minute')::int AS "buys1m",
        count(*) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '1 minute')::int AS "sells1m",

        coalesce(sum(eth_amount) FILTER (WHERE block_timestamp >= now() - interval '5 minutes'), 0)::text AS "vol5m",
        coalesce(sum(eth_amount) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '5 minutes'), 0)::text AS "buyVol5m",
        coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '5 minutes'), 0)::text AS "sellVol5m",
        count(*) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '5 minutes')::int AS "buys5m",
        count(*) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '5 minutes')::int AS "sells5m",

        coalesce(sum(eth_amount) FILTER (WHERE block_timestamp >= now() - interval '15 minutes'), 0)::text AS "vol15m",
        coalesce(sum(eth_amount) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '15 minutes'), 0)::text AS "buyVol15m",
        coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '15 minutes'), 0)::text AS "sellVol15m",
        count(*) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '15 minutes')::int AS "buys15m",
        count(*) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '15 minutes')::int AS "sells15m",

        coalesce(sum(eth_amount) FILTER (WHERE block_timestamp >= now() - interval '1 hour'), 0)::text AS "vol1h",
        coalesce(sum(eth_amount) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '1 hour'), 0)::text AS "buyVol1h",
        coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '1 hour'), 0)::text AS "sellVol1h",
        count(*) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '1 hour')::int AS "buys1h",
        count(*) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '1 hour')::int AS "sells1h",

        coalesce(sum(eth_amount) FILTER (WHERE block_timestamp >= now() - interval '4 hours'), 0)::text AS "vol4h",
        coalesce(sum(eth_amount) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '4 hours'), 0)::text AS "buyVol4h",
        coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '4 hours'), 0)::text AS "sellVol4h",
        count(*) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '4 hours')::int AS "buys4h",
        count(*) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '4 hours')::int AS "sells4h",

        coalesce(sum(eth_amount) FILTER (WHERE block_timestamp >= now() - interval '24 hours'), 0)::text AS "vol1D",
        coalesce(sum(eth_amount) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '24 hours'), 0)::text AS "buyVol1D",
        coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '24 hours'), 0)::text AS "sellVol1D",
        count(*) FILTER (WHERE is_buy AND block_timestamp >= now() - interval '24 hours')::int AS "buys1D",
        count(*) FILTER (WHERE NOT is_buy AND block_timestamp >= now() - interval '24 hours')::int AS "sells1D"
      FROM trades
      WHERE chain_id = ${CHAIN_ID}
        AND token_address = ${address.toLowerCase()}
        AND block_timestamp >= now() - interval '24 hours'
    `);
    const row = asRows<Record<string, unknown>>(res)[0] ?? {};
    return NextResponse.json({
      "1m": pick(row, "1m"),
      "5m": pick(row, "5m"),
      "15m": pick(row, "15m"),
      "1h": pick(row, "1h"),
      "4h": pick(row, "4h"),
      "1D": pick(row, "1D"),
    });
  } catch (e) {
    return apiError(e);
  }
}
