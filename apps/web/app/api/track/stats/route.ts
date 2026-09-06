import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { emptyPnl, loadWalletPnlPack, serializePnl } from "@/lib/walletPnl";

const ADDR_OK = /^0x[0-9a-f]{40}$/;
const MAX = 10_000;

/** 指定地址的 7/15/30 天与总 PNL、胜率。追踪列表批量查询用。 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { addresses?: unknown };
    const raw = Array.isArray(body.addresses) ? body.addresses : [];
    const addrs = [...new Set(
      raw.map((a) => String(a).trim().toLowerCase()).filter((a) => ADDR_OK.test(a)),
    )].slice(0, MAX);
    if (addrs.length === 0) return NextResponse.json({ error: "no addresses" }, { status: 400 });
    const { map } = await loadWalletPnlPack();
    const rows = addrs.map((a) => serializePnl(map.get(a) ?? emptyPnl(a)));
    return NextResponse.json({ rows });
  } catch (e) {
    return apiError(e);
  }
}
