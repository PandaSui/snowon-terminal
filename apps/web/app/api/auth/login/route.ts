import { NextResponse, type NextRequest } from "next/server";
import { verifyMessage } from "viem";
import { consumeNonce, signSession } from "@terminal/db";
import { db } from "@/lib/db";
import { buildLoginMessage } from "@/lib/authShared";

export const dynamic = "force-dynamic";

/** 验签登录:消费 nonce + 校验签名 → 返回会话令牌。 */
export async function POST(req: NextRequest) {
  const { address, nonce, signature } = (await req.json().catch(() => ({}))) as {
    address?: string;
    nonce?: string;
    signature?: string;
  };
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address) || !nonce || !signature) {
    return NextResponse.json({ error: "参数缺失" }, { status: 400 });
  }
  // nonce 一次性消费(防重放)
  if (!(await consumeNonce(db, nonce))) {
    return NextResponse.json({ error: "nonce 无效或已过期,请重试" }, { status: 401 });
  }
  const ok = await verifyMessage({
    address: address as `0x${string}`,
    message: buildLoginMessage(address, nonce),
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!ok) return NextResponse.json({ error: "验签失败" }, { status: 401 });

  return NextResponse.json({ token: signSession(address), address: address.toLowerCase() });
}
