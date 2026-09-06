import { NextResponse, type NextRequest } from "next/server";
import { getAppSettings, updateAppSettings, SNOW_TOKEN, type AppSettings } from "@terminal/db";
import { isAdminWallet } from "@/lib/admins";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET() {
  const s = await getAppSettings(db);
  return NextResponse.json({ ...s, snowToken: SNOW_TOKEN });
}

export async function PUT(req: NextRequest) {
  const wallet = (req.headers.get("x-admin-wallet") ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || !(await isAdminWallet(wallet))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<AppSettings>;
  const patch: Partial<AppSettings> = {};

  if (body.pinPriceSnow != null) {
    const p = String(body.pinPriceSnow).trim();
    if (!/^\d+$/.test(p) || BigInt(p) <= 0n) {
      return NextResponse.json({ error: "价格须为正整数 SNOW" }, { status: 400 });
    }
    patch.pinPriceSnow = p;
  }
  if (body.pinDurationSec != null) {
    const d = Number(body.pinDurationSec);
    if (!Number.isInteger(d) || d < 10 || d > 86_400) {
      return NextResponse.json({ error: "时长须为 10~86400 秒" }, { status: 400 });
    }
    patch.pinDurationSec = d;
  }
  if (body.pinMax != null) {
    const m = Number(body.pinMax);
    if (!Number.isInteger(m) || m < 1 || m > 50) {
      return NextResponse.json({ error: "上限须为 1~50" }, { status: 400 });
    }
    patch.pinMax = m;
  }
  if (body.pinPayee != null) {
    const a = String(body.pinPayee).trim();
    if (!ADDR_RE.test(a)) return NextResponse.json({ error: "收款地址格式错误" }, { status: 400 });
    patch.pinPayee = a;
  }

  const next = await updateAppSettings(db, patch);
  return NextResponse.json({ ...next, snowToken: SNOW_TOKEN });
}
