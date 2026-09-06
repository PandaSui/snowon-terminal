"use client";

import { apiUrl } from "@/lib/apiBase";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { addressUrl, txUrl } from "@/lib/explorers";
import { fmtPriceUsd, fmtQuote, type QuoteUnit } from "@/lib/quoteUnit";
import { openWalletTracker } from "@/lib/favorites";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

export interface TokenTrade {
  txHash: string;
  logIndex: number;
  trader: string;
  isBuy: boolean;
  kind: string;
  ethAmount: string;
  tokenAmountWhole: string;
  priceEth: string;
  costEth: string | null;
  phase: string;
  blockTimestamp: string;
  firstSeenAt: string | null;
  buyCount: number;
  sellCount: number;
  isNewWallet: boolean;
  isFirstBuy: boolean;
  sameFunder: boolean;
  clusterSize: number;
  isPhish: boolean;
  isBundle: boolean;
}

interface TraderStats {
  wallet: string;
  avgBuyEth: string | null;
  avgSellEth: string | null;
  remainCostEth: string | null;
  buyCount: number;
  sellCount: number;
  balanceWhole: string;
  realizedPnlEth: string;
}

const KINDS = [
  { key: "all", label: "全部" },
  { key: "buy", label: "买入" },
  { key: "sell", label: "卖出" },
  { key: "add", label: "加池子" },
  { key: "remove", label: "减池子" },
  { key: "burn", label: "烧币" },
  { key: "fee", label: "领费" },
] as const;

const KIND_STYLE: Record<string, { label: string; color: string }> = {
  buy: { label: "买入", color: "#0ecb81" },
  sell: { label: "卖出", color: "#f6465d" },
  add: { label: "加池子", color: "#00c3ff" },
  remove: { label: "减池子", color: "#f0b90b" },
  burn: { label: "烧币", color: "#ff8a00" },
  fee: { label: "领费", color: "#b15bff" },
};

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function shortTx(h: string) {
  return `${h.slice(0, 8)}…${h.slice(-4)}`;
}

function parseTs(iso: string) {
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T")).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function timeAgo(iso: string) {
  const t = parseTs(iso);
  if (!Number.isFinite(t)) return "-";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtClock(iso: string) {
  const t = parseTs(iso);
  if (!Number.isFinite(t)) return "-";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const WINDOWS = [
  { key: "1h", label: "1h" },
  { key: "4h", label: "4h" },
  { key: "24h", label: "24h" },
  { key: "3d", label: "3天" },
  { key: "7d", label: "7天" },
  { key: "all", label: "全部" },
] as const;

function fmtTokens(s: string) {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 1 : 2 });
}

function WalletSheet({
  token, wallet, ethUsd, onClose,
}: {
  token: string; wallet: string; ethUsd?: number; onClose: () => void;
}) {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["trader-stats", token, wallet],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${token}/trader/${wallet}`));
      return readJson<TraderStats>(res);
    },
  });
  return (
    <div style={{ borderTop: "1px solid #2b3139", background: "#10141b", padding: "8px 10px 10px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>{shortAddr(wallet)}</span>
        <button type="button" onClick={() => { openWalletTracker(wallet); router.push("/track"); }} style={{ fontSize: 10, color: "#f0b90b", background: "none", border: 0, cursor: "pointer" }}>追踪</button>
        <a href={addressUrl(CHAIN_ID, wallet)} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#5e6673" }}>浏览器</a>
        <button type="button" onClick={onClose} style={{ marginLeft: "auto", background: "none", border: 0, color: "#848e9c", cursor: "pointer", fontSize: 14 }}>×</button>
      </div>
      {isLoading || !data ? (
        <div style={{ fontSize: 11, color: "#5e6673" }}>读取该地址成交…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11 }}>
          <div>
            <div style={{ color: "#5e6673" }}>平均买入价</div>
            <div style={{ color: "#0ecb81", fontWeight: 800 }}>{fmtPriceUsd(data.avgBuyEth, ethUsd)}</div>
            <div style={{ color: "#5e6673", fontSize: 10 }}>{data.buyCount} 笔买</div>
          </div>
          <div>
            <div style={{ color: "#5e6673" }}>平均卖出价</div>
            <div style={{ color: "#f6465d", fontWeight: 800 }}>{fmtPriceUsd(data.avgSellEth, ethUsd)}</div>
            <div style={{ color: "#5e6673", fontSize: 10 }}>{data.sellCount} 笔卖</div>
          </div>
          <div>
            <div style={{ color: "#5e6673" }}>剩余成本</div>
            <div style={{ color: "#eaecef", fontWeight: 700 }}>{fmtPriceUsd(data.remainCostEth, ethUsd)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TradeHistoryPanel({
  address, unit, ethUsd,
}: {
  address: string; unit: QuoteUnit; ethUsd?: number;
}) {
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [windowKey, setWindowKey] = useState<string>("all");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [openWallet, setOpenWallet] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["token-trades", address, windowKey, order],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/trades?window=${windowKey}&order=${order}&limit=200`));
      return readJson<{ trades: TokenTrade[] }>(res);
    },
    refetchInterval: 5_000,
  });

  const trades = data?.trades ?? [];
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return trades.filter((t) => {
      const k = (t.kind || (t.isBuy ? "buy" : "sell")).toLowerCase();
      if (kind !== "all" && k !== kind) return false;
      if (qq && !t.trader.toLowerCase().includes(qq)) return false;
      return true;
    });
  }, [trades, kind, q]);

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    const qq = q.trim().toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(qq)) setOpenWallet(qq);
  }

  const col = "1.3fr 108px 52px 1fr 1fr 1fr 1fr 76px";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "6px 8px", borderBottom: "1px solid #1e2329", flexShrink: 0 }}>
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setKind(k.key)}
            style={{
              padding: "3px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer",
              border: "1px solid #2b3139", borderRadius: 4,
              background: kind === k.key ? "#1c1f26" : "transparent",
              color: kind === k.key ? "#f0b90b" : "#848e9c",
            }}
          >
            {k.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              style={{
                padding: "3px 7px", fontSize: 10, fontWeight: 700, cursor: "pointer",
                border: "1px solid #2b3139", borderRadius: 4,
                background: windowKey === w.key ? "#f0b90b" : "transparent",
                color: windowKey === w.key ? "#0b0e11" : "#848e9c",
              }}
            >
              {w.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
            title={order === "desc" ? "当前最新在前，点击改为最早在前" : "当前最早在前，点击改为最新在前"}
            style={{
              padding: "3px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer",
              border: "1px solid #2b3139", borderRadius: 4,
              background: "#1c1f26", color: "#f0b90b",
            }}
          >
            {order === "desc" ? "↓ 最新" : "↑ 最早"}
          </button>
          <form onSubmit={onSearchSubmit} style={{ display: "flex" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="输入地址查找钱包"
              style={{
                width: 140, padding: "3px 8px", fontSize: 11, background: "#0b0e11",
                border: "1px solid #2b3139", borderRadius: 4, color: "#eaecef", outline: "none",
              }}
            />
          </form>
        </div>
      </div>

      <div
        style={{
          display: "grid", gridTemplateColumns: col, gap: 6, padding: "4px 8px",
          fontSize: 10, color: "#5e6673", fontWeight: 700, borderBottom: "1px solid #1e2329", flexShrink: 0,
        }}
      >
        <span>交易者</span>
        <span>时间</span>
        <span>类型</span>
        <span>价格 $</span>
        <span>成本 $</span>
        <span>数量</span>
        <span>总额 USD</span>
        <span>TX</span>
      </div>

      <div className="col-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 80 }}>
        {filtered.length === 0 && (
          <div style={{ color: "#5e6673", fontSize: 12, textAlign: "center", marginTop: 24 }}>暂无成交</div>
        )}
        {filtered.map((t, i) => {
          const k = (t.kind || (t.isBuy ? "buy" : "sell")).toLowerCase();
          const st = KIND_STYLE[k] ?? { label: k, color: "#848e9c" };
          const isSwap = k === "buy" || k === "sell";
          return (
            <div
              key={`${t.txHash}:${t.logIndex}`}
              style={{
                display: "grid", gridTemplateColumns: col, gap: 6, alignItems: "center",
                padding: "5px 8px", fontSize: 11, background: i % 2 ? "#0f1319" : "transparent",
                outline: openWallet === t.trader ? "1px solid #f0b90b" : "none",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                {t.isNewWallet && <span title="新钱包" style={{ fontSize: 10 }}>🐣</span>}
                {t.isBundle && <span title="捆绑" style={{ fontSize: 10 }}>🔗</span>}
                {t.isPhish && <span title="钓鱼" style={{ fontSize: 10 }}>🎣</span>}
                <button
                  type="button"
                  onClick={() => setOpenWallet((w) => (w === t.trader ? null : t.trader))}
                  title="查看平均买/卖价"
                  style={{
                    fontFamily: "monospace", background: "none", border: 0, padding: 0, cursor: "pointer",
                    color: openWallet === t.trader ? "#f0b90b" : "#eaecef", fontSize: 11,
                    overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {shortAddr(t.trader)}
                </button>
              </span>
              <span
                title={timeAgo(t.blockTimestamp)}
                style={{ color: "#848e9c", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
              >
                {fmtClock(t.blockTimestamp)}
              </span>
              <span style={{ color: st.color, fontWeight: 800 }}>{st.label}</span>
              <span style={{ color: st.color, fontVariantNumeric: "tabular-nums" }}>
                {isSwap ? fmtPriceUsd(t.priceEth, ethUsd) : "—"}
              </span>
              <span style={{ color: "#848e9c", fontVariantNumeric: "tabular-nums" }}>
                {isSwap ? fmtPriceUsd(t.costEth, ethUsd) : "—"}
              </span>
              <span style={{ color: "#eaecef", fontVariantNumeric: "tabular-nums" }}>{fmtTokens(t.tokenAmountWhole)}</span>
              <span style={{ color: st.color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {k === "burn" ? "—" : fmtQuote(t.ethAmount, "usd", ethUsd)}
              </span>
              <a
                href={txUrl(CHAIN_ID, t.txHash)}
                target="_blank"
                rel="noreferrer"
                title={t.txHash}
                style={{ color: "#5e8bff", textDecoration: "none", fontFamily: "monospace", fontSize: 10, whiteSpace: "nowrap" }}
              >
                {shortTx(t.txHash)}
              </a>
            </div>
          );
        })}
      </div>
      {openWallet && (
        <WalletSheet token={address} wallet={openWallet} ethUsd={ethUsd} onClose={() => setOpenWallet(null)} />
      )}
    </div>
  );
}
