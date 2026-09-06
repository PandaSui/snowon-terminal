"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { addressUrl } from "@/lib/explorers";
import { fmtPriceUsd, fmtUsdCompact } from "@/lib/quoteUnit";
import { useT } from "@/lib/locale";
import { EmojiAvatar } from "./EmojiAvatar";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
const COL = "22px minmax(108px,1.3fr) 64px 78px 72px 78px minmax(88px,1fr)";

interface Holder {
  wallet: string;
  isDev?: boolean;
  isDevAlt?: boolean;
  balanceWhole: string;
  costBasisEth: string;
  avgCostEth: string | null;
  priceEth: string | null;
  valueEth: string | null;
  realizedPnlEth: string;
  unrealizedPnlEth: string | null;
  totalPnlEth: string | null;
  pnlPct: string | null;
  buyCount: number;
  sellCount: number;
  sharePct: number;
  firstFunder: string | null;
  funderLabel: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  clusterSize: number;
  sameFunder: boolean;
  isPhish: boolean;
  isBundle: boolean;
}

interface PoolRow {
  kind: "curve" | "v4";
  label: string;
  wallet: string;
  balanceWhole: string;
  sharePct: number;
  quoteWhole: string | null;
  quoteSymbol?: string;
  valueEth: string | null;
  locked: boolean;
}

interface BurnRow {
  address: string;
  label: string;
  balanceWhole: string;
  sharePct: number;
}

interface HoldersData {
  holders: Holder[];
  pool?: PoolRow | null;
  creator?: string | null;
  devSharePct?: number | null;
  devAltCount?: number;
  top10AvgCostEth?: string | null;
  top100AvgCostEth?: string | null;
  holderCount: number;
  top10Share: number | null;
  totalSupplyWhole?: string;
  burnedWhole?: string | null;
  burnedPct?: number | null;
  burns?: BurnRow[];
}

function shortAddr(a: string) {
  if (!a) return "—";
  if (a.startsWith("0x") && a.length >= 10) return `${a.slice(0, 6)}…${a.slice(-4)}`;
  if (a.startsWith("0x") && a.length === 66) return `${a.slice(0, 8)}…${a.slice(-4)}`;
  return a.length > 14 ? `${a.slice(0, 10)}…` : a;
}

function fmtPct(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0%";
  if (n < 0.01) return "<0.01%";
  return `${n.toFixed(2)}%`;
}

function fmtAmt(s: string) {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 0 : 4 });
}

function ageLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T")).getTime();
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtSignedUsd(v: string | number | null | undefined, ethUsd?: number): { text: string; color: string } {
  if (v == null || v === "") return { text: "-", color: "#848e9c" };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return { text: "-", color: "#848e9c" };
  const color = n > 0 ? "#0ecb81" : n < 0 ? "#f6465d" : "#848e9c";
  if (!ethUsd || ethUsd <= 0) {
    const sign = n > 0 ? "+" : n < 0 ? "-" : "";
    return { text: `${sign}${Math.abs(n).toFixed(4)} ETH`, color };
  }
  const usd = n * ethUsd;
  const sign = usd > 0 ? "+" : usd < 0 ? "-" : "";
  const a = Math.abs(usd);
  const body = a >= 1000 ? `$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : a >= 1 ? `$${a.toFixed(2)}`
    : `$${a.toFixed(4)}`;
  return { text: n === 0 ? "$0" : `${sign}${body}`, color };
}

function valueUsd(eth: string | null | undefined, ethUsd?: number): string {
  if (eth == null || !ethUsd) return "-";
  const n = Number(eth);
  if (!Number.isFinite(n)) return "-";
  return fmtUsdCompact(n * ethUsd);
}

function DevMark({ alt }: { alt?: boolean }) {
  const tr = useT();
  return (
    <span
      title={alt ? tr("devAltTip") : tr("devTip")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 3px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 800,
        lineHeight: 1,
        color: "#fff",
        background: alt ? "#f0b90b" : "#b15bff",
        flexShrink: 0,
      }}
    >
      {alt ? tr("devAlt") : tr("dev")}
    </span>
  );
}

function RiskMark({ kind, title }: { kind: "phish" | "bundle"; title: string }) {
  const tr = useT();
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 3px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 800,
        lineHeight: 1,
        color: "#fff",
        background: "#f6465d",
        flexShrink: 0,
      }}
    >
      {kind === "phish" ? tr("phishShort") : tr("bundleShort")}
    </span>
  );
}

function Head() {
  const tr = useT();
  return (
    <div
      className="holders-row"
      style={{
        display: "grid",
        gridTemplateColumns: COL,
        gap: 6,
        padding: "4px 10px",
        fontSize: 10,
        color: "#5e6673",
        fontWeight: 700,
        borderBottom: "1px solid #1e2329",
        flexShrink: 0,
      }}
    >
      <span>#</span>
      <span>{tr("walletCol")}</span>
      <span style={{ textAlign: "right" }}>{tr("share")}</span>
      <span style={{ textAlign: "right" }}>{tr("qty")}</span>
      <span style={{ textAlign: "right" }}>{tr("value")}</span>
      <span style={{ textAlign: "right" }}>{tr("cost")}</span>
      <span style={{ textAlign: "right" }}>{tr("pnl")}</span>
    </div>
  );
}

/** 持有者 + 流动池置顶 + 成本/盈亏 + 同资金来源虚线 + 钓鱼/捆绑红标 */
export function HoldersPanel({ address, embedded, ethUsd }: { address: string; embedded?: boolean; ethUsd?: number }) {
  const tr = useT();
  const { data } = useQuery({
    queryKey: ["holders", address],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/holders`));
      return readJson<HoldersData>(res);
    },
    refetchInterval: 15_000,
  });

  const holders = data?.holders ?? [];
  const pool = data?.pool ?? null;
  const burns = data?.burns ?? [];
  const top10Pct = data?.top10Share != null ? data.top10Share * 100 : null;
  const riskColor = top10Pct == null ? "#848e9c" : top10Pct > 50 ? "#f6465d" : top10Pct > 30 ? "#f0b90b" : "#0ecb81";
  const flagged = holders.filter((h) => h.sameFunder || h.isPhish || h.isBundle).length;

  const body = (
    <>
      {!embedded && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid #1e2329", fontSize: 13, fontWeight: 700 }}>
          {tr("holders")}
          <span style={{ marginLeft: 8, fontSize: 11, color: "#5e6673", fontWeight: 400 }}>
            {data ? tr("addrCount", { n: data.holderCount }) : tr("loading")}
            {flagged > 0 && <span style={{ color: "#f6465d", marginLeft: 6 }}>{tr("flagged", { n: flagged })}</span>}
          </span>
        </div>
      )}

      {embedded && data && (
        <div style={{ padding: "6px 10px 0", fontSize: 11, color: "#5e6673" }}>
          {tr("addrCount", { n: data.holderCount })}
          {flagged > 0 && <span style={{ color: "#f6465d", marginLeft: 6 }}>{tr("flagged", { n: flagged })}</span>}
        </div>
      )}

      {top10Pct != null && (
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2329", fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#848e9c" }}>
            <span>{tr("top10conc")}</span>
            <span style={{ color: riskColor, fontWeight: 700 }}>{top10Pct.toFixed(1)}%</span>
          </div>
          <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: "#1e2329", overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, top10Pct)}%`, height: "100%", background: riskColor }} />
          </div>
          {data?.devSharePct != null && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "#848e9c", marginTop: 6 }}>
              <span title={tr("devClusterTip")}>{tr("devTotal")}{data.devAltCount ? tr("nAlts", { n: data.devAltCount }) : ""}</span>
              <span style={{ color: data.devSharePct > 10 ? "#f6465d" : data.devSharePct > 5 ? "#f0b90b" : "#eaecef", fontWeight: 700 }}>
                {fmtPct(data.devSharePct)}
              </span>
            </div>
          )}
          {(data?.top10AvgCostEth || data?.top100AvgCostEth) && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#848e9c", marginTop: 6 }}>
              <span title={tr("avgHoldTitle")}>{tr("avgHoldPx")}</span>
              <span style={{ fontWeight: 700, color: "#eaecef", fontVariantNumeric: "tabular-nums" }}>
                {fmtPriceUsd(data.top10AvgCostEth, ethUsd)}
                <span style={{ color: "#5e6673", fontWeight: 400 }}> / </span>
                {fmtPriceUsd(data.top100AvgCostEth, ethUsd)}
              </span>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid #1e2329",
          fontSize: 10,
          color: "#5e6673",
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
        }}
      >
        <span>
          <span style={{ color: "#f6465d", fontWeight: 800 }}>┆</span> {tr("redDash")}
        </span>
        <span>
          <RiskMark kind="phish" title={tr("phishMix")} /> {tr("phish")}
        </span>
        <span>
          <RiskMark kind="bundle" title={tr("bundleWallet")} /> {tr("bundle")}
        </span>
        <span>
          <DevMark /> {tr("developer")}
        </span>
        <span>
          <DevMark alt /> {tr("devAlt")}
        </span>
        <span>{tr("clickAddrProfile")}</span>
      </div>

      {burns.length > 0 && (
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2329", fontSize: 11, color: "#848e9c" }}>
          <div style={{ fontWeight: 700, color: "#f6465d", marginBottom: 4 }}>{tr("burned")}</div>
          {burns.map((b) => (
            <div key={b.address} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
              <span title={b.address}>{b.label} {shortAddr(b.address)}</span>
              <span style={{ color: "#eaecef", fontWeight: 700, whiteSpace: "nowrap" }}>
                {fmtAmt(b.balanceWhole)} · {fmtPct(b.sharePct)}
              </span>
            </div>
          ))}
          {data?.burnedWhole != null && burns.length > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: "#f6465d" }}>
              <span>{tr("total")}</span>
              <span>{fmtAmt(data.burnedWhole)} · {fmtPct(data.burnedPct ?? 0)}</span>
            </div>
          )}
        </div>
      )}

      <Head />

      <div className="col-scroll" style={{ flex: 1, overflow: "auto", minHeight: 120 }}>
        {pool && (
          <div
            className="holder-pool holders-row"
            title={pool.kind === "v4" ? tr("poolV4Tokens") : tr("curveUnsold")}
            style={{
              display: "grid",
              gridTemplateColumns: COL,
              gap: 6,
              alignItems: "center",
              padding: "8px 10px",
              fontSize: 11,
            }}
          >
            <span style={{ color: "#00c3ff", fontWeight: 800 }}>💧</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ color: "#eaecef", fontWeight: 800 }}>{tr("liqPool")}</span>
              {pool.locked && (
                <span style={{ marginLeft: 6, color: "#0ecb81", fontSize: 10, fontWeight: 700 }}>{tr("locked")}</span>
              )}
              <span style={{ display: "block", fontSize: 10, color: "#5e6673" }}>
                {pool.kind === "v4" ? tr("v4pool") : tr("curveReserve")}
                {pool.wallet && pool.wallet.startsWith("0x") && (
                  <> · {shortAddr(pool.wallet)}</>
                )}
              </span>
            </span>
            <span style={{ textAlign: "right", color: "#00c3ff", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {fmtPct(pool.sharePct)}
            </span>
            <span style={{ textAlign: "right", color: "#eaecef", fontVariantNumeric: "tabular-nums" }}>
              {fmtAmt(pool.balanceWhole)}
            </span>
            <span style={{ textAlign: "right", color: "#eaecef", fontVariantNumeric: "tabular-nums" }}>
              {valueUsd(pool.valueEth, ethUsd)}
            </span>
            <span style={{ textAlign: "right", color: "#5e6673" }}>—</span>
            <span style={{ textAlign: "right", color: "#5e6673", fontSize: 10 }}>
              {pool.quoteWhole ? `${fmtAmt(pool.quoteWhole)} ${pool.quoteSymbol ?? "ETH"}` : "—"}
            </span>
          </div>
        )}

        {holders.length === 0 && !pool && (
          <div style={{ color: "#5e6673", fontSize: 12, textAlign: "center", marginTop: 20 }}>{tr("noHolders")}</div>
        )}
        {holders.map((h, i) => {
          const pnl = fmtSignedUsd(h.totalPnlEth ?? h.unrealizedPnlEth, ethUsd);
          const pct = h.pnlPct == null ? null : Number(h.pnlPct) * 100;
          const clusterTip = h.sameFunder
            ? tr("sameFunderN", { n: h.clusterSize, src: h.firstFunder ? shortAddr(h.firstFunder) : "?" })
            : undefined;
          const created = ageLabel(h.firstSeenAt);
          const active = ageLabel(h.lastSeenAt);
          return (
            <div
              key={h.wallet}
              className={`holders-row${h.sameFunder ? " holder-cluster" : ""}`}
              title={clusterTip}
              style={{
                display: "grid",
                gridTemplateColumns: COL,
                gap: 6,
                alignItems: "center",
                padding: "7px 10px",
                fontSize: 11,
                background: i % 2 ? "#0f1319" : "transparent",
              }}
            >
              <span style={{ color: i < 3 ? "#f0b90b" : "#5e6673", fontWeight: 700, fontSize: 11 }}>{i + 1}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                <EmojiAvatar seed={h.wallet} size={16} />
                <Link
                  href={`/profile?address=${h.wallet}`}
                  style={{ fontFamily: "monospace", color: "#eaecef", textDecoration: "none" }}
                  title={`${h.wallet} · ${tr("clickProfile")}`}
                >
                  {shortAddr(h.wallet)}
                </Link>
                <a
                  href={addressUrl(CHAIN_ID, h.wallet)}
                  target="_blank"
                  rel="noreferrer"
                  title={tr("openExplorer")}
                  style={{ color: "#3d4450", textDecoration: "none", fontSize: 10, flexShrink: 0 }}
                >
                  ↗
                </a>
                {h.isDev && <DevMark />}
                {h.isDevAlt && <DevMark alt />}
                {h.isPhish && <RiskMark kind="phish" title={tr("phishMix")} />}
                {h.isBundle && <RiskMark kind="bundle" title={clusterTip ?? tr("bundleWallet")} />}
                {(created || active) && (
                  <span style={{ color: "#5e6673", fontSize: 10, whiteSpace: "nowrap" }}>
                    {created ?? "—"}
                    {active ? ` · ${active}` : ""}
                  </span>
                )}
              </span>
              <span style={{ textAlign: "right", color: "#eaecef", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {fmtPct(h.sharePct)}
              </span>
              <span style={{ textAlign: "right", color: "#848e9c", fontVariantNumeric: "tabular-nums" }}>
                {fmtAmt(h.balanceWhole)}
              </span>
              <span style={{ textAlign: "right", color: "#eaecef", fontVariantNumeric: "tabular-nums" }}>
                {valueUsd(h.valueEth, ethUsd)}
              </span>
              <span style={{ textAlign: "right", color: "#eaecef", fontVariantNumeric: "tabular-nums" }}>
                {fmtPriceUsd(h.avgCostEth, ethUsd)}
              </span>
              <span style={{ textAlign: "right", color: pnl.color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {pnl.text}
                {pct != null && Number.isFinite(pct) && (
                  <span style={{ marginLeft: 4, fontWeight: 600, fontSize: 10 }}>
                    {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );

  if (embedded) {
    return <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>{body}</div>;
  }
  return (
    <div style={{ border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      {body}
    </div>
  );
}
