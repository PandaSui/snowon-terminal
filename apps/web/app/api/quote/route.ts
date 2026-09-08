import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { getAdapter } from "@/lib/adapter";
import { ttlMap } from "@/lib/ttlCache";

const quoteCache = ttlMap<string, Record<string, string | number>>(1_000, 256);

/**
 * GET /api/quote?token=0x..&side=buy&amount=10000000000000000
 * amount: buy = ETH wei;sell = token base units
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const token = q.get("token") as Address;
    const side = q.get("side");
    const amountRaw = q.get("amount") ?? "0";
    const cacheKey = `${(token ?? "").toLowerCase()}:${side}:${amountRaw}`;
    const cached = quoteCache.get(cacheKey);
    if (cached) return NextResponse.json(cached);
    const amount = BigInt(amountRaw);
    const adapter = await getAdapter(token);
    const quote = side === "buy" ? await adapter.quoteBuy(token, amount) : await adapter.quoteSell(token, amount);
    const body = {
      amountIn: quote.amountIn.toString(),
      amountOut: quote.amountOut.toString(),
      effectivePriceEth: quote.effectivePriceEth.toString(),
      priceImpactBps: quote.priceImpactBps,
      totalFeeBps: quote.totalFeeBps,
    };
    quoteCache.set(cacheKey, body);
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
