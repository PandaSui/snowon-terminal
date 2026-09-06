"use client";

import { apiUrl } from "@/lib/apiBase";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { fmtQuote, type QuoteUnit } from "@/lib/quoteUnit";
import { useLocale, useT, type TFn } from "@/lib/locale";

interface Analysis {
  trades24h: number;
  uniqueTraders: number;
  buyVolEth: number;
  sellVolEth: number;
  newWalletCount: number;
  newWalletBuyEth: number;
  newWalletBuyShare: number;
  clusterCount: number;
  clusterEth: number;
  phishEth: number;
  rules: string[];
  llm: string | null;
  llmEnabled: boolean;
}

export function localizedAnalysisRules(
  tr: TFn,
  s: Pick<Analysis, "trades24h" | "uniqueTraders" | "buyVolEth" | "sellVolEth" | "newWalletBuyShare" | "newWalletCount" | "clusterCount" | "clusterEth" | "phishEth">,
): string[] {
  if (s.trades24h === 0) return [tr("ruleNoTrades")];
  const out = [
    tr("ruleOverview", {
      trades: s.trades24h,
      wallets: s.uniqueTraders,
      buy: s.buyVolEth.toFixed(4),
      sell: s.sellVolEth.toFixed(4),
    }),
  ];
  const pct = (s.newWalletBuyShare * 100).toFixed(0);
  if (s.newWalletBuyShare >= 0.3) {
    out.push(tr("ruleNewHigh", { pct, n: s.newWalletCount }));
  } else if (s.newWalletCount > 0) {
    out.push(tr("ruleNewSome", { n: s.newWalletCount, pct }));
  }
  if (s.clusterCount >= 1) {
    out.push(tr("ruleCluster", { n: s.clusterCount, eth: s.clusterEth.toFixed(4) }));
  }
  if (s.phishEth > 0) {
    out.push(tr("rulePhishVol", { eth: s.phishEth.toFixed(4) }));
  }
  if (s.sellVolEth > s.buyVolEth * 1.4) out.push(tr("ruleSellHeavy"));
  else if (s.buyVolEth > s.sellVolEth * 1.4) out.push(tr("ruleBuyHeavy"));
  return out;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: "1 1 40%", minWidth: 110, padding: "6px 8px", background: "#10141b", borderRadius: 6, border: "1px solid #1e2329" }}>
      <div style={{ fontSize: 10, color: "#5e6673" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: color ?? "#eaecef", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

export function TokenAnalysisPanel({
  address,
  unit,
  ethUsd,
}: {
  address: string;
  unit: QuoteUnit;
  ethUsd?: number;
}) {
  const tr = useT();
  const [locale] = useLocale();
  const { data, isLoading, error } = useQuery({
    queryKey: ["token-analysis", address, locale],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/analysis?lang=${locale}`));
      return readJson<Analysis>(res);
    },
    refetchInterval: 20_000,
  });

  if (isLoading) {
    return <div style={{ padding: 16, color: "#5e6673", fontSize: 12 }}>{tr("analyzing")}</div>;
  }
  if (error || !data) {
    return <div style={{ padding: 16, color: "#f6465d", fontSize: 12 }}>{tr("analysisFail")}</div>;
  }

  const eth = (v: number) => fmtQuote(String(v * 1e18), unit, ethUsd);

  return (
    <div className="col-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 10px 12px", minHeight: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <Stat label={tr("trades24h")} value={tr("nTrades", { n: data.trades24h })} />
        <Stat label={tr("walletsIn")} value={`${data.uniqueTraders}`} />
        <Stat label={tr("buySide")} value={eth(data.buyVolEth)} color="#0ecb81" />
        <Stat label={tr("sellSide")} value={eth(data.sellVolEth)} color="#f6465d" />
        <Stat
          label={tr("newWalletBuy")}
          value={`${(data.newWalletBuyShare * 100).toFixed(0)}% · ${tr("nUnits", { n: data.newWalletCount })}`}
          color={data.newWalletBuyShare >= 0.3 ? "#f6465d" : "#f0b90b"}
        />
        <Stat
          label={tr("sameFunderGroups")}
          value={`${tr("nGroups", { n: data.clusterCount })} · ${eth(data.clusterEth)}`}
          color={data.clusterCount > 0 ? "#f6465d" : "#848e9c"}
        />
      </div>

      {data.llm && (
        <div style={{ marginBottom: 10, padding: "8px 10px", background: "#16140a", border: "1px solid #3d3410", borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: "#eaecef" }}>
          <div style={{ fontSize: 10, color: "#f0b90b", fontWeight: 700, marginBottom: 4 }}>{tr("aiVerdict")}</div>
          {data.llm}
        </div>
      )}

      <div style={{ fontSize: 10, color: "#5e6673", marginBottom: 6 }}>
        {data.llmEnabled ? tr("rulePlusModel") : tr("ruleEngine")}
      </div>
      {localizedAnalysisRules(tr, data).map((r) => (
        <p key={r} style={{ margin: "0 0 8px", fontSize: 12, color: "#b7bcc5", lineHeight: 1.55 }}>
          {r}
        </p>
      ))}
    </div>
  );
}
