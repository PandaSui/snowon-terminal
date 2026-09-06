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

function windowInterval(w: string) {
  switch (w) {
    case "1m": return sql`interval '1 minute'`;
    case "5m": return sql`interval '5 minutes'`;
    case "30m": return sql`interval '30 minutes'`;
    case "1h": return sql`interval '1 hour'`;
    default: return sql`interval '24 hours'`;
  }
}

/**
 * 热门板块:按时间窗口汇总成交量,供导航栏排名。
 * GET /api/tokens/hot?window=1m|5m|30m|1h|24h
 */
export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("window") ?? "24h";
    const window = ["1m", "5m", "30m", "1h", "24h"].includes(raw) ? raw : "24h";
    const iv = windowInterval(window);
    const res = await db.execute(sql`
      SELECT
        t.address,
        t.name,
        t.symbol,
        t.logo_uri AS "logoUri",
        t.graduated,
        t.created_at AS "createdAt",
        (coalesce(lp.price_eth, 0) * 1000000000)::text AS "mcapEth",
        lp.price_eth::text AS "priceEth",
        (h.vol / 1e18)::text AS "volumeEth",
        h.trades::int AS trades,
        h.last_at AS "lastAt"
      FROM (
        SELECT
          tr.token_address,
          coalesce(sum(tr.eth_amount::numeric), 0) AS vol,
          count(*)::int AS trades,
          max(tr.block_timestamp) AS last_at
        FROM trades tr
        WHERE tr.chain_id = ${CHAIN_ID}
          AND tr.kind IN ('buy', 'sell')
          AND tr.block_timestamp >= now() - ${iv}
        GROUP BY tr.token_address
      ) h
      INNER JOIN tokens t ON t.chain_id = ${CHAIN_ID} AND t.address = h.token_address
      LEFT JOIN latest_prices lp ON lp.chain_id = t.chain_id AND lp.token_address = t.address
      ORDER BY h.vol DESC
      LIMIT 40
    `);
    return NextResponse.json(asRows<Record<string, unknown>>(res), {
      headers: { "Cache-Control": "public, max-age=2, s-maxage=4" },
    });
  } catch (e) {
    return apiError(e);
  }
}
