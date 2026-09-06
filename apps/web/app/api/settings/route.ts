import { NextResponse } from "next/server";
import { getAppSettings, SNOW_TOKEN } from "@terminal/db";
import { db, CHAIN_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 公开只读:前端拿叮住价格/时长/收款地址/SNOW 代币,用来发起付款。 */
export async function GET() {
  try {
    const s = await getAppSettings(db);
    return NextResponse.json({ ...s, snowToken: SNOW_TOKEN, chainId: CHAIN_ID });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
