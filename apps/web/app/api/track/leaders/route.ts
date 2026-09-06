import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { loadWalletPnlPack, serializePnl, sortLeaders, type LeaderSort } from "@/lib/walletPnl";

const SORTS = new Set<LeaderSort>(["pnl7", "pnl15", "pnl30", "pnlTotal", "wr7", "wr15", "wr30", "wrTotal", "trades"]);
const MAX = 2000;

/** 交易盈利地址排行:7/15/30 天与总 PNL、胜率。 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const sort = (SORTS.has(q.get("sort") as LeaderSort) ? q.get("sort") : "pnlTotal") as LeaderSort;
    const dir = q.get("dir") === "asc" ? "asc" : "desc";
    const filter = q.get("filter") === "all" ? "all" : "profit";
    const limit = Math.min(MAX, Math.max(1, Number(q.get("limit") ?? 500) || 500));
    const { list } = await loadWalletPnlPack();
    const base = filter === "profit" ? list.filter((w) => w.pnlTotal > 0) : list;
    const ranked = sortLeaders(base, sort, dir).slice(0, limit);
    return NextResponse.json({
      total: base.length,
      sort,
      dir,
      filter,
      rows: ranked.map(serializePnl),
    });
  } catch (e) {
    return apiError(e);
  }
}
