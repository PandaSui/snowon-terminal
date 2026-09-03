import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { getAdapter } from "@/lib/adapter";

/**
 * GET /api/quote?token=0x..&side=buy&amount=10000000000000000
 * amount: buy = ETH wei;sell = token base units
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const token = q.get("token") as Address;
    const side = q.get("side");
    const amount = BigInt(q.get("amount") ?? "0");
    const adapter = await getAdapter();
    const quote = side === "buy" ? await adapter.quoteBuy(token, amount) : await adapter.quoteSell(token, amount);
    return NextResponse.json({
      amountIn: quote.amountIn.toString(),
      amountOut: quote.amountOut.toString(),
      effectivePriceEth: quote.effectivePriceEth.toString(),
      priceImpactBps: quote.priceImpactBps,
      totalFeeBps: quote.totalFeeBps,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
