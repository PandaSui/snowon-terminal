"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { txUrl } from "@/lib/explorers";
import { fmtAmount, fmtPnl, fmtPrice as fmtPx, useQuoteUnit, type QuoteUnit } from "@/lib/quoteUnit";
import { QuoteUnitToggle } from "./QuoteUnitToggle";
import { TokenLogo } from "./TokenLogo";

export interface PositionRow {
  tokenAddress: string;
  name: string | null;
  symbol: string | null;
  logoUri: string | null;
  graduated: boolean;
  balanceWhole: string;
  costBasisEth: string;
  realizedPnlEth: string;
  totalBoughtEth?: string;
  buyAmountEth?: string | null;
  avgBuyPriceEth?: string | null;
  avgSellPriceEth?: string | null;
  lastBuyTx?: string | null;
  lastSellTx?: string | null;
  priceEth: string | null;
  valueEth: string | null;
  buyCount?: number;
  sellCount?: number;
  lastTradeAt?: string | null;
  closed?: boolean;
}

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
const OK = "#0ecb81";
const BAD = "#f6465d";
const DIM = "#5e6673";
const BORDER = "#1e2329";

function n(v: string | number | null | undefined): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return "-";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function pnlOf(p: PositionRow, kind: "open" | "closed"): number {
  const realized = n(p.realizedPnlEth);
  if (kind === "closed") return realized;
  const value = n(p.valueEth);
  const cost = n(p.costBasisEth);
  return value - cost + realized;
}

function pctOf(p: PositionRow, kind: "open" | "closed"): number | null {
  const realized = n(p.realizedPnlEth);
  if (kind === "closed") {
    const bought = n(p.totalBoughtEth ?? p.buyAmountEth);
    if (bought <= 0) return realized === 0 ? 0 : null;
    return (realized / bought) * 100;
  }
  const cost = n(p.costBasisEth);
  if (cost <= 0) return null;
  return ((n(p.valueEth) - cost + realized) / cost) * 100;
}

type Dir = "desc" | "asc";
type Tab = "open" | "closed";

function SortBtn({ dir, onToggle }: { dir: Dir; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={dir === "desc" ? "盈亏从高到低,点击改为从低到高" : "盈亏从低到高,点击改为从高到低"}
      style={{
        display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        width: 18, height: 22, padding: 0, marginLeft: 4, cursor: "pointer",
        background: "none", border: 0, lineHeight: 1, color: "#848e9c",
      }}
    >
      <span style={{ fontSize: 9, color: dir === "desc" ? "#f0b90b" : "#3d4450" }}>▲</span>
      <span style={{ fontSize: 9, marginTop: -2, color: dir === "asc" ? "#f0b90b" : "#3d4450" }}>▼</span>
    </button>
  );
}

/** Robinhood 羽毛标:点击跳转区块浏览器交易 */
function FeatherTx({ hash, title }: { hash: string | null | undefined; title: string }) {
  if (!hash) {
    return <span style={{ color: "#3d4450", fontSize: 11 }}>—</span>;
  }
  return (
    <a
      href={txUrl(CHAIN_ID, hash)}
      target="_blank"
      rel="noreferrer"
      title={`${title} ${hash}`}
      onClick={(e) => e.stopPropagation()}
      style={{ display: "inline-flex", alignItems: "center", color: "#00c805" }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M4.2 20.4c2.6-1.1 5.8-4.2 8.3-8.3 1.6-2.6 2.7-5.3 3.2-7.6.2 2.6-.4 5.7-1.8 8.6-2.4 4.9-6.4 8.6-10.4 9.3 2.8-2.1 4.9-5.1 6.2-8.4-1.9 2.6-4.3 4.7-7 6.1 1.2-2.4 2-5.2 2.2-8.1C5.2 14.8 4.4 17.7 4.2 20.4zm10.1-16.8c.9 2.4 1.1 5.2.4 8.1 2.3-3.4 3.2-7.1 2.6-10.2-.1.7-.3 1.4-.6 2.1z"
        />
      </svg>
    </a>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, color: DIM, letterSpacing: 0.2 }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: color ?? "#eaecef", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function TokenPnlRow({
  p, kind, unit, ethUsd,
}: {
  p: PositionRow; kind: "open" | "closed"; unit: QuoteUnit; ethUsd?: number;
}) {
  const pnl = pnlOf(p, kind);
  const pct = pctOf(p, kind);
  const color = pnl > 0 ? OK : pnl < 0 ? BAD : DIM;
  const buyAmt = n(p.buyAmountEth ?? p.totalBoughtEth);
  const buyPx = p.avgBuyPriceEth ?? (n(p.balanceWhole) > 0 && n(p.costBasisEth) > 0
    ? String(n(p.costBasisEth) / n(p.balanceWhole))
    : null);
  return (
    <div
      style={{
        padding: "10px 2px 12px",
        borderBottom: "1px solid #161b22",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Link
          href={`/token/${p.tokenAddress}`}
          style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none", color: "inherit", minWidth: 0 }}
        >
          <TokenLogo src={p.logoUri} alt={p.symbol ?? "?"} size={20} />
          <span style={{ fontWeight: 700, fontSize: 12 }}>
            {p.symbol ?? "?"}
          </span>
          <span style={{ fontSize: 10, color: DIM }}>
            {kind === "open"
              ? `${n(p.balanceWhole).toLocaleString("en-US", { maximumFractionDigits: 0 })} 枚`
              : "已清仓"}
          </span>
        </Link>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <FeatherTx hash={p.lastBuyTx} title="最近买入" />
          <FeatherTx hash={p.lastSellTx} title="最近卖出" />
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          columnGap: 18,
          rowGap: 6,
        }}
      >
        <Metric label="买入金额" value={fmtAmount(buyAmt, unit, ethUsd)} />
        <Metric label="买入价格" value={buyPx ? fmtPx(buyPx, unit, ethUsd) : "—"} />
        <Metric label="卖出价格" value={p.avgSellPriceEth ? fmtPx(p.avgSellPriceEth, unit, ethUsd) : "—"} />
        <Metric label="盈亏" value={`${fmtPnl(pnl, unit, ethUsd)}${pct != null ? `  ${fmtPct(pct)}` : ""}`} color={color} />
      </div>
    </div>
  );
}

/** 个人页日历下方:持仓 / 清仓 Tab 切换,按盈亏箭头排序 */
export function PositionPnlLists({ address }: { address: string }) {
  const [tab, setTab] = useState<Tab>("open");
  const [dir, setDir] = useState<Dir>("desc");
  const [unit] = useQuoteUnit();
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });
  const ethUsd = eth?.price;

  const { data, isFetching } = useQuery({
    queryKey: ["portfolio-all", address],
    enabled: !!address,
    refetchInterval: 20_000,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/portfolio?address=${address}&includeClosed=1`));
      const body = await readJson<PositionRow[] | { error?: string }>(res);
      if (!res.ok || !Array.isArray(body)) throw new Error("load failed");
      return body;
    },
  });

  const holdings = (data ?? []).filter((p) => !p.closed && n(p.balanceWhole) > 0);
  const closed = (data ?? []).filter((p) => p.closed || n(p.balanceWhole) <= 0);
  const rows = tab === "open" ? holdings : closed;
  const kind = tab;

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const d = pnlOf(a, kind) - pnlOf(b, kind);
      return dir === "desc" ? -d : d;
    });
    return copy;
  }, [rows, kind, dir]);
  const sum = rows.reduce((s, p) => s + pnlOf(p, kind), 0);

  const tabBtn = (k: Tab): React.CSSProperties => ({
    padding: "7px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
    border: 0, background: "transparent",
    color: tab === k ? "#eaecef" : DIM,
    borderBottom: `2px solid ${tab === k ? "#f0b90b" : "transparent"}`,
  });

  return (
    <section
      style={{
        background: "#0d1117", border: `1px solid ${BORDER}`, borderRadius: 8,
        padding: "0 12px 8px", minWidth: 0, display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch", borderBottom: `1px solid ${BORDER}`, margin: "0 -12px", padding: "0 4px" }}>
        <button type="button" onClick={() => setTab("open")} style={tabBtn("open")}>
          持仓
          <span style={{ marginLeft: 4, fontSize: 10, color: DIM, fontWeight: 600 }}>{holdings.length}</span>
        </button>
        <button type="button" onClick={() => setTab("closed")} style={tabBtn("closed")}>
          清仓
          <span style={{ marginLeft: 4, fontSize: 10, color: DIM, fontWeight: 600 }}>{closed.length}</span>
        </button>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, color: DIM, paddingRight: 8 }}>
          <QuoteUnitToggle size={14} />
          盈亏
          <SortBtn dir={dir} onToggle={() => setDir((d) => (d === "desc" ? "asc" : "desc"))} />
        </span>
      </div>

      <div className="col-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, maxHeight: 320 }}>
        {isFetching && !data && (
          <div style={{ fontSize: 11, color: DIM, textAlign: "center", padding: "14px 0" }}>加载持仓…</div>
        )}
        {sorted.length === 0 && data && (
          <div style={{ fontSize: 11, color: DIM, textAlign: "center", padding: "14px 0" }}>暂无记录</div>
        )}
        {sorted.map((p) => <TokenPnlRow key={p.tokenAddress} p={p} kind={kind} unit={unit} ethUsd={ethUsd} />)}
      </div>
      {sorted.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, fontSize: 10 }}>
          <span style={{ color: DIM }}>合计 {sorted.length} 个</span>
          <b style={{ color: sum >= 0 ? OK : BAD, fontVariantNumeric: "tabular-nums" }}>{fmtPnl(sum, unit, ethUsd)}</b>
        </div>
      )}
    </section>
  );
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T")).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

/** 最近有成交的代币,按 lastTradeAt 倒序 */
export function LastActiveTokens({ address }: { address: string }) {
  const [unit] = useQuoteUnit();
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });
  const ethUsd = eth?.price;
  const { data, isFetching } = useQuery({
    queryKey: ["portfolio-all", address],
    enabled: !!address,
    refetchInterval: 20_000,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/portfolio?address=${address}&includeClosed=1`));
      const body = await readJson<PositionRow[] | { error?: string }>(res);
      if (!res.ok || !Array.isArray(body)) throw new Error("load failed");
      return body;
    },
  });

  const rows = useMemo(() => {
    return [...(data ?? [])]
      .filter((p) => p.lastTradeAt)
      .sort((a, b) => +new Date(b.lastTradeAt ?? 0) - +new Date(a.lastTradeAt ?? 0))
      .slice(0, 12);
  }, [data]);

  return (
    <section
      style={{
        background: "#0d1117", border: `1px solid ${BORDER}`, borderRadius: 8,
        padding: "8px 10px", minWidth: 0, display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>⏱ 最后活跃</span>
        <span style={{ marginLeft: "auto" }}><QuoteUnitToggle size={14} /></span>
      </div>
      <div className="col-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, maxHeight: 320 }}>
        {isFetching && !data && (
          <div style={{ fontSize: 11, color: DIM, textAlign: "center", padding: "14px 0" }}>加载中…</div>
        )}
        {rows.length === 0 && data && (
          <div style={{ fontSize: 11, color: DIM, textAlign: "center", padding: "14px 0" }}>暂无成交</div>
        )}
        {rows.map((p) => {
          const closed = p.closed || n(p.balanceWhole) <= 0;
          const pnl = pnlOf(p, closed ? "closed" : "open");
          const color = pnl > 0 ? OK : pnl < 0 ? BAD : DIM;
          return (
            <div
              key={p.tokenAddress}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
                borderBottom: "1px solid #161b22",
              }}
            >
              <Link
                href={`/token/${p.tokenAddress}`}
                style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", color: "inherit", minWidth: 0, flex: 1 }}
              >
                <TokenLogo src={p.logoUri} alt={p.symbol ?? "?"} size={18} />
                <span style={{ fontWeight: 700, fontSize: 11 }}>{p.symbol ?? "?"}</span>
                <span style={{ fontSize: 10, color, marginLeft: "auto", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {fmtPnl(pnl, unit, ethUsd)}
                </span>
              </Link>
              <span style={{ fontSize: 9, color: DIM, whiteSpace: "nowrap" }}>{timeAgo(p.lastTradeAt)}</span>
              <FeatherTx hash={p.lastSellTx || p.lastBuyTx} title="最近成交" />
            </div>
          );
        })}
      </div>
    </section>
  );
}
