"use client";

import { useEffect, useState } from "react";

export type QuoteUnit = "eth" | "usd";
export const QUOTE_UNIT_KEY = "quote.unit";
export const QUOTE_UNIT_EVENT = "quote-unit";

export function readQuoteUnit(): QuoteUnit {
  try {
    const v = localStorage.getItem(QUOTE_UNIT_KEY);
    return v === "usd" ? "usd" : "eth";
  } catch {
    return "eth";
  }
}

export function useQuoteUnit(): [QuoteUnit, (u: QuoteUnit) => void] {
  const [unit, setUnit] = useState<QuoteUnit>("eth");
  useEffect(() => {
    setUnit(readQuoteUnit());
    const on = () => setUnit(readQuoteUnit());
    window.addEventListener(QUOTE_UNIT_EVENT, on);
    return () => window.removeEventListener(QUOTE_UNIT_EVENT, on);
  }, []);
  function set(next: QuoteUnit) {
    localStorage.setItem(QUOTE_UNIT_KEY, next);
    setUnit(next);
    window.dispatchEvent(new Event(QUOTE_UNIT_EVENT));
  }
  return [unit, set];
}

/** ethWei 字符串 → 显示金额(ETH 或 USD) */
export function fmtQuote(ethWei: string | number | null | undefined, unit: QuoteUnit, ethUsd?: number): string {
  if (ethWei == null || ethWei === "") return "-";
  const n = typeof ethWei === "number" ? ethWei : Number(ethWei);
  if (!Number.isFinite(n)) return "-";
  const eth = Math.abs(n) >= 1e6 ? n / 1e18 : n;
  if (!Number.isFinite(eth)) return "-";
  const sign = eth < 0 ? "-" : "";
  const a = Math.abs(eth);
  if (unit === "usd") {
    if (!ethUsd || !Number.isFinite(ethUsd) || ethUsd <= 0) return "$-";
    const usd = a * ethUsd;
    if (usd >= 1000) return `${sign}$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (usd >= 1) return `${sign}$${usd.toFixed(2)}`;
    if (usd >= 0.01) return `${sign}$${usd.toFixed(4)}`;
    return `${sign}$${usd.toPrecision(3)}`;
  }
  if (a === 0) return "0 ETH";
  if (a >= 100) return `${sign}${a.toFixed(2)} ETH`;
  if (a >= 1) return `${sign}${a.toFixed(4)} ETH`;
  if (a >= 0.0001) return `${sign}${a.toFixed(6)} ETH`;
  return `${sign}${a.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} ETH`;
}

export function weiToEth(wei: string | null | undefined): number {
  const n = Number(wei ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n / 1e18;
}

function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$-";
  if (usd >= 1) return `$${usd.toFixed(4)}`;
  if (usd >= 0.01) return `$${usd.toFixed(6)}`;
  if (usd >= 0.000001) return `$${usd.toFixed(8)}`;
  const s = usd.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s}`;
}

/** 市值 / 手续费等大额美元：K/M/B 缩写 */
export function fmtUsdCompact(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "$-";
  if (usd === 0) return "$0";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(2)}K`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toPrecision(3)}`;
}

/** 市值(ETH 计价的总量) → 美元 */
export function fmtMcapUsd(mcapEth: string | number | null | undefined, ethUsd?: number): string {
  if (mcapEth == null || mcapEth === "" || !ethUsd || ethUsd <= 0) return "$-";
  const n = typeof mcapEth === "number" ? mcapEth : Number(mcapEth);
  if (!Number.isFinite(n) || n <= 0) return "$-";
  return fmtUsdCompact(n * ethUsd);
}

/** ETH/枚 的价格(非 wei) → ETH 或 USD */
export function fmtPrice(priceEth: string | number | null | undefined, unit: QuoteUnit, ethUsd?: number): string {
  if (priceEth == null || priceEth === "") return "-";
  const n = typeof priceEth === "number" ? priceEth : Number(priceEth);
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (unit === "usd") {
    if (!ethUsd || ethUsd <= 0) return "$-";
    return fmtUsd(n * ethUsd);
  }
  if (n >= 0.0001) return `${n.toFixed(6)} ETH`;
  const s = n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} ETH`;
}

/** 成交价 / 成本价固定美元 */
export function fmtPriceUsd(priceEth: string | number | null | undefined, ethUsd?: number): string {
  return fmtPrice(priceEth, "usd", ethUsd);
}

/** 带正负号的盈亏(ETH 数量,非 wei) */
export function fmtPnl(eth: number, unit: QuoteUnit, ethUsd?: number): string {
  if (!Number.isFinite(eth)) return unit === "usd" ? "$0" : "0 ETH";
  const sign = eth > 0 ? "+" : eth < 0 ? "-" : "";
  const a = Math.abs(eth);
  if (unit === "usd") {
    if (!ethUsd || ethUsd <= 0) return "$-";
    const usd = a * ethUsd;
    if (usd >= 1000) return `${sign}$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (usd >= 1) return `${sign}$${usd.toFixed(2)}`;
    if (usd >= 0.01) return `${sign}$${usd.toFixed(3)}`;
    return `${sign}$${usd.toPrecision(2)}`;
  }
  if (a === 0) return "0 ETH";
  if (a >= 1) return `${sign}${a.toFixed(4)} ETH`;
  if (a >= 0.0001) return `${sign}${a.toFixed(5)} ETH`;
  return `${sign}${a.toPrecision(3)} ETH`;
}

/** 金额(ETH 数量,非 wei):买入金额等 */
export function fmtAmount(eth: number, unit: QuoteUnit, ethUsd?: number): string {
  if (!Number.isFinite(eth) || eth === 0) return unit === "usd" ? "$0" : "0 ETH";
  return fmtQuote(eth, unit, ethUsd);
}
