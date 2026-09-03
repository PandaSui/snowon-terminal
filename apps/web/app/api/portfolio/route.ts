import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

/**
 * 资产面板:某钱包的持仓 + 当前估值 + 盈亏。
 * valueEth = 持仓(whole) × 最新价;unrealized = valueEth − 剩余成本。
 */
export async function GET(req: Request) {
  try {
    const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
    if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }
    const res = await db.execute(sql`
      SELECT
        p.token_address     AS "tokenAddress",
        tk.name             AS "name",
        tk.symbol           AS "symbol",
        tk.logo_uri         AS "logoUri",
        tk.graduated,
        (p.balance::numeric / 1e18)::text        AS "balanceWhole",
        (p.cost_basis_eth::numeric / 1e18)::text AS "costBasisEth",
        (p.realized_pnl_eth::numeric / 1e18)::text AS "realizedPnlEth",
        lp.price_eth::text  AS "priceEth",
        CASE WHEN lp.price_eth IS NULL THEN NULL
             ELSE ((p.balance::numeric / 1e18) * lp.price_eth)::text
        END AS "valueEth"
      FROM positions p
      LEFT JOIN tokens tk ON tk.address = p.token_address AND tk.chain_id = p.chain_id
      LEFT JOIN latest_prices lp ON lp.token_address = p.token_address AND lp.chain_id = p.chain_id
      WHERE p.chain_id = ${CHAIN_ID} AND p.wallet = ${address} AND p.balance::numeric > 0
      ORDER BY ((p.balance::numeric / 1e18) * coalesce(lp.price_eth, 0)) DESC
      LIMIT 50
    `);
    return NextResponse.json(jsonSafe(res as unknown as Record<string, unknown>[]));
  } catch (e) {
    return apiError(e);
  }
}
