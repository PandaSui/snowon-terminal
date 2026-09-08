import type { NextRequest } from "next/server";
import { verifySession } from "@terminal/db";
import { isAdminWallet } from "@/lib/admins";

export function bearer(req: NextRequest): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * 校验会话令牌 + 管理员身份。返回验签得到的可信地址,或 null(未登录/非管理员)。
 * 取代旧的可伪造 `x-admin-wallet` 头。
 */
export async function requireAdmin(req: NextRequest): Promise<string | null> {
  const addr = verifySession(bearer(req));
  if (!addr) return null;
  return (await isAdminWallet(addr)) ? addr : null;
}

/** 带原因的管理员校验,方便前端展示「未登录」还是「不是管理员」。 */
export async function requireAdminReason(req: NextRequest): Promise<{ addr: string } | { error: string; status: number }> {
  const raw = bearer(req);
  if (!raw || raw === "null" || raw === "undefined") {
    return { error: "请先用管理员钱包签名登录", status: 401 };
  }
  const addr = verifySession(raw);
  if (!addr) return { error: "登录已过期,请重新签名登录", status: 401 };
  if (!(await isAdminWallet(addr))) {
    return { error: `当前签名钱包 ${addr.slice(0, 6)}…${addr.slice(-4)} 不在管理员名单`, status: 403 };
  }
  return { addr };
}
