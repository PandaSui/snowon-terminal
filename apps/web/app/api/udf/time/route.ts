import { NextResponse } from "next/server";

/** TradingView UDF: 服务器时间 */
export async function GET() {
  return NextResponse.json(Math.floor(Date.now() / 1000));
}
