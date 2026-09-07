/**
 * ETH/USDT 现价(Binance,60s 缓存)。
 * 用于弹幕购买门槛的 USD 换算。失败时返回最后一次成功的价格;
 * 从未成功过返回 null —— 调用方应放行(fail-open,宁可误放不可误杀)。
 */
let cached: { price: number; at: number } | null = null;

export async function ethPriceUsd(): Promise<number | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.price;
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) throw new Error(`binance ${r.status}`);
    const j = (await r.json()) as { price?: string };
    const price = Number(j.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error("bad price");
    cached = { price, at: Date.now() };
    return price;
  } catch (e) {
    console.error("[price] eth price fetch failed:", (e as Error).message);
    return cached?.price ?? null;
  }
}
