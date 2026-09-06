import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { fetchNativeBalances } from "@/lib/nativeBalances";

const ADDR_OK = /^0x[0-9a-f]{40}$/;
const MAX = 80;

function parseAddrs(req: Request, extra: string[] = []): string[] {
  const q = new URL(req.url).searchParams.get("addresses") ?? "";
  const fromQuery = q.split(/[,\s]+/);
  return [...new Set([...fromQuery, ...extra].map((a) => a.trim().toLowerCase()).filter((a) => ADDR_OK.test(a)))].slice(0, MAX);
}

/** 钱包原生 ETH 余额。单次最多 80 个,避免打爆 RPC。 */
export async function GET(req: Request) {
  try {
    const addrs = parseAddrs(req);
    if (addrs.length === 0) return NextResponse.json({ error: "no addresses" }, { status: 400 });
    const balances = await fetchNativeBalances(addrs);
    return NextResponse.json({ balances });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { addresses?: unknown };
    const extra = Array.isArray(body.addresses) ? body.addresses.map(String) : [];
    const addrs = parseAddrs(req, extra);
    if (addrs.length === 0) return NextResponse.json({ error: "no addresses" }, { status: 400 });
    const balances = await fetchNativeBalances(addrs);
    return NextResponse.json({ balances });
  } catch (e) {
    return apiError(e);
  }
}
