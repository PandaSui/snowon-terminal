import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { userProfiles } from "@terminal/db";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

const ADDR_RE = /^0x[0-9a-f]{40}$/;

function cleanUsername(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 24);
  return s || null;
}

function cleanTwitter(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
  return s || null;
}

/** 个人资料:GET ?address=0x… → { wallet, username, twitter } */
export async function GET(req: Request) {
  try {
    const address = (new URL(req.url).searchParams.get("address") ?? "").toLowerCase();
    if (!ADDR_RE.test(address)) return NextResponse.json({ error: "bad address" }, { status: 400 });
    const [row] = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.chainId, CHAIN_ID), eq(userProfiles.wallet, address)))
      .limit(1);
    return NextResponse.json({
      wallet: address,
      username: row?.username ?? null,
      twitter: row?.twitter ?? null,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (e) {
    return apiError(e);
  }
}

/** 修改资料:PUT { address, username?, twitter? }(本地终端信任模型,无签名) */
export async function PUT(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { address?: string; username?: unknown; twitter?: unknown }
      | null;
    const address = (body?.address ?? "").toLowerCase();
    if (!ADDR_RE.test(address)) {
      return NextResponse.json({ error: "bad address" }, { status: 400 });
    }
    const username = cleanUsername(body?.username);
    const twitter = cleanTwitter(body?.twitter);
    await db
      .insert(userProfiles)
      .values({ chainId: CHAIN_ID, wallet: address, username, twitter })
      .onConflictDoUpdate({
        target: [userProfiles.chainId, userProfiles.wallet],
        set: { username, twitter, updatedAt: new Date() },
      });
    return NextResponse.json({ ok: true, wallet: address, username, twitter });
  } catch (e) {
    return apiError(e);
  }
}
