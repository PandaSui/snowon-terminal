"use client";

import { apiUrl } from "@/lib/apiBase";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { fmtQuote, type QuoteUnit } from "@/lib/quoteUnit";
import { useT } from "@/lib/locale";

interface PoolInfo {
  symbol: string;
  quoteSymbol: string;
  pair?: string;
  quoteIsEth?: boolean;
  graduated: boolean;
  locked: boolean;
  current: { quote: string | null; token: string | null } | null;
  initial: { quote: string | null; token: string | null } | null;
}

function fmtTok(s: string | null | undefined) {
  if (s == null || s === "") return "-";
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 4 });
}

function Pair({
  label,
  quote,
  token,
  quoteSymbol,
  tokenSymbol,
  unit,
  ethUsd,
  quoteIsEth,
}: {
  label: string;
  quote: string | null;
  token: string | null;
  quoteSymbol: string;
  tokenSymbol: string;
  unit: QuoteUnit;
  ethUsd?: number;
  quoteIsEth?: boolean;
}) {
  const qn = quote == null ? NaN : Number(quote);
  const quoteText = !Number.isFinite(qn) || qn <= 0
    ? null
    : quoteIsEth || quoteSymbol === "ETH"
      ? fmtQuote(String(Math.round(qn * 1e18)), unit, ethUsd)
      : `${fmtTok(quote)} ${quoteSymbol}`;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
      <span style={{ color: "#5e6673" }}>{label}</span>
      {quoteText && (
        <>
          <b style={{ color: "#f0b90b" }}>{quoteText}</b>
          <span style={{ color: "#3d4450" }}>↔</span>
        </>
      )}
      <b style={{ color: "#eaecef" }}>{fmtTok(token)} {tokenSymbol}</b>
    </span>
  );
}

export function PoolPairBar({ address, unit, ethUsd }: { address: string; unit: QuoteUnit; ethUsd?: number }) {
  const tr = useT();
  const { data } = useQuery({
    queryKey: ["token-pool", address],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/pool`));
      return readJson<PoolInfo>(res);
    },
    refetchInterval: 20_000,
  });
  if (!data) return null;
  const pair = data.pair ?? `${data.symbol}/${data.quoteSymbol}`;
  const quoteIsEth = data.quoteIsEth !== false && data.quoteSymbol === "ETH";

  return (
    <div
      style={{
        padding: "6px 10px", borderBottom: "1px solid #1e2329", fontSize: 11, color: "#848e9c",
        display: "flex", flexWrap: "wrap", gap: "6px 16px", alignItems: "center", flexShrink: 0,
        background: "#10141b",
      }}
    >
      <span style={{ fontWeight: 800, color: "#eaecef" }}>{pair}</span>
      {data.current ? (
        <Pair
          label={tr("livePool")}
          quote={data.current.quote}
          token={data.current.token}
          quoteSymbol={data.quoteSymbol}
          tokenSymbol={data.symbol}
          unit={unit}
          ethUsd={ethUsd}
          quoteIsEth={quoteIsEth}
        />
      ) : (
        <span>{data.graduated ? tr("poolLoading") : tr("curveBuyEth")}</span>
      )}
      {data.initial && (
        <Pair
          label={data.locked ? tr("gradLock") : tr("initPool")}
          quote={data.initial.quote}
          token={data.initial.token}
          quoteSymbol={data.quoteSymbol}
          tokenSymbol={data.symbol}
          unit={unit}
          ethUsd={ethUsd}
          quoteIsEth={quoteIsEth}
        />
      )}
      {data.locked && <span style={{ color: "#0ecb81", fontWeight: 700 }}>{tr("lpPermLock")}</span>}
    </div>
  );
}
