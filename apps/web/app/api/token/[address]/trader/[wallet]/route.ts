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

function priceFromWei(ethWei: string, tokenWei: string): string | null {
  try {
    const eth = BigInt((ethWei ?? "0").split(".")[0] || "0");
    const tok = BigInt((tokenWei ?? "0").split(".")[0] || "0");
    if (tok <= 0n || eth <= 0n) return null;
    const scaled = (eth * 10n ** 18n) / tok;
    const intPart = scaled / 10n ** 18n;
    const frac = scaled % 10n ** 18n;
    return `${intPart}.${frac.toString().padStart(18, "0")}`;
  } catch {
    return null;
  }
}

/** 某地址在该代币上的加权平均买价 / 卖价 / 剩余成本 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string; wallet: string }> },
) {
  try {
    const { address, wallet } = await params;
    const token = address.toLowerCase();
    const w = wallet.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(w)) {
      return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
    }

    const [aggRes, posRes] = await Promise.all([
      db.execute(sql`
        SELECT
          coalesce(sum(eth_amount) FILTER (WHERE is_buy), 0)::text AS "buyEthWei",
          coalesce(sum(token_amount) FILTER (WHERE is_buy), 0)::text AS "buyTokWei",
          coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy), 0)::text AS "sellEthWei",
          coalesce(sum(token_amount) FILTER (WHERE NOT is_buy), 0)::text AS "sellTokWei",
          count(*) FILTER (WHERE is_buy)::int AS "buyCount",
          count(*) FILTER (WHERE NOT is_buy)::int AS "sellCount"
        FROM trades
        WHERE chain_id = ${CHAIN_ID} AND token_address = ${token} AND trader = ${w}
      `),
      db.execute(sql`
        SELECT
          (balance::numeric / 1e18)::text AS "balanceWhole",
          (cost_basis_eth::numeric / 1e18)::text AS "costBasisEth",
          (realized_pnl_eth::numeric / 1e18)::text AS "realizedPnlEth",
          (total_bought_eth::numeric / 1e18)::text AS "totalBoughtEth",
          (total_sold_eth::numeric / 1e18)::text AS "totalSoldEth",
          CASE WHEN balance::numeric > 0
            THEN (cost_basis_eth::numeric / balance::numeric)::text
            ELSE NULL
          END AS "remainCostEth"
        FROM positions
        WHERE chain_id = ${CHAIN_ID} AND token_address = ${token} AND wallet = ${w}
        LIMIT 1
      `),
    ]);

    const agg = asRows<{
      buyEthWei: string;
      buyTokWei: string;
      sellEthWei: string;
      sellTokWei: string;
      buyCount: number;
      sellCount: number;
    }>(aggRes)[0];
    const pos = asRows<{
      balanceWhole: string;
      costBasisEth: string;
      realizedPnlEth: string;
      totalBoughtEth: string;
      totalSoldEth: string;
      remainCostEth: string | null;
    }>(posRes)[0] ?? null;

    return NextResponse.json({
      wallet: w,
      tokenAddress: token,
      avgBuyEth: agg ? priceFromWei(agg.buyEthWei, agg.buyTokWei) : null,
      avgSellEth: agg ? priceFromWei(agg.sellEthWei, agg.sellTokWei) : null,
      remainCostEth: pos?.remainCostEth ?? null,
      buyCount: agg?.buyCount ?? 0,
      sellCount: agg?.sellCount ?? 0,
      balanceWhole: pos?.balanceWhole ?? "0",
      realizedPnlEth: pos?.realizedPnlEth ?? "0",
      totalBoughtEth: pos?.totalBoughtEth ?? "0",
      totalSoldEth: pos?.totalSoldEth ?? "0",
    });
  } catch (e) {
    return apiError(e);
  }
}
