import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { getAdapter } from "@/lib/adapter";

/**
 * POST /api/build-tx
 * body: { token, side: 'buy'|'sell', amount, minOut, recipient }
 * 返回待签名交易数组(前端用 wagmi / Privy 钱包逐笔签名发送)。
 * adapter 内部按毕业状态自动路由到曲线或 SnowSwapRouter。
 */
export async function POST(req: NextRequest) {
  try {
    const { token, side, amount, minOut, recipient } = await req.json();
    const adapter = await getAdapter();

    const txs =
      side === "buy"
        ? [await adapter.buildBuyTx(token as Address, BigInt(amount), BigInt(minOut), recipient as Address)]
        : await adapter.buildSellTx(token as Address, BigInt(amount), BigInt(minOut), recipient as Address);

    return NextResponse.json(
      txs.map((t) => ({ to: t.to, data: t.data, value: t.value.toString(), chainId: t.chainId })),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
