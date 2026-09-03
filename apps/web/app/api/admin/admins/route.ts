import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { adminWallets } from "@terminal/db";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { envAdminWallets, isAdminWallet, listAdminWallets } from "@/lib/admins";

/**
 * 管理员名单管理。
 * GET    /api/admin/admins   合并名单(env 主管理员 ∪ DB 协管员),公开只读
 * POST   /api/admin/admins   添加协管员 { address }(需 x-admin-wallet 命中名单)
 * DELETE /api/admin/admins?address=0x…  移除协管员(env 主管理员不可移除)
 *
 * 鉴权说明(开发阶段):与 /api/admin/chains 相同的 x-admin-wallet 名单拦截,
 * 正式环境应换成 Privy access token 验签。
 */

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

async function checkAdmin(req: NextRequest): Promise<NextResponse | null> {
  const wallet = (req.headers.get("x-admin-wallet") ?? "").toLowerCase();
  if (!ADDR_RE.test(wallet) || !(await isAdminWallet(wallet))) {
    return NextResponse.json({ error: "非管理员钱包,无权管理管理员名单" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const admins = await listAdminWallets();
    return NextResponse.json({ admins });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  const deny = await checkAdmin(req);
  if (deny) return deny;
  try {
    const body = (await req.json()) as { address?: string };
    const address = (body.address ?? "").trim().toLowerCase();
    if (!ADDR_RE.test(address)) {
      return NextResponse.json({ error: "address 不是合法钱包地址" }, { status: 400 });
    }
    if (envAdminWallets().includes(address)) {
      return NextResponse.json({ error: "该地址已是主管理员(env 配置),无需重复添加" }, { status: 409 });
    }
    const operator = (req.headers.get("x-admin-wallet") ?? "").toLowerCase();
    const [created] = await db
      .insert(adminWallets)
      .values({ address, addedBy: operator })
      .onConflictDoNothing()
      .returning();
    if (!created) return NextResponse.json({ error: "该地址已是管理员" }, { status: 409 });
    return NextResponse.json({ ok: true, address });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  const deny = await checkAdmin(req);
  if (deny) return deny;
  try {
    const address = (req.nextUrl.searchParams.get("address") ?? "").trim().toLowerCase();
    if (!ADDR_RE.test(address)) {
      return NextResponse.json({ error: "address 不是合法钱包地址" }, { status: 400 });
    }
    if (envAdminWallets().includes(address)) {
      return NextResponse.json({ error: "主管理员(env 配置)不可在此移除,请修改配置文件" }, { status: 400 });
    }
    const removed = await db.delete(adminWallets).where(eq(adminWallets.address, address)).returning();
    if (removed.length === 0) return NextResponse.json({ error: "该地址不在协管员名单中" }, { status: 404 });
    return NextResponse.json({ ok: true, address });
  } catch (e) {
    return apiError(e);
  }
}
