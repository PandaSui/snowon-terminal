import { NextResponse } from "next/server";
import { getAppSettings, SNOW_TOKEN } from "@terminal/db";
import { db, CHAIN_ID } from "@/lib/db";
import { getChainConfig } from "@/lib/chainConfigs";

export const dynamic = "force-dynamic";

/** 公开只读:前端拿叮住价格/时长/收款地址/SNOW 代币,用来发起付款。 */
export async function GET() {
  try {
    const s = await getAppSettings(db);
    const chain = await getChainConfig(CHAIN_ID).catch(() => undefined);
    return NextResponse.json({
      ...s,
      snowToken: SNOW_TOKEN,
      chainId: CHAIN_ID,
      snowonEnabled: chain?.snowonEnabled !== false,
      ponsEnabled: chain?.ponsEnabled !== false,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
