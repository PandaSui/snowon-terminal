"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { readJson } from "@/lib/http";
import { useGlobalChat } from "@/lib/useGlobalChat";
import { TokenCard, type HomeToken } from "@/components/TokenCard";
import { PinBar } from "@/components/PinBar";
import { HomeChat } from "@/components/HomeChat";
import { SearchBox } from "@/components/SearchBox";
import { AiPanel } from "@/components/AiPanel";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { FavoritesBar } from "@/components/FavoritesBar";
import { AppNav } from "@/components/AppNav";
import { ColumnFilterButton, EMPTY_FILTER, applyFilters, type ColumnFilter } from "@/components/ColumnFilters";
import { useIsMobile } from "@/lib/useIsMobile";
import { useAdmins } from "@/lib/useAdmins";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { t, useLocale } from "@/lib/locale";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
const PLATFORM_KEY = "ui.platform";
type PlatformFilter = "all" | "snowon" | "pons";

function readPlatform(): PlatformFilter {
  try {
    const v = localStorage.getItem(PLATFORM_KEY);
    if (v === "snowon" || v === "pons" || v === "all") return v;
  } catch { /* ignore */ }
  return "all";
}

function tokenPlatform(t: HomeToken): "pons" | "snowon" {
  return t.platformId === "pons" ? "pons" : "snowon";
}

async function fetchTokens(): Promise<HomeToken[]> {
  const res = await fetch(apiUrl("/api/tokens"));
  const body = await readJson<HomeToken[] | { error?: string }>(res);
  if (!res.ok || !Array.isArray(body)) {
    throw new Error((body as { error?: string }).error ?? `load failed (${res.status})`);
  }
  return body;
}

/** 栏目容器:标题 + 计数 + 独立筛选 + 滚动列表 */
function Column({
  title, dot, tokens, empty, ethUsd, showMultiplier,
}: {
  title: string; dot: string; tokens: HomeToken[]; empty: string; ethUsd?: number; showMultiplier?: boolean;
}) {
  const [filters, setFilters] = useState<ColumnFilter>(EMPTY_FILTER);
  const shown = applyFilters(tokens, filters, ethUsd);
  return (
    <section style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #1e2329", flexShrink: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: dot }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#5e6673", background: "#1e2329", borderRadius: 8, padding: "1px 8px" }}>
          {shown.length}
        </span>
        <ColumnFilterButton value={filters} onChange={setFilters} />
      </header>
      <div className="col-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 10px", minHeight: 0 }}>
        {shown.length === 0 ? (
          <div style={{ color: "#5e6673", fontSize: 12, textAlign: "center", marginTop: 24 }}>{empty}</div>
        ) : (
          shown.slice(0, 40).map((tok) => <TokenCard key={tok.address} t={tok} showMultiplier={showMultiplier} />)
        )}
      </div>
    </section>
  );
}

export default function DiscoverPage() {
  const [locale] = useLocale();
  const { login, logout, authenticated, user } = usePrivy();
  const { data: tokens } = useQuery({
    queryKey: ["tokens"],
    queryFn: fetchTokens,
    refetchInterval: 12_000,
    staleTime: 8_000,
  });
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });
  const chat = useGlobalChat(CHAIN_ID);
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<"movers" | "fresh" | "almost" | "graduated" | "chat">("movers");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  useEffect(() => {
    setPlatform(readPlatform());
  }, []);
  function pickPlatform(next: PlatformFilter) {
    setPlatform(next);
    try { localStorage.setItem(PLATFORM_KEY, next); } catch { /* ignore */ }
  }

  // 管理员钱包(env 主管理员 ∪ DB 协管员)才显示「管理」入口
  const wallet = user?.wallet?.address?.toLowerCase() ?? "";
  const isAdmin = useAdmins(wallet).isAdmin;

  const lists = useMemo(() => {
    const all = (tokens ?? []).filter((t) => platform === "all" || tokenPlatform(t) === platform);
    const num = (v: string | null) => (v == null ? -Infinity : Number(v));
    return {
      // 异动代币:以毕业代币为主,按市值飙升(24h 涨幅)排序
      movers: all.filter((t) => t.graduated).sort((a, b) => num(b.change24hPct) - num(a.change24hPct)),
      // 新创建:未毕业,按创建时间倒序
      fresh: all.filter((t) => !t.graduated).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
      // 即将毕业:未毕业且有进度,按毕业进度倒序
      almost: all
        .filter((t) => !t.graduated && Number(t.graduationProgress ?? 0) > 0)
        .sort((a, b) => Number(b.graduationProgress ?? 0) - Number(a.graduationProgress ?? 0)),
      // 毕业代币:按毕业时间倒序
      graduated: all
        .filter((t) => t.graduated)
        .sort((a, b) => +new Date(b.graduatedAt ?? b.createdAt) - +new Date(a.graduatedAt ?? a.createdAt)),
    };
  }, [tokens, platform]);

  const columns = [
    { key: "movers" as const, title: t(locale, "movers"), short: t(locale, "movers"), dot: "#f6465d", tokens: lists.movers, empty: "—" },
    { key: "fresh" as const, title: t(locale, "fresh"), short: t(locale, "fresh"), dot: "#f0b90b", tokens: lists.fresh, empty: "—" },
    { key: "almost" as const, title: t(locale, "almost"), short: t(locale, "almost"), dot: "#0ecb81", tokens: lists.almost, empty: "—" },
    { key: "graduated" as const, title: t(locale, "graduated"), short: t(locale, "graduated"), dot: "#00c3ff", tokens: lists.graduated, empty: "—" },
  ];

  const chatSection = (
    <section style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #1e2329", flexShrink: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: "#b15bff" }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{t(locale, "chat")}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#5e6673", background: "#1e2329", borderRadius: 8, padding: "1px 8px" }}>
          {chat.messages.length}
        </span>
      </header>
      {/* 钉住消息展示区:付费 20U/2分钟,最多 5 条上翻轮换 */}
      <div style={{ padding: "6px 8px 0", flexShrink: 0 }}>
        <PinBar pins={chat.pins} />
      </div>
      <HomeChat
        messages={chat.messages}
        pins={chat.pins}
        connected={chat.connected}
        lastError={chat.lastError}
        onSend={chat.send}
        onPin={chat.pin}
        pinning={chat.pinning}
        signedIn={chat.signedIn}
        signIn={chat.signIn}
        signing={chat.signing}
      />
    </section>
  );

  return (
    <main style={{ height: "calc(100vh - 44px)", display: "flex", flexDirection: "column", padding: isMobile ? "8px 8px" : "10px 14px", gap: 8, boxSizing: "border-box" }}>
      {/* 顶部栏:logo + 导航 + 搜索 + AI + 资产 + 钱包 */}
      <header className="site-header" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <h1 style={{ fontSize: isMobile ? 15 : 18, margin: 0, fontWeight: 800, whiteSpace: "nowrap" }}>
          SnowOn <span style={{ color: "#f0b90b" }}>Terminal</span>
        </h1>
        <AppNav current="discover" />
        {isAdmin && (
          <Link href="/admin" className="desktop-only" style={{ color: "#848e9c", textDecoration: "none", fontSize: 13 }}>{t(locale, "admin")}</Link>
        )}
        <div className="search-wrap" style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <SearchBox />
        </div>
        <AiPanel />
        <PortfolioPanel />
        <LanguageSwitcher />
        <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#5e6673" }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: chat.connected ? "#0ecb81" : "#f6465d" }} />
          {chat.connected ? t(locale, "connected") : t(locale, "disconnected")}
        </div>
        <button onClick={authenticated ? logout : login} style={btnStyle}>
          {authenticated ? `${user?.wallet?.address?.slice(0, 6) ?? user?.email ?? ""}…` : t(locale, "wallet")}
        </button>
      </header>

      {/* 标星收藏代币栏 */}
      <FavoritesBar tokens={(tokens ?? []).filter((t) => platform === "all" || tokenPlatform(t) === platform)} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#5e6673", fontWeight: 700 }}>{t(locale, "platform")}</span>
        {([
          ["all", t(locale, "all")],
          ["snowon", t(locale, "platformSnowon")],
          ["pons", t(locale, "platformPons")],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => pickPlatform(key)}
            style={{
              padding: "3px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer",
              borderRadius: 6,
              border: `1px solid ${platform === key ? (key === "pons" ? "#00c3ff" : "#f0b90b") : "#2b3139"}`,
              background: platform === key ? "#1c1f26" : "transparent",
              color: platform === key ? (key === "pons" ? "#00c3ff" : "#f0b90b") : "#848e9c",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {isMobile ? (
        <>
          {/* 移动端:单视图 + 底部 Tab */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {tab === "chat"
              ? chatSection
              : (() => {
                  const col = columns.find((c) => c.key === tab)!;
                  return <Column title={col.title} dot={col.dot} tokens={col.tokens} empty={col.empty} ethUsd={eth?.price} showMultiplier={col.key === "movers"} />;
                })()}
          </div>
          <nav
            style={{
              flexShrink: 0, display: "flex", border: "1px solid #1e2329", borderRadius: 10,
              background: "#0d1117", overflow: "hidden",
            }}
          >
            {columns.map((c) => (
              <button key={c.key} onClick={() => setTab(c.key)} style={tabStyle(tab === c.key)}>
                {c.short}
              </button>
            ))}
            <button onClick={() => setTab("chat")} style={tabStyle(tab === "chat")}>
              {t(locale, "tabChat")}
            </button>
          </nav>
        </>
      ) : (
        /* 桌面端:五栏 */
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr)) minmax(280px, 340px)",
            gap: 10,
          }}
        >
          {columns.map((c) => (
            <Column key={c.key} title={c.title} dot={c.dot} tokens={c.tokens} empty={c.empty} ethUsd={eth?.price} showMultiplier={c.key === "movers"} />
          ))}
          {chatSection}
        </div>
      )}

    </main>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: "1 1 0", minWidth: 0, width: 0, padding: "10px 2px", fontSize: 11, fontWeight: 700, cursor: "pointer",
    border: 0, background: active ? "#1c1f26" : "transparent",
    color: active ? "#f0b90b" : "#5e6673",
    borderTop: `2px solid ${active ? "#f0b90b" : "transparent"}`,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  };
}

const btnStyle: React.CSSProperties = {
  background: "#f0b90b", border: 0, borderRadius: 6, padding: "7px 14px",
  fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
};
