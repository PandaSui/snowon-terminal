"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { useQuoteUnit } from "@/lib/quoteUnit";
import { HoldersPanel } from "./HoldersPanel";
import { TradeHistoryPanel } from "./TradeHistoryPanel";
import { TokenAnalysisPanel } from "./TokenAnalysisPanel";
import { PoolPairBar } from "./PoolPairBar";

const TABS = [
  { key: "trades", label: "交易" },
  { key: "holders", label: "持有者" },
  { key: "analysis", label: "分析" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** 代币页底部左栏:交易历史 / 持有者 / AI 分析,顶栏可切换,金额可切 ETH/USD */
function tabFromHash(): TabKey {
  if (typeof window === "undefined") return "trades";
  const h = window.location.hash.replace("#", "");
  if (h === "holders" || h === "analysis" || h === "trades") return h;
  return "trades";
}

export function TokenDataTabs({ address }: { address: string }) {
  const [tab, setTab] = useState<TabKey>("trades");
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [unit, setUnit] = useQuoteUnit();
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch("/api/eth-price");
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });
  const { data: holdersMeta } = useQuery({
    queryKey: ["holders", address],
    queryFn: async () => {
      const res = await fetch(`/api/token/${address}/holders`);
      return readJson<{ holderCount?: number; pool?: { sharePct?: number } | null }>(res);
    },
    staleTime: 12_000,
    refetchInterval: 15_000,
  });

  return (
    <div
      style={{
        border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117",
        display: "flex", flexDirection: "column", minHeight: 0, height: "100%",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 2, padding: "4px 6px 0",
          borderBottom: "1px solid #1e2329", flexShrink: 0,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              if (typeof window !== "undefined") {
                const url = new URL(window.location.href);
                url.hash = t.key === "trades" ? "" : t.key;
                history.replaceState(null, "", url.pathname + url.search + url.hash);
              }
            }}
            style={{
              padding: "8px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer",
              border: 0, background: "transparent",
              color: tab === t.key ? "#f0b90b" : "#5e6673",
              borderBottom: `2px solid ${tab === t.key ? "#f0b90b" : "transparent"}`,
            }}
          >
            {t.label}
            {t.key === "holders" && holdersMeta?.holderCount != null && (
              <span style={{ marginLeft: 4, fontWeight: 600 }}>{holdersMeta.holderCount}</span>
            )}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", padding: "4px 4px 6px" }}>
          {(["eth", "usd"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              title={u === "eth" ? "用 ETH 计价" : "用美元计价"}
              style={{
                padding: "3px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer",
                border: "1px solid #2b3139",
                background: unit === u ? "#f0b90b" : "#1c2127",
                color: unit === u ? "#0b0e11" : "#848e9c",
                borderRadius: u === "eth" ? "4px 0 0 4px" : "0 4px 4px 0",
              }}
            >
              {u === "eth" ? "ETH" : "USD"}
            </button>
          ))}
        </div>
      </div>
      {tab === "trades" && <PoolPairBar address={address} unit={unit} ethUsd={eth?.price} />}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "trades" && <TradeHistoryPanel address={address} unit={unit} ethUsd={eth?.price} />}
        {tab === "holders" && <HoldersPanel address={address} embedded ethUsd={eth?.price} />}
        {tab === "analysis" && <TokenAnalysisPanel address={address} unit={unit} ethUsd={eth?.price} />}
      </div>
    </div>
  );
}
