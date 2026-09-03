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

async function fromOkx() {
  const r = await fetch("https://www.okx.com/api/v5/market/ticker?instId=ETH-USDT", { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`okx ${r.status}`);
  const j = (await r.json()) as { data?: { last: string; open24h: string }[] };
  const d = j.data?.[0];
  if (!d) throw new Error("okx empty");
  const price = Number(d.last);
  const open = Number(d.open24h);
  return { price, change24hPct: open > 0 ? ((price - open) / open) * 100 : 0 };
}

async function fromCoinbase() {
  const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`coinbase ${r.status}`);
  const j = (await r.json()) as { data?: { amount: string } };
  const price = Number(j.data?.amount);
  if (!Number.isFinite(price) || price <= 0) throw new Error("coinbase empty");
  return { price, change24hPct: 0 };
}

async function fromGateio() {
  const r = await fetch("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=ETH_USDT", { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`gateio ${r.status}`);
  const j = (await r.json()) as { last: string; change_percentage: string }[];
  const d = j[0];
  if (!d) throw new Error("gateio empty");
  return { price: Number(d.last), change24hPct: Number(d.change_percentage) };
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache, cached: true });
  }
  try {
    // Gate.io 国内直连最稳,其余做回退
    const v = await fromGateio()
      .catch(() => fromOkx())
      .catch(() => fromBinance())
      .catch(() => fromCoingecko())
      .catch(() => fromCoinbase());
    if (!Number.isFinite(v.price) || v.price <= 0) throw new Error("bad price");
    cache = { ...v, at: Date.now() };
    return NextResponse.json({ ...cache, cached: false });
  } catch (e) {
    // 上游全挂时回退到旧缓存,实在没有才报错
    if (cache) return NextResponse.json({ ...cache, cached: true, stale: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "price unavailable" }, { status: 502 });
  }
}
