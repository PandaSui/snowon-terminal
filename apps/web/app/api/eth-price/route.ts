import { NextResponse } from "next/server";

/**
 * ETH 实时美元价格。主源 Binance 公共行情(无需 key),备用 CoinGecko。
 * 服务端缓存 15s,前端轮询打不爆上游。
 */
let cache: { price: number; change24hPct: number; at: number } | null = null;
const CACHE_MS = 15_000;

async function fromBinance() {
  const r = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT", { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`binance ${r.status}`);
  const j = (await r.json()) as { lastPrice: string; priceChangePercent: string };
  return { price: Number(j.lastPrice), change24hPct: Number(j.priceChangePercent) };
}

async function fromCoingecko() {
  const r = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true",
    { signal: AbortSignal.timeout(5000) },
  );
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = (await r.json()) as { ethereum: { usd: number; usd_24h_change: number } };
  return { price: j.ethereum.usd, change24hPct: j.ethereum.usd_24h_change };
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache, cached: true });
  }
  try {
    const v = await fromBinance().catch(() => fromCoingecko());
    if (!Number.isFinite(v.price) || v.price <= 0) throw new Error("bad price");
    cache = { ...v, at: Date.now() };
    return NextResponse.json({ ...cache, cached: false });
  } catch (e) {
    // 上游全挂时回退到旧缓存,实在没有才报错
    if (cache) return NextResponse.json({ ...cache, cached: true, stale: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "price unavailable" }, { status: 502 });
  }
}
