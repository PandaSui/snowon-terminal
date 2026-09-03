"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { addressUrl } from "@/lib/explorers";
import { fmtPriceUsd, fmtUsdCompact } from "@/lib/quoteUnit";

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
  return (
    <span
      title={alt ? "开发小号:资金链与开发者关联(开发者或其小号出资)" : "开发者:代币创建者"}
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
      {alt ? "小号" : "开发"}
    </span>
  );
}

function RiskMark({ kind, title }: { kind: "phish" | "bundle"; title: string }) {
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
      {kind === "phish" ? "钓" : "捆"}
    </span>
  );
}

function Head() {
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
      <span>钱包</span>
      <span style={{ textAlign: "right" }}>占比</span>
      <span style={{ textAlign: "right" }}>数量</span>
      <span style={{ textAlign: "right" }}>价值</span>
      <span style={{ textAlign: "right" }}>成本</span>
      <span style={{ textAlign: "right" }}>盈亏</span>
    </div>
  );
}

/** 持有者 + 流动池置顶 + 成本/盈亏 + 同资金来源虚线 + 钓鱼/捆绑红标 */
export function HoldersPanel({ address, embedded, ethUsd }: { address: string; embedded?: boolean; ethUsd?: number }) {
  const { data } = useQuery({
    queryKey: ["holders", address],
    queryFn: async () => {
      const res = await fetch(`/api/token/${address}/holders`);
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
          🐳 持有者
          <span style={{ marginLeft: 8, fontSize: 11, color: "#5e6673", fontWeight: 400 }}>
            {data ? `${data.holderCount} 个地址` : "加载中…"}
            {flagged > 0 && <span style={{ color: "#f6465d", marginLeft: 6 }}>{flagged} 标红</span>}
          </span>
        </div>
      )}

      {embedded && data && (
        <div style={{ padding: "6px 10px 0", fontSize: 11, color: "#5e6673" }}>
          {data.holderCount} 个地址
          {flagged > 0 && <span style={{ color: "#f6465d", marginLeft: 6 }}>{flagged} 标红</span>}
        </div>
      )}

      {top10Pct != null && (
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2329", fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#848e9c" }}>
            <span>Top10 集中度（占总量）</span>
            <span style={{ color: riskColor, fontWeight: 700 }}>{top10Pct.toFixed(1)}%</span>
          </div>
          <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: "#1e2329", overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, top10Pct)}%`, height: "100%", background: riskColor }} />
          </div>
          {data?.devSharePct != null && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "#848e9c", marginTop: 6 }}>
              <span title="代币创建者 + 其资金链关联小号(两级)的合计持仓">👨‍💻 开发者系合计{data.devAltCount ? `(${data.devAltCount} 个小号)` : ""}</span>
              <span style={{ color: data.devSharePct > 10 ? "#f6465d" : data.devSharePct > 5 ? "#f0b90b" : "#eaecef", fontWeight: 700 }}>
                {fmtPct(data.devSharePct)}
              </span>
            </div>
          )}
          {(data?.top10AvgCostEth || data?.top100AvgCostEth) && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#848e9c", marginTop: 6 }}>
              <span title="前 10 / 前 100 大持仓地址的加权平均成本价(仅统计被索引的买入,转入的币成本为 0)">平均持仓价(前10 / 前100)</span>
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
          <span style={{ color: "#f6465d", fontWeight: 800 }}>┆</span> 红虚线=同资金来源
        </span>
        <span>
          <RiskMark kind="phish" title="钓鱼/混币钱包" /> 钓鱼
        </span>
        <span>
          <RiskMark kind="bundle" title="捆绑钱包" /> 捆绑
        </span>
        <span>
          <DevMark /> 开发者
        </span>
        <span>
          <DevMark alt /> 开发小号
        </span>
        <span>点地址看主页 · 占比按代币总量</span>
      </div>

      {burns.length > 0 && (
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2329", fontSize: 11, color: "#848e9c" }}>
          <div style={{ fontWeight: 700, color: "#f6465d", marginBottom: 4 }}>🔥 已销毁</div>
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
              <span>合计</span>
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
            title={pool.kind === "v4" ? "毕业后 V4 池中的代币" : "曲线未售出的代币储备"}
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
              <span style={{ color: "#eaecef", fontWeight: 800 }}>流动池</span>
              {pool.locked && (
                <span style={{ marginLeft: 6, color: "#0ecb81", fontSize: 10, fontWeight: 700 }}>锁</span>
              )}
              <span style={{ display: "block", fontSize: 10, color: "#5e6673" }}>
                {pool.kind === "v4" ? "V4 池" : "曲线储备"}
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
          <div style={{ color: "#5e6673", fontSize: 12, textAlign: "center", marginTop: 20 }}>暂无持仓数据</div>
        )}
        {holders.map((h, i) => {
          const pnl = fmtSignedUsd(h.totalPnlEth ?? h.unrealizedPnlEth, ethUsd);
          const pct = h.pnlPct == null ? null : Number(h.pnlPct) * 100;
          const clusterTip = h.sameFunder
            ? `同资金来源 ${h.clusterSize} 个地址 · 来源 ${h.firstFunder ? shortAddr(h.firstFunder) : "?"}`
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
                <Link
                  href={`/profile?address=${h.wallet}`}
                  style={{ fontFamily: "monospace", color: "#eaecef", textDecoration: "none" }}
                  title={`${h.wallet} · 点击查看 TA 的主页`}
                >
                  {shortAddr(h.wallet)}
                </Link>
                <a
                  href={addressUrl(CHAIN_ID, h.wallet)}
                  target="_blank"
                  rel="noreferrer"
                  title="在浏览器打开"
                  style={{ color: "#3d4450", textDecoration: "none", fontSize: 10, flexShrink: 0 }}
                >
                  ↗
                </a>
                {h.isDev && <DevMark />}
                {h.isDevAlt && <DevMark alt />}
                {h.isPhish && <RiskMark kind="phish" title="钓鱼/混币钱包" />}
                {h.isBundle && <RiskMark kind="bundle" title={clusterTip ?? "捆绑钱包"} />}
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
