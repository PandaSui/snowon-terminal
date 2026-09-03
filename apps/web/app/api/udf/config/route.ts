import { NextResponse } from "next/server";

/** TradingView UDF: 配置端点 */
export async function GET() {
  return NextResponse.json({
    supported_resolutions: ["1", "5", "15", "60", "240", "1D"],
    supports_group_request: false,
    supports_marks: false,
    supports_search: false,
    supports_timescale_marks: false,
  });
}
