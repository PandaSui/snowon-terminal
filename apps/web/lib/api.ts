import { NextResponse } from "next/server";

export function apiError(e: unknown, status = 500) {
  // postgres.js 的连接错误(ECONNREFUSED 等)message 为空,带上 code 才能定位
  const err = e as Error & { code?: string };
  const message = (e instanceof Error && e.message) || err?.code || String(e);
  return NextResponse.json({ error: message }, { status });
}

