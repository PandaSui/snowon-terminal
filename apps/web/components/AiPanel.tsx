"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import type { HomeToken } from "./TokenCard";
import { useLocale, useT } from "@/lib/locale";
import { localizedAnalysisRules } from "./TokenAnalysisPanel";

const PRESETS = [
  { key: "movers", q: "aiQ1" },
  { key: "almost", q: "aiQ2" },
  { key: "overview", q: "aiQ3" },
  { key: "wallets", q: "aiQ4" },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"];

/**
 * AI 入口:基于站内实时数据的问答面板(规则引擎版)。
 * 接入大模型后,这里换成流式对话;Preset 答案保留作快捷视图。
 */
export function AiPanel({ tokenAddress }: { tokenAddress?: string }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<PresetKey | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { data: tokens } = useQuery({
    queryKey: ["tokens"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/tokens"));
      const body = await readJson<HomeToken[]>(res);
      return Array.isArray(body) ? body : [];
    },
    refetchInterval: 10_000,
    enabled: open,
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={hdrBtn(open)} title={tr("aiHelper")}>
        {tr("ai")}
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60,
            width: 340, background: "#0d1117", border: "1px solid #2b3139", borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)", overflow: "hidden", fontSize: 12,
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #1e2329", fontWeight: 700 }}>
            {tr("aiHelper")} <span style={{ fontSize: 11, color: "#5e6673", fontWeight: 400 }}>{tr("aiSub")}</span>
          </div>
          <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {PRESETS.filter((p) => p.key !== "wallets" || tokenAddress).map((p) => (
              <button
                key={p.key}
                onClick={() => setAnswer(p.key)}
                style={{
                  textAlign: "left", padding: "8px 10px", fontSize: 12, cursor: "pointer",
                  background: answer === p.key ? "#1c1f26" : "#10141b",
                  border: "1px solid #2b3139", borderRadius: 8, color: "#eaecef",
                }}
              >
                {tr(p.q)}
              </button>
            ))}
          </div>
          <div style={{ padding: "4px 12px 12px", minHeight: 40 }}>
            {!answer && <div style={{ color: "#5e6673" }}>{tr("aiAsk")}</div>}
            {answer && tokens && (
              <Answer kind={answer} tokens={tokens} tokenAddress={tokenAddress} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WalletAnswer({ address }: { address: string }) {
  const tr = useT();
  const [locale] = useLocale();
  const { data, isLoading } = useQuery({
    queryKey: ["token-analysis", address, locale],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/analysis?lang=${locale}`));
      return readJson<{
        rules: string[];
        llm: string | null;
        trades24h: number;
        uniqueTraders: number;
        buyVolEth: number;
        sellVolEth: number;
        newWalletBuyShare: number;
        newWalletCount: number;
        clusterCount: number;
        clusterEth: number;
        phishEth: number;
      }>(res);
    },
  });
  if (isLoading) return <span style={{ color: "#5e6673" }}>{tr("readingWallets")}</span>;
  if (!data) return <span style={{ color: "#5e6673" }}>{tr("noWalletSample")}</span>;
  const rules = localizedAnalysisRules(tr, data);
  return (
    <div>
      {data.llm ? <p style={{ margin: "0 0 8px" }}>{data.llm}</p> : null}
      {rules.slice(0, 4).map((r) => (
        <div key={r} style={{ marginTop: 4, color: "#b7bcc5" }}>{r}</div>
      ))}
    </div>
  );
}

function Answer({
  kind,
  tokens,
  tokenAddress,
}: {
  kind: PresetKey;
  tokens: HomeToken[];
  tokenAddress?: string;
}) {
  const tr = useT();
  if (kind === "wallets") {
    if (!tokenAddress) return <span style={{ color: "#5e6673" }}>{tr("openTokenFirst")}</span>;
    return <WalletAnswer address={tokenAddress} />;
  }
  if (kind === "movers") {
    const top = [...tokens]
      .filter((t) => t.change24hPct != null)
      .sort((a, b) => Number(b.change24hPct) - Number(a.change24hPct))
      .slice(0, 3);
    if (!top.length) return <span style={{ color: "#5e6673" }}>{tr("no24hTrades")}</span>;
    return (
      <div>
        {tr("topGainers")}
        {top.map((t) => (
          <div key={t.address} style={{ marginTop: 4 }}>
            <Link href={`/token/${t.address}`} style={{ color: "#f0b90b", textDecoration: "none" }}>
              {t.name} (${t.symbol})
            </Link>
            <span style={{ color: "#0ecb81", fontWeight: 700, marginLeft: 6 }}>
              +{(Number(t.change24hPct) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "almost") {
    const top = [...tokens]
      .filter((t) => !t.graduated && Number(t.graduationProgress ?? 0) > 0)
      .sort((a, b) => Number(b.graduationProgress) - Number(a.graduationProgress))
      .slice(0, 3);
    if (!top.length) return <span style={{ color: "#5e6673" }}>{tr("noAlmost")}</span>;
    return (
      <div>
        {tr("closestGrad")}
        {top.map((t) => (
          <div key={t.address} style={{ marginTop: 4 }}>
            <Link href={`/token/${t.address}`} style={{ color: "#f0b90b", textDecoration: "none" }}>
              {t.name} (${t.symbol})
            </Link>
            <span style={{ color: "#0ecb81", fontWeight: 700, marginLeft: 6 }}>
              {(Number(t.graduationProgress) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    );
  }
  const graduated = tokens.filter((t) => t.graduated).length;
  const curve = tokens.length - graduated;
  return (
    <div>
      {tr("indexedN", { n: tokens.length })}
      <span style={{ color: "#f0b90b" }}> {tr("nOnCurve", { n: curve })}</span>
      <span style={{ color: "#0ecb81" }}> {tr("nGraduated", { n: graduated })}</span>
    </div>
  );
}

function hdrBtn(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
    background: active ? "#1c1f26" : "transparent",
    border: `1px solid ${active ? "#f0b90b" : "#2b3139"}`,
    borderRadius: 8, color: active ? "#f0b90b" : "#848e9c", whiteSpace: "nowrap",
  };
}
