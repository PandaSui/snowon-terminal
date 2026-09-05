"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import type { HomeToken } from "./TokenCard";

const PRESETS = [
  { key: "movers", label: "🔥 现在涨幅最高的代币?" },
  { key: "almost", label: "⏳ 谁最接近毕业?" },
  { key: "overview", label: "📊 平台现在什么情况?" },
  { key: "wallets", label: "🧠 这个币的交易钱包怎么看?" },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"];

/**
 * AI 入口:基于站内实时数据的问答面板(规则引擎版)。
 * 接入大模型后,这里换成流式对话;Preset 答案保留作快捷视图。
 */
export function AiPanel({ tokenAddress }: { tokenAddress?: string }) {
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
      <button onClick={() => setOpen((v) => !v)} style={hdrBtn(open)} title="AI 助手">
        ✦ AI
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
            ✦ AI 助手 <span style={{ fontSize: 11, color: "#5e6673", fontWeight: 400 }}>基于实时链上数据</span>
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
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ padding: "4px 12px 12px", minHeight: 40 }}>
            {!answer && <div style={{ color: "#5e6673" }}>点一个问题,我从当前盘面数据里给你答案。</div>}
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
  const { data, isLoading } = useQuery({
    queryKey: ["token-analysis", address],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/analysis`));
      return readJson<{ rules: string[]; llm: string | null; newWalletBuyShare: number; uniqueTraders: number }>(res);
    },
  });
  if (isLoading) return <span style={{ color: "#5e6673" }}>正在读成交与钱包库…</span>;
  if (!data) return <span style={{ color: "#5e6673" }}>没有这份代币的钱包样本。</span>;
  return (
    <div>
      {data.llm ? <p style={{ margin: "0 0 8px" }}>{data.llm}</p> : null}
      {data.rules.slice(0, 4).map((r) => (
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
  if (kind === "wallets") {
    if (!tokenAddress) return <span style={{ color: "#5e6673" }}>打开某个代币页再问钱包结构。</span>;
    return <WalletAnswer address={tokenAddress} />;
  }
  if (kind === "movers") {
    const top = [...tokens]
      .filter((t) => t.change24hPct != null)
      .sort((a, b) => Number(b.change24hPct) - Number(a.change24hPct))
      .slice(0, 3);
    if (!top.length) return <span style={{ color: "#5e6673" }}>24h 内还没有成交数据。</span>;
    return (
      <div>
        24h 涨幅前三:
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
    if (!top.length) return <span style={{ color: "#5e6673" }}>当前没有接近毕业的代币。</span>;
    return (
      <div>
        毕业进度最高:
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
      当前共索引 <b>{tokens.length}</b> 个代币:
      <span style={{ color: "#f0b90b" }}> {curve} 个曲线阶段</span>,
      <span style={{ color: "#0ecb81" }}> {graduated} 个已毕业</span>。
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
