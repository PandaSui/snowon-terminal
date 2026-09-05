"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Address } from "viem";
import { TradingChart } from "@/components/TradingChart";
import { TradePanel } from "@/components/TradePanel";
import { ChatBox } from "@/components/ChatBox";
import { TokenLogo } from "@/components/TokenLogo";
import { SocialLinks } from "@/components/SocialLinks";
import { DanmakuLayer } from "@/components/DanmakuLayer";
import { TokenStatsBar } from "@/components/TokenStatsBar";
import { PnlShareCard } from "@/components/PnlShareCard";
import { TokenDataTabs } from "@/components/TokenDataTabs";
import { SecurityPanel, type TokenSecurity } from "@/components/SecurityPanel";
import { FavoritesBar } from "@/components/FavoritesBar";
import { SearchBox } from "@/components/SearchBox";
import { AiPanel } from "@/components/AiPanel";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { readJson } from "@/lib/http";
import { useIsMobile } from "@/lib/useIsMobile";
import { FAVORITES_EVENT, isFavorite, toggleFavorite } from "@/lib/favorites";
import { fmtMcapUsd, fmtPriceUsd, fmtUsdCompact, weiToEth } from "@/lib/quoteUnit";
import type { HomeToken } from "@/components/TokenCard";
import type { ChartResolution } from "@/lib/chartResolutions";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

/** /api/token/[address] 的响应形状(成功字段全部可选,失败带 error/notFound) */
interface TokenDetail extends TokenSecurity {
  error?: string;
  notFound?: boolean;
  logoUri?: string | null;
  symbol?: string;
  name?: string;
  skill?: string | null;
  isRwa?: boolean;
  description?: string | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  github?: string | null;
  heat1h?: number;
  heat24h?: number;
  totalFeesWei?: string;
  graduationThreshold?: string | null;
  priceEth?: string | null;
  mcapEth?: string | null;
}

async function fetchTokens(): Promise<HomeToken[]> {
  const res = await fetch(apiUrl("/api/tokens"));
  const body = await readJson<HomeToken[] | { error?: string }>(res);
  if (!res.ok || !Array.isArray(body)) {
    throw new Error((body as { error?: string }).error ?? `load failed (${res.status})`);
  }
  return body;
}

function fmtChange(pct: string | null | undefined): { text: string; color: string } {
  if (pct == null) return { text: "-", color: "#848e9c" };
  const v = Number(pct) * 100;
  if (!Number.isFinite(v)) return { text: "-", color: "#848e9c" };
  const sign = v > 0 ? "+" : "";
  return { text: `${sign}${v.toFixed(2)}%`, color: v > 0 ? "#0ecb81" : v < 0 ? "#f6465d" : "#848e9c" };
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: `1px solid ${color}`, color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function fmtTaxPct(bps: number) {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint} style={{ minWidth: 64 }}>
      <div style={{ fontSize: 10, color: "#5e6673", fontWeight: 700, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 14, fontWeight: 800, color: "#eaecef", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const { login, logout, authenticated, user } = usePrivy();
  const isMobile = useIsMobile();
  const [fav, setFav] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chartRes, setChartRes] = useState<ChartResolution>("5");
  const [chartH, setChartH] = useState(480);
  const [chatW, setChatW] = useState(280);
  const [bottomH, setBottomH] = useState(320);
  const chartHRef = useRef(480);
  const chatWRef = useRef(280);
  const bottomHRef = useRef(320);
  const leftColRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = Number(localStorage.getItem("token.chartH"));
    if (Number.isFinite(h) && h >= 260 && h <= 1200) {
      setChartH(h);
      chartHRef.current = h;
    }
    const w = Number(localStorage.getItem("token.chatW"));
    if (Number.isFinite(w) && w >= 160 && w <= 800) {
      setChatW(w);
      chatWRef.current = w;
    }
    const bh = Number(localStorage.getItem("token.bottomH"));
    if (Number.isFinite(bh) && bh >= 180 && bh <= 800) {
      setBottomH(bh);
      bottomHRef.current = bh;
    }
  }, []);

  function bindDrag(cursor: string, onMove: (ev: PointerEvent) => void, onSave: () => void) {
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      onSave();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  }

  function startChartResize(e: ReactPointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = chartHRef.current;
    const total = leftColRef.current?.clientHeight ?? 800;
    bindDrag("ns-resize", (ev) => {
      const max = Math.max(280, total - 170);
      const next = Math.min(max, Math.max(260, startH + (ev.clientY - startY)));
      chartHRef.current = next;
      setChartH(next);
    }, () => localStorage.setItem("token.chartH", String(chartHRef.current)));
  }

  function startChatResize(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatWRef.current;
    const left = leftColRef.current?.clientWidth ?? 800;
    bindDrag("ew-resize", (ev) => {
      const max = Math.max(180, left - 220);
      const next = Math.min(max, Math.max(160, startW - (ev.clientX - startX)));
      chatWRef.current = next;
      setChatW(next);
    }, () => localStorage.setItem("token.chatW", String(chatWRef.current)));
  }

  function startBottomResize(e: ReactPointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomHRef.current;
    bindDrag("ns-resize", (ev) => {
      const next = Math.min(720, Math.max(180, startH + (ev.clientY - startY)));
      bottomHRef.current = next;
      setBottomH(next);
    }, () => localStorage.setItem("token.bottomH", String(bottomHRef.current)));
  }

  const { data: token, isLoading, isError, error } = useQuery({
    queryKey: ["token", address],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/token/${address}`));
      const body = await readJson<TokenDetail>(r);
      if (r.status === 404) return { notFound: true as const };
      if (!r.ok) throw new Error(body.error ?? `load failed (${r.status})`);
      return body;
    },
    refetchInterval: 10_000,
  });

  // 与主页同一 queryKey:收藏栏 + 当前代币价格/涨幅
  const { data: tokens } = useQuery({
    queryKey: ["tokens"],
    queryFn: fetchTokens,
    refetchInterval: 8_000,
    staleTime: 4_000,
  });
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const { data: pool } = useQuery({
    queryKey: ["token-pool", address],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/pool`));
      return readJson<{
        graduated: boolean;
        quoteIsEth?: boolean;
        current: { quote: string | null; token: string | null } | null;
        initial: { quote: string | null; token: string | null } | null;
      }>(res);
    },
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const { data: windowStats } = useQuery({
    queryKey: ["token-stats", address],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/stats`));
      return readJson<{ "1D"?: { vol: string } }>(res);
    },
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const homeToken = useMemo(
    () => tokens?.find((t) => t.address.toLowerCase() === address?.toLowerCase()),
    [tokens, address],
  );

  useEffect(() => {
    if (!address) return;
    const sync = () => setFav(isFavorite(address));
    sync();
    window.addEventListener(FAVORITES_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_EVENT, sync);
  }, [address]);

  if (isLoading) return <main style={{ padding: 24 }}>加载中…</main>;
  if (isError) return <main style={{ padding: 24 }}>加载失败：{(error as Error).message}</main>;
  if (!token || token.notFound) return <main style={{ padding: 24 }}>代币不存在</main>;

  const change = fmtChange(homeToken?.change24hPct);
  const ethUsd = eth?.price;
  const priceEth = homeToken?.priceEth ?? token.priceEth ?? null;
  const mcapEth = homeToken?.mcapEth ?? token.mcapEth ?? (
    priceEth != null && Number(priceEth) > 0 ? String(Number(priceEth) * 1_000_000_000) : null
  );
  const buyTaxShown = token.buyTaxBps ?? 0;
  const sellTaxShown = token.sellTaxBps ?? 0;
  const feeEth = weiToEth(token.totalFeesWei);
  const feeUsdText = ethUsd && Number.isFinite(feeEth)
    ? fmtUsdCompact(feeEth * ethUsd)
    : "$-";
  const vol24Eth = weiToEth(windowStats?.["1D"]?.vol);
  const vol24Text = ethUsd && vol24Eth > 0 ? fmtUsdCompact(vol24Eth * ethUsd) : "$0";
  const poolText = (() => {
    if (!ethUsd) return "$-";
    const quoteIsEth = pool?.quoteIsEth !== false;
    const q = Number(pool?.current?.quote ?? pool?.initial?.quote ?? 0);
    const tok = Number(pool?.current?.token ?? pool?.initial?.token ?? 0);
    if (quoteIsEth && q > 0) return fmtUsdCompact(q * ethUsd);
    if (tok > 0 && priceEth != null && Number(priceEth) > 0) {
      return fmtUsdCompact(tok * Number(priceEth) * ethUsd);
    }
    const progress = Number(homeToken?.graduationProgress ?? 0);
    const thresholdWei = Number(token.graduationThreshold ?? 0);
    if (quoteIsEth && progress > 0 && thresholdWei > 0) {
      return fmtUsdCompact(progress * (thresholdWei / 1e18) * ethUsd);
    }
    return "$-";
  })();

  const copyAddress = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <main
      style={{
        width: "100%", padding: isMobile ? "8px 8px" : "10px 16px",
        display: "flex", flexDirection: "column", gap: 10,
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      {/* 顶栏:logo + 发现 导航 + 搜索 + AI + 资产 + 钱包链接 */}
      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1 style={{ fontSize: isMobile ? 15 : 18, margin: 0, fontWeight: 800, whiteSpace: "nowrap" }}>
            SnowOn <span style={{ color: "#f0b90b" }}>Terminal</span>
          </h1>
        </Link>
        <nav style={{ display: "flex", gap: 14, fontSize: 13, color: "#848e9c" }}>
          <Link href="/" style={{ color: "#848e9c", textDecoration: "none" }}>发现</Link>
          <a
            href="https://www.snowon.fun/create"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#f0b90b", textDecoration: "none", fontWeight: 600 }}
          >
            Launch Token
          </a>
        </nav>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: isMobile ? "100%" : 0 }}>
          <SearchBox />
        </div>
        {!isMobile && <AiPanel tokenAddress={address} />}
        {!isMobile && <PortfolioPanel />}
        <button
          onClick={authenticated ? logout : login}
          style={{
            background: "#f0b90b", border: 0, borderRadius: 6, padding: "7px 14px",
            fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          {authenticated ? `${user?.wallet?.address?.slice(0, 6) ?? user?.email ?? ""}…` : "钱包链接"}
        </button>
      </header>

      {/* 标星收藏代币条(价格 + 涨幅) */}
      <FavoritesBar tokens={tokens ?? []} />

      {/* 代币信息条:logo + 名称 + 合约 + 徽章 + 社交链接 | 价格/涨幅 */}
      <section
        style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "10px 14px", border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117",
        }}
      >
        <TokenLogo src={token.logoUri ?? null} alt={token.symbol ?? ""} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>{token.name}</span>
            <span style={{ fontSize: 13, color: "#848e9c" }}>${token.symbol}</span>
            <button
              onClick={() => toggleFavorite(address)}
              title={fav ? "取消收藏" : "收藏到顶部栏"}
              style={{ background: "none", border: 0, cursor: "pointer", fontSize: 16, color: fav ? "#f0b90b" : "#3d4450", padding: 0 }}
            >
              {fav ? "★" : "☆"}
            </button>
          </div>
          <button
            onClick={copyAddress}
            title="点击复制合约地址"
            style={{
              marginTop: 2, background: "none", border: 0, padding: 0, cursor: "pointer",
              fontFamily: "monospace", fontSize: 11, color: copied ? "#0ecb81" : "#5e6673",
            }}
          >
            {copied ? "✓ 已复制" : `${address.slice(0, 10)}…${address.slice(-8)}`}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {token.skill && <Badge color="#5e8bff">{token.skill}</Badge>}
          {token.graduated
            ? <Badge color="#0ecb81">已毕业 · V4 池 LP 永久锁定</Badge>
            : <Badge color="#f0b90b">曲线阶段</Badge>}
          {token.antiBundle && <Badge color="#848e9c">antiBundle</Badge>}
          {token.isRwa && <Badge color="#5e8bff">RWA</Badge>}
          {token.bundleScore && (
            <Badge color={token.bundleScore.score > 60 ? "#f6465d" : "#0ecb81"}>
              捆绑分 {token.bundleScore.score}/100
            </Badge>
          )}
          <SocialLinks
            website={token.website}
            twitter={token.twitter}
            telegram={token.telegram}
            github={token.github}
          />
        </div>

        {/* 市值打头 + 池子/成交额/手续费/供应量/税率 | 右侧价格与涨幅不动 */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div title="市值" style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: -0.3, color: "#eaecef" }}>
            {fmtMcapUsd(mcapEth, ethUsd)}
          </div>
          <Metric label="池子" value={poolText} hint="流动池报价资产" />
          <Metric label="24h成交额" value={vol24Text} hint="近 24 小时买卖成交额" />
          <Metric label="总手续费" value={feeUsdText} hint="累计协议+创建者税" />
          <Metric label="总供应量" value="1B" hint="曲线恒定总量 10 亿枚" />
          <Metric
            label="总税率"
            value={`${fmtTaxPct(buyTaxShown)} / ${fmtTaxPct(sellTaxShown)}`}
            hint="买税 / 卖税"
          />
          <div style={{ textAlign: "right", minWidth: 128, paddingLeft: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: -0.3 }}>
                {fmtPriceUsd(priceEth, ethUsd)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: change.color }}>{change.text}</span>
            </div>
          </div>
        </div>
        {token.description ? (
          <p style={{ width: "100%", margin: "4px 0 0", fontSize: 12, color: "#848e9c" }}>{token.description}</p>
        ) : null}
      </section>

      {/* PNL(可分享) + 各周期总/买/卖成交量(点击同步 K 线) */}
      <section style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
        <PnlShareCard tokenAddress={address} symbol={token.symbol ?? ""} />
        <div style={{ flex: 1, minWidth: 280, display: "flex" }}>
          <TokenStatsBar address={address} resolution={chartRes} onResolutionChange={setChartRes} />
        </div>
      </section>

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ position: "relative", minHeight: 320, height: 360 }}>
            <TradingChart
              chainId={CHAIN_ID}
              tokenAddress={address}
              resolution={chartRes}
              onResolutionChange={setChartRes}
            />
            <DanmakuLayer chainId={CHAIN_ID} tokenAddress={address} />
          </div>
          <TradePanel
            chainId={CHAIN_ID}
            token={address as Address}
            antiBundle={!!token.antiBundle}
            graduated={!!token.graduated}
          />
          <div style={{ height: 360 }}>
            <TokenDataTabs address={address} />
          </div>
          <div style={{ height: 320 }}>
            <ChatBox chainId={CHAIN_ID} tokenAddress={address} />
          </div>
          <div style={{ height: 320 }}>
            <SecurityPanel token={token} />
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            minHeight: `${chartH + bottomH + 40}px`,
          }}
        >
          {/* 左:K 线可上下拉,下方交易历史+聊天跟着变高;聊天可左右拉给历史腾位 */}
          <div
            ref={leftColRef}
            style={{
              flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
              minHeight: `${chartH + bottomH + 24}px`,
              alignSelf: "flex-start",
            }}
          >
            <div style={{ height: chartH, minHeight: 260, position: "relative", flexShrink: 0 }}>
              <TradingChart
                chainId={CHAIN_ID}
                tokenAddress={address}
                resolution={chartRes}
                onResolutionChange={setChartRes}
              />
              <DanmakuLayer chainId={CHAIN_ID} tokenAddress={address} />
            </div>
            <div
              className="chart-resize"
              onPointerDown={startChartResize}
              title="拖动调整 K 线高度，下方交易历史与聊天跟着变"
            />
            <div style={{ height: bottomH, minHeight: 180, flexShrink: 0, display: "flex", minWidth: 0 }}>
              <div style={{ flex: 1, minWidth: 180, minHeight: 0, height: "100%" }}>
                <TokenDataTabs address={address} />
              </div>
              <div
                className="chat-resize"
                onPointerDown={startChatResize}
                title="左右拖动：缩小聊天可加宽交易历史"
              />
              <div style={{ width: chatW, minWidth: 160, flexShrink: 0, minHeight: 0, height: "100%" }}>
                <ChatBox chainId={CHAIN_ID} tokenAddress={address} />
              </div>
            </div>
            <div
              className="chart-resize"
              onPointerDown={startBottomResize}
              title="拖动调整交易历史与聊天的高度"
            />
          </div>
          {/* 右:交易面板按内容撑开(不裁切),合约安全跟在下方、不跟 K 线拉伸 */}
          <div
            style={{
              width: 380, flexShrink: 0, display: "flex", flexDirection: "column",
              gap: 10, alignSelf: "flex-start",
            }}
          >
            <TradePanel
              chainId={CHAIN_ID}
              token={address as Address}
              antiBundle={!!token.antiBundle}
              graduated={!!token.graduated}
            />
            <div style={{ flexShrink: 0 }}>
              <SecurityPanel token={token} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
