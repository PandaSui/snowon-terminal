"use client";

import { apiUrl } from "@/lib/apiBase";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { CHART_RESOLUTIONS, type ChartResolution } from "@/lib/chartResolutions";
import { fmtUsdCompact, weiToEth } from "@/lib/quoteUnit";

interface WindowStats {
  vol: string;
  buyVol: string;
  sellVol: string;
  buys: number;
  sells: number;
}

type TokenStats = Record<(typeof CHART_RESOLUTIONS)[number]["statsKey"], WindowStats>;

function fmtVol(wei: string | number | undefined, ethUsd?: number): string {
  const eth = weiToEth(wei == null ? undefined : String(wei));
  if (!Number.isFinite(eth) || eth <= 0) return "$0";
  if (ethUsd && ethUsd > 0) return fmtUsdCompact(eth * ethUsd);
  if (eth >= 100) return `${eth.toFixed(2)} ETH`;
  if (eth >= 1) return `${eth.toFixed(3)} ETH`;
  if (eth >= 0.01) return `${eth.toFixed(4)} ETH`;
  return `${eth.toFixed(5)} ETH`;
}

/** 时段总成交量 + 买入/卖出成交量,点击同步 K 线周期 */
export function TokenStatsBar({
  address,
  resolution,
  onResolutionChange,
}: {
  address: string;
  resolution?: ChartResolution | string;
  onResolutionChange?: (r: ChartResolution) => void;
}) {
  const { data: s } = useQuery({
    queryKey: ["token-stats", address],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/stats`));
      return readJson<TokenStats>(res);
    },
    refetchInterval: 10_000,
  });
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });

  if (!s) return null;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%", alignItems: "stretch" }}>
      {CHART_RESOLUTIONS.map(({ label, value, statsKey }) => {
        const w = s[statsKey];
        if (!w) return null;
        const total = Number(w.vol ?? 0);
        const buyV = Number(w.buyVol ?? 0);
        const sellV = Number(w.sellVol ?? 0);
        const buyPct = total > 0 ? (buyV / total) * 100 : 50;
        const active = resolution === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onResolutionChange?.(value)}
            title={`切换到 ${label} K线`}
            style={{
              minWidth: 118, flex: 1, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
              textAlign: "left",
              border: `1px solid ${active ? "#f0b90b" : "#1e2329"}`,
              background: active ? "#16140a" : "#0d1117",
              fontSize: 11, color: "inherit",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", color: "#5e6673" }}>
              <span style={{ fontWeight: 700, color: active ? "#f0b90b" : "#848e9c" }}>{label}</span>
              <span style={{ color: "#eaecef", fontWeight: 800 }}>{fmtVol(w.vol, eth?.price)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, gap: 8 }}>
              <span style={{ color: "#0ecb81" }}>
                买 {fmtVol(w.buyVol, eth?.price)} <span style={{ opacity: 0.7 }}>({w.buys})</span>
              </span>
              <span style={{ color: "#f6465d" }}>
                卖 {fmtVol(w.sellVol, eth?.price)} <span style={{ opacity: 0.7 }}>({w.sells})</span>
              </span>
            </div>
            <div style={{ marginTop: 5, height: 3, borderRadius: 2, background: "#f6465d", overflow: "hidden" }}>
              <div style={{ width: `${buyPct}%`, height: "100%", background: "#0ecb81" }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
