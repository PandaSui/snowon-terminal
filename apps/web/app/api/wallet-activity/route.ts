import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

/** 钱包追踪:某地址最近的成交记录(关联代币名/符号) */
export async function GET(req: Request) {
  try {
    const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
    if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }
    const res = await db.execute(sql`
      SELECT
        tr.tx_hash          AS "txHash",
        tr.token_address    AS "tokenAddress",
        tk.name             AS "tokenName",
        tk.symbol           AS "tokenSymbol",
        tk.logo_uri         AS "logoUri",
        tr.is_buy           AS "isBuy",
        tr.eth_amount::text   AS "ethAmount",
        tr.token_amount::text AS "tokenAmount",
        tr.price_eth::text    AS "priceEth",
        tr.phase,
        tr.block_timestamp  AS "blockTimestamp"
      FROM trades tr
      LEFT JOIN tokens tk ON tk.address = tr.token_address AND tk.chain_id = tr.chain_id
      WHERE tr.chain_id = ${CHAIN_ID} AND tr.trader = ${address}
      ORDER BY tr.block_timestamp DESC
      LIMIT 30
    `);
    return NextResponse.json(jsonSafe(res as unknown as Record<string, unknown>[]));
  } catch (e) {
    return apiError(e);
  }
}
