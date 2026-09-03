import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

const ADDR_RE = /^0x[0-9a-f]{40}$/;
const E18 = 1e18;

/** UTC+8 日期分桶(用户时区) */
function dayKey(ts: Date): string {
  return new Date(ts.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function toWei(v: string | null | undefined): bigint {
  try {
    return BigInt((v ?? "0").split(".")[0] || "0");
  } catch {
    return 0n;
  }
}

interface TradeRow {
  token_address: string;
  is_buy: boolean;
  eth_amount: string;
  token_amount: string;
  block_timestamp: string | Date;
}

/**
 * 钱包 PNL 统计:回放全部成交(加权平均成本法),得到
 *  - 已实现 PNL:7 天 / 30 天 / 全部
 *  - 胜率:有卖出记录的代币中,已实现 PNL > 0 的占比
 *  - 每日已实现 PNL(日历用)+ 月度合计(一个月一结算)
 */
export async function GET(req: Request) {
  try {
    const address = (new URL(req.url).searchParams.get("address") ?? "").toLowerCase();
    if (!ADDR_RE.test(address)) return NextResponse.json({ error: "bad address" }, { status: 400 });

    const res = await db.execute(sql`
      SELECT token_address, is_buy, eth_amount::text, token_amount::text, block_timestamp
      FROM trades
      WHERE chain_id = ${CHAIN_ID} AND trader = ${address}
        AND coalesce(kind, case when is_buy then 'buy' else 'sell' end) IN ('buy', 'sell')
      ORDER BY block_timestamp ASC, log_index ASC
    `);
    const rows = (Array.isArray(res) ? res : (res as unknown as { rows?: TradeRow[] }).rows ?? []) as TradeRow[];

    // 回放:per-token 加权成本;卖出时结算已实现 PNL,按日落桶
    const posByToken = new Map<string, { bal: bigint; cost: bigint; realized: number; sold: boolean }>();
    const daily = new Map<string, number>();

    for (const r of rows) {
      const token = r.token_address.toLowerCase();
      const p = posByToken.get(token) ?? { bal: 0n, cost: 0n, realized: 0, sold: false };
      const tok = toWei(r.token_amount);
      const eth = Number(toWei(r.eth_amount)) / E18;
      if (r.is_buy) {
        p.bal += tok;
        p.cost += toWei(r.eth_amount);
      } else {
        p.sold = true;
        if (p.bal > 0n && tok > 0n) {
          const sold = tok > p.bal ? p.bal : tok;
          const costPartWei = (p.cost * sold) / p.bal;
          const pnl = eth - Number(costPartWei) / E18;
          p.realized += pnl;
          p.cost -= costPartWei;
          p.bal -= sold;
          if (p.cost < 0n) p.cost = 0n;
          const day = dayKey(new Date(r.block_timestamp));
          daily.set(day, (daily.get(day) ?? 0) + pnl);
        } else {
          // 无持仓记录的卖出(转入获得):成本按 0,全部计为盈利
          p.realized += eth;
          const day = dayKey(new Date(r.block_timestamp));
          daily.set(day, (daily.get(day) ?? 0) + eth);
        }
      }
      posByToken.set(token, p);
    }

    let wins = 0;
    let losses = 0;
    let totalPnl = 0;
    for (const p of posByToken.values()) {
      totalPnl += p.realized;
      if (!p.sold) continue;
      if (p.realized > 0) wins += 1;
      else if (p.realized < 0) losses += 1;
    }
    const closed = wins + losses;

    const now = Date.now();
    let d7 = 0;
    let d30 = 0;
    for (const [day, pnl] of daily) {
      const age = now - (new Date(`${day}T00:00:00Z`).getTime() - 8 * 3600_000);
      if (age <= 7 * 86400_000) d7 += pnl;
      if (age <= 30 * 86400_000) d30 += pnl;
    }

    const monthly = new Map<string, number>();
    for (const [day, pnl] of daily) {
      const m = day.slice(0, 7);
      monthly.set(m, (monthly.get(m) ?? 0) + pnl);
    }

    return NextResponse.json({
      address,
      winrate: {
        wins,
        losses,
        closed,
        pct: closed > 0 ? Math.round((wins / closed) * 1000) / 10 : null,
      },
      pnl: {
        d7: d7.toFixed(8),
        d30: d30.toFixed(8),
        total: totalPnl.toFixed(8),
      },
      daily: [...daily.entries()].map(([date, pnl]) => ({ date, pnl: pnl.toFixed(8) })),
      monthly: [...monthly.entries()].map(([month, pnl]) => ({ month, pnl: pnl.toFixed(8) })),
      tradeCount: rows.length,
      note: "已实现 PNL(加权平均成本),不含未平仓浮动盈亏",
    });
  } catch (e) {
    return apiError(e);
  }
}
