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
