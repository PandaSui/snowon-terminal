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

/**
 * 资产面板:某钱包的持仓 + 当前估值 + 盈亏。
 * valueEth = 持仓(whole) × 最新价;unrealized = valueEth − 剩余成本。
 * includeClosed=1 时额外返回已清仓(余额≈0 但仍有买卖记录)的代币。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const address = url.searchParams.get("address")?.toLowerCase();
    const includeClosed = url.searchParams.get("includeClosed") === "1";
    if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }
    const whereClosed = includeClosed
      ? sql`AND (p.balance::numeric > 0 OR p.buy_count > 0 OR p.sell_count > 0 OR p.realized_pnl_eth::numeric <> 0)`
      : sql`AND p.balance::numeric > 0`;
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
        (p.total_bought_eth::numeric / 1e18)::text AS "totalBoughtEth",
        lp.price_eth::text  AS "priceEth",
        CASE WHEN lp.price_eth IS NULL THEN NULL
             ELSE ((p.balance::numeric / 1e18) * lp.price_eth)::text
        END AS "valueEth",
        p.buy_count::int AS "buyCount",
        p.sell_count::int AS "sellCount",
        p.last_trade_at AS "lastTradeAt",
        (p.balance::numeric <= 0) AS closed,
        agg."buyAmountEth",
        agg."avgBuyPriceEth",
        agg."avgSellPriceEth",
        lb."lastBuyTx",
        ls."lastSellTx"
      FROM positions p
      LEFT JOIN tokens tk ON tk.address = p.token_address AND tk.chain_id = p.chain_id
      LEFT JOIN latest_prices lp ON lp.token_address = p.token_address AND lp.chain_id = p.chain_id
      LEFT JOIN LATERAL (
        SELECT
          (coalesce(sum(tr.eth_amount) FILTER (WHERE tr.is_buy), 0) / 1e18)::text AS "buyAmountEth",
          CASE WHEN coalesce(sum(tr.token_amount) FILTER (WHERE tr.is_buy), 0) > 0
            THEN (sum(tr.eth_amount) FILTER (WHERE tr.is_buy)
              / sum(tr.token_amount) FILTER (WHERE tr.is_buy))::text
          END AS "avgBuyPriceEth",
          CASE WHEN coalesce(sum(tr.token_amount) FILTER (WHERE NOT tr.is_buy), 0) > 0
            THEN (sum(tr.eth_amount) FILTER (WHERE NOT tr.is_buy)
              / sum(tr.token_amount) FILTER (WHERE NOT tr.is_buy))::text
          END AS "avgSellPriceEth"
        FROM trades tr
        WHERE tr.chain_id = ${CHAIN_ID}
          AND tr.trader = ${address}
          AND tr.token_address = p.token_address
          AND tr.kind IN ('buy', 'sell')
      ) agg ON true
      LEFT JOIN LATERAL (
        SELECT tr.tx_hash AS "lastBuyTx"
        FROM trades tr
        WHERE tr.chain_id = ${CHAIN_ID}
          AND tr.trader = ${address}
          AND tr.token_address = p.token_address
          AND tr.is_buy AND tr.kind IN ('buy', 'sell')
        ORDER BY tr.block_timestamp DESC, tr.log_index DESC
        LIMIT 1
      ) lb ON true
      LEFT JOIN LATERAL (
        SELECT tr.tx_hash AS "lastSellTx"
        FROM trades tr
        WHERE tr.chain_id = ${CHAIN_ID}
          AND tr.trader = ${address}
          AND tr.token_address = p.token_address
          AND NOT tr.is_buy AND tr.kind IN ('buy', 'sell')
        ORDER BY tr.block_timestamp DESC, tr.log_index DESC
        LIMIT 1
      ) ls ON true
      WHERE p.chain_id = ${CHAIN_ID} AND p.wallet = ${address}
        ${whereClosed}
      ORDER BY ((p.balance::numeric / 1e18) * coalesce(lp.price_eth, 0)) DESC
      LIMIT 200
    `);
    return NextResponse.json(jsonSafe(asRows<Record<string, unknown>>(res)));
  } catch (e) {
    return apiError(e);
  }
}
