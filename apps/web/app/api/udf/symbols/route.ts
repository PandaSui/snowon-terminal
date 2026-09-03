import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { tokens } from "@terminal/db";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

/** TradingView UDF: symbol 解析。symbol = "{chainId}:{tokenAddress}" */
export async function GET(req: NextRequest) {
  try {
    const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
    const [, address] = symbol.split(":");
    if (!address) return NextResponse.json({ s: "error", errmsg: "unknown symbol" });
    const [t] = await db
      .select()
      .from(tokens)
      .where(and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, address.toLowerCase())))
      .limit(1);
    if (!t) return NextResponse.json({ s: "error", errmsg: "unknown symbol" });

    return NextResponse.json({
      s: "ok",
      name: t.symbol,
      ticker: symbol,
      description: `${t.name} (${t.symbol})`,
      type: "crypto",
      session: "24x7",
      timezone: "Etc/UTC",
      exchange: "SnowOn",
      minmov: 1,
      pricescale: 1e10,
      has_intraday: true,
      has_daily: true,
      supported_resolutions: ["1", "5", "15", "60", "240", "1D"],
      volume_precision: 4,
      data_status: "streaming",
    });
  } catch (e) {
    return apiError(e);
  }
}
