import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

function parseAddrs(req: Request): string[] {
  const q = new URL(req.url).searchParams;
  const raw = q.get("addresses") ?? q.get("address") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
    .slice(0, 80);
}

/** 钱包追踪:一个或多个地址最近成交(含买入时市值)。`buys=1` 只返回买入。 */
export async function GET(req: Request) {
  try {
    const addrs = parseAddrs(req);
    if (addrs.length === 0) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }
    const buysOnly = new URL(req.url).searchParams.get("buys") === "1";
    const addrList = sql.join(addrs.map((a) => sql`${a}`), sql`, `);
    const res = await db.execute(sql`
      SELECT
        tr.trader           AS "trader",
        tr.tx_hash          AS "txHash",
        tr.log_index        AS "logIndex",
        tr.token_address    AS "tokenAddress",
        tk.name             AS "tokenName",
        tk.symbol           AS "tokenSymbol",
        tk.logo_uri         AS "logoUri",
        tr.is_buy           AS "isBuy",
        tr.eth_amount::text   AS "ethAmount",
        tr.token_amount::text AS "tokenAmount",
        tr.price_eth::text    AS "priceEth",
        (coalesce(lp.price_eth, tr.price_eth, 0) * 1000000000)::text AS "mcapEth",
        tr.phase,
        tr.block_timestamp  AS "blockTimestamp"
      FROM trades tr
      LEFT JOIN tokens tk ON tk.address = tr.token_address AND tk.chain_id = tr.chain_id
      LEFT JOIN latest_prices lp ON lp.token_address = tr.token_address AND lp.chain_id = tr.chain_id
      WHERE tr.chain_id = ${CHAIN_ID} AND tr.trader IN (${addrList})
        AND (${buysOnly ? sql`tr.is_buy = true` : sql`true`})
      ORDER BY tr.block_timestamp DESC
      LIMIT ${buysOnly ? 40 : 80}
    `);
    return NextResponse.json(jsonSafe(asRows<Record<string, unknown>>(res)));
  } catch (e) {
    return apiError(e);
  }
}
