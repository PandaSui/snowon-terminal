import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { RES_SECONDS } from "@/lib/chartResolutions";
import { ttlMap } from "@/lib/ttlCache";

const historyCache = ttlMap<string, unknown>(2_000);

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

/**
 * TradingView UDF: 历史 K 线。
 * 关键设计:trades 表对毕业前(curve 事件)和毕业后(pool Swap)统一入库,
 * price_eth 全程 ETH 计价,所以这里的聚合对毕业点天然无感——
 * 跨越毕业时刻的那根 bar 会同时含两段成交,价格连续(合约按终端价建池)。
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const symbol = q.get("symbol") ?? "";
    const resolution = q.get("resolution") ?? "1";
    const from = Number(q.get("from") ?? 0);
    const to = Number(q.get("to") ?? Math.floor(Date.now() / 1000));
    const [, address] = symbol.split(":");
    const res = RES_SECONDS[resolution];
    if (!address || !res) return NextResponse.json({ s: "error", errmsg: "bad params" });

    const cacheKey = `${address.toLowerCase()}:${resolution}`;
    const cached = historyCache.get(cacheKey);
    if (cached) return NextResponse.json(cached);

    const bars = asRows<{ t: string; o: string; h: string; l: string; c: string; v: string; n: string }>(
      await db.execute(sql`
        WITH binned AS (
          SELECT
            (floor(extract(epoch from block_timestamp) / ${res}) * ${res})::bigint AS t,
            price_eth,
            eth_amount,
            block_number,
            log_index
          FROM trades
          WHERE chain_id = ${CHAIN_ID}
            AND token_address = ${address.toLowerCase()}
            AND block_timestamp BETWEEN to_timestamp(${from}) AND to_timestamp(${to})
        ),
        ranked AS (
          SELECT
            t, price_eth, eth_amount,
            row_number() OVER (PARTITION BY t ORDER BY block_number, log_index) AS rn_open,
            row_number() OVER (PARTITION BY t ORDER BY block_number DESC, log_index DESC) AS rn_close
          FROM binned
        )
        SELECT
          t,
          max(price_eth) FILTER (WHERE rn_open = 1) AS o,
          max(price_eth) AS h,
          min(price_eth) AS l,
          max(price_eth) FILTER (WHERE rn_close = 1) AS c,
          sum(eth_amount::numeric) / 1e18 AS v,
          count(*) AS n
        FROM ranked
        GROUP BY t
        ORDER BY t
      `),
    );

    if (bars.length === 0) {
      const empty = { s: "no_data" };
      historyCache.set(cacheKey, empty);
      return NextResponse.json(empty);
    }

    const body = {
      s: "ok",
      t: bars.map((b) => Number(b.t)),
      o: bars.map((b) => Number(b.o)),
      h: bars.map((b) => Number(b.h)),
      l: bars.map((b) => Number(b.l)),
      c: bars.map((b) => Number(b.c)),
      v: bars.map((b) => Number(b.v)),
    };
    historyCache.set(cacheKey, body);
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ s: "error", errmsg: message }, { status: 500 });
  }
}
