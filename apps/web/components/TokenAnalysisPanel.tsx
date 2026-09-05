"use client";

import { apiUrl } from "@/lib/apiBase";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { fmtQuote, type QuoteUnit } from "@/lib/quoteUnit";

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
  const { data, isLoading, error } = useQuery({
    queryKey: ["token-analysis", address],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/token/${address}/analysis`));
      return readJson<Analysis>(res);
    },
    refetchInterval: 20_000,
  });

  if (isLoading) {
    return <div style={{ padding: 16, color: "#5e6673", fontSize: 12 }}>正在从成交与钱包库汇总…</div>;
  }
  if (error || !data) {
    return <div style={{ padding: 16, color: "#f6465d", fontSize: 12 }}>分析失败</div>;
  }

  const eth = (v: number) => fmtQuote(String(v * 1e18), unit, ethUsd);

  return (
    <div className="col-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 10px 12px", minHeight: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <Stat label="24h 成交" value={`${data.trades24h} 笔`} />
        <Stat label="参与钱包" value={`${data.uniqueTraders}`} />
        <Stat label="买盘" value={eth(data.buyVolEth)} color="#0ecb81" />
        <Stat label="卖盘" value={eth(data.sellVolEth)} color="#f6465d" />
        <Stat
          label="新钱包买入"
          value={`${(data.newWalletBuyShare * 100).toFixed(0)}% · ${data.newWalletCount}个`}
          color={data.newWalletBuyShare >= 0.3 ? "#f6465d" : "#f0b90b"}
        />
        <Stat
          label="同资金来源组"
          value={`${data.clusterCount} 组 · ${eth(data.clusterEth)}`}
          color={data.clusterCount > 0 ? "#f6465d" : "#848e9c"}
        />
      </div>

      {data.llm && (
        <div style={{ marginBottom: 10, padding: "8px 10px", background: "#16140a", border: "1px solid #3d3410", borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: "#eaecef" }}>
          <div style={{ fontSize: 10, color: "#f0b90b", fontWeight: 700, marginBottom: 4 }}>AI 结论</div>
          {data.llm}
        </div>
      )}

      <div style={{ fontSize: 10, color: "#5e6673", marginBottom: 6 }}>
        {data.llmEnabled ? "规则引擎 + 模型" : "规则引擎（配置 XAI_API_KEY 后由模型写结论）"}
      </div>
      {data.rules.map((r) => (
        <p key={r} style={{ margin: "0 0 8px", fontSize: 12, color: "#b7bcc5", lineHeight: 1.55 }}>
          {r}
        </p>
      ))}
    </div>
  );
}
