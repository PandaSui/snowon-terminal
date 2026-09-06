"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { readJson } from "@/lib/http";
import { AppNav } from "@/components/AppNav";
import { SearchBox } from "@/components/SearchBox";
import { AiPanel } from "@/components/AiPanel";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { FavoritesBar } from "@/components/FavoritesBar";
import { TokenLogo } from "@/components/TokenLogo";
import { useAdmins } from "@/lib/useAdmins";
import { useIsMobile } from "@/lib/useIsMobile";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TranslatedText } from "@/lib/useTranslated";
import { formatTimeAgo, t as tr, useLocale } from "@/lib/locale";
import type { HomeToken } from "@/components/TokenCard";

const WINDOWS = [
  { key: "1m", label: "1m" },
  { key: "5m", label: "5m" },
  { key: "30m", label: "30m" },
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];
type SortKey = "time" | "mcap" | "vol";

interface HotToken {
  address: string;
  name: string;
  symbol: string;
  logoUri: string | null;
  graduated: boolean;
  createdAt: string;
  mcapEth: string | null;
  priceEth: string | null;
  volumeEth: string | null;
  trades: number;
  lastAt: string;
}

const btnStyle: React.CSSProperties = {
  background: "#f0b90b", border: 0, borderRadius: 6, padding: "7px 14px",
  fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
};

function fmtUsd(ethAmt: string | null, ethUsd?: number): string {
  if (!ethAmt || !ethUsd) return "-";
  const v = Number(ethAmt) * ethUsd;
  if (!Number.isFinite(v) || v <= 0) return "-";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}



export default function HotPage() {
  const [locale] = useLocale();
  const { login, logout, authenticated, user } = usePrivy();
  const isMobile = useIsMobile();
  const wallet = user?.wallet?.address?.toLowerCase() ?? "";
  const isAdmin = useAdmins(wallet).isAdmin;
  const [windowKey, setWindowKey] = useState<WindowKey>("5m");
  const [sort, setSort] = useState<SortKey>("vol");

  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });

  const { data: tokens } = useQuery({
    queryKey: ["tokens"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/tokens"));
      const body = await readJson<HomeToken[] | { error?: string }>(res);
      return Array.isArray(body) ? body : [];
    },
    staleTime: 8_000,
  });

  const { data: rows, isFetching } = useQuery({
    queryKey: ["hot-tokens", windowKey],
    refetchInterval: 8_000,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/tokens/hot?window=${windowKey}`));
      const body = await readJson<HotToken[] | { error?: string }>(res);
      return Array.isArray(body) ? body : [];
    },
  });

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    list.sort((a, b) => {
      if (sort === "mcap") return Number(b.mcapEth ?? 0) - Number(a.mcapEth ?? 0);
      if (sort === "time") return +new Date(b.lastAt) - +new Date(a.lastAt);
      return Number(b.volumeEth ?? 0) - Number(a.volumeEth ?? 0);
    });
    return list;
  }, [rows, sort]);

  const chip = (on: boolean): React.CSSProperties => ({
    padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
    border: 0, borderRadius: 6,
    background: on ? "#f0b90b" : "#1e2329",
    color: on ? "#000" : "#848e9c",
  });

  return (
    <main style={{ minHeight: "calc(100vh - 44px)", padding: isMobile ? "8px 8px" : "10px 14px", display: "flex", flexDirection: "column", gap: 8, boxSizing: "border-box" }}>
      <header className="site-header" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1 style={{ fontSize: isMobile ? 15 : 18, margin: 0, fontWeight: 800, whiteSpace: "nowrap" }}>
            SnowOn <span style={{ color: "#f0b90b" }}>Terminal</span>
          </h1>
        </Link>
        <AppNav current="hot" />
        {isAdmin && (
          <Link href="/admin" className="desktop-only" style={{ color: "#848e9c", textDecoration: "none", fontSize: 13 }}>{tr(locale, "admin")}</Link>
        )}
        <div className="search-wrap" style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <SearchBox />
        </div>
        <AiPanel />
        <PortfolioPanel />
        <LanguageSwitcher />
        <button onClick={authenticated ? logout : login} style={btnStyle}>
          {authenticated ? `${user?.wallet?.address?.slice(0, 6) ?? user?.email ?? ""}…` : tr(locale, "wallet")}
        </button>
      </header>

      <FavoritesBar tokens={tokens ?? []} />

      <section
        style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
          border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", overflow: "hidden",
        }}
      >
        <header style={{ padding: "12px 14px", borderBottom: "1px solid #1e2329", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{tr(locale, "hotBoard")}</span>
          <span style={{ fontSize: 12, color: "#5e6673" }}>{tr(locale, "hotSub")}</span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {WINDOWS.map((w) => (
              <button key={w.key} type="button" onClick={() => setWindowKey(w.key)} style={chip(windowKey === w.key)}>
                {w.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
            {([
              ["time", "sortTime"],
              ["mcap", "sortMcap"],
              ["vol", "sortVol"],
            ] as const).map(([k, labelKey]) => (
              <button key={k} type="button" onClick={() => setSort(k)} style={chip(sort === k)}>
                {tr(locale, "sortBy", { label: tr(locale, labelKey) })}
              </button>
            ))}
          </div>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "32px 1fr auto" : "40px 1fr 120px 120px 88px",
            gap: 8,
            padding: "8px 16px",
            fontSize: 11,
            color: "#5e6673",
            borderBottom: "1px solid #161b22",
          }}
        >
          <span>#</span>
          <span>{tr(locale, "token")}</span>
          {!isMobile && <span style={{ textAlign: "right" }}>{tr(locale, "mcap")}</span>}
          <span style={{ textAlign: "right" }}>{tr(locale, "turnover")}</span>
          {!isMobile && <span style={{ textAlign: "right" }}>{tr(locale, "lastTrade")}</span>}
        </div>

        <div className="col-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 8px 12px" }}>
          {isFetching && !rows && (
            <div style={{ color: "#5e6673", fontSize: 13, textAlign: "center", marginTop: 40 }}>{tr(locale, "loading")}</div>
          )}
          {sorted.length === 0 && !isFetching && (
            <div style={{ color: "#5e6673", fontSize: 13, textAlign: "center", marginTop: 40 }}>{tr(locale, "noTradesWindow")}</div>
          )}
          {sorted.map((t, i) => (
            <Link
              key={t.address}
              href={`/token/${t.address}`}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "32px 1fr auto" : "40px 1fr 120px 120px 88px",
                gap: 8,
                alignItems: "center",
                padding: "10px 8px",
                textDecoration: "none",
                color: "inherit",
                borderRadius: 8,
                borderBottom: "1px solid #161b22",
              }}
            >
              <span style={{ fontSize: 13, color: i < 3 ? "#f0b90b" : "#5e6673", fontWeight: i < 3 ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>
                {i + 1}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <TokenLogo src={t.logoUri} alt={t.symbol} size={28} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{t.symbol}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#5e6673", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <TranslatedText text={t.name} />
                    {t.graduated ? ` · ${tr(locale, "graduatedTag")}` : ""}
                  </span>
                </span>
              </span>
              {!isMobile && (
                <span style={{ textAlign: "right", fontSize: 13, color: "#848e9c", fontVariantNumeric: "tabular-nums" }}>
                  {fmtUsd(t.mcapEth, eth?.price)}
                </span>
              )}
              <span style={{ textAlign: "right", fontSize: 13, fontWeight: 800, color: "#f0b90b", fontVariantNumeric: "tabular-nums" }}>
                {fmtUsd(t.volumeEth, eth?.price)}
              </span>
              {!isMobile && (
                <span style={{ textAlign: "right", fontSize: 12, color: "#5e6673" }}>{formatTimeAgo(t.lastAt, locale)}</span>
              )}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
