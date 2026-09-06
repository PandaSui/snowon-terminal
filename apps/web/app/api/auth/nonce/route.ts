import { NextResponse } from "next/server";
import { issueNonce } from "@terminal/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 发一个一次性登录 nonce。 */
export async function GET() {
  try {
    const nonce = await issueNonce(db);
    return NextResponse.json({ nonce });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
