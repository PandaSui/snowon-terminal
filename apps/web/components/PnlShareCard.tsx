"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";

interface Position {
  tokenAddress: string;
  balanceWhole: string;
  costBasisEth: string;
  realizedPnlEth: string;
  valueEth: string | null;
}

/** 我的 PNL 卡(可分享):登录且持有该代币时显示;分享=复制战报文本到剪贴板 */
export function PnlShareCard({ tokenAddress, symbol }: { tokenAddress: string; symbol: string }) {
  const { authenticated, user } = usePrivy();
  const address = user?.wallet?.address?.toLowerCase();
  const [copied, setCopied] = useState(false);

  const { data: positions } = useQuery({
    queryKey: ["portfolio", address],
    enabled: !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await fetch(`/api/portfolio?address=${address}`);
      const body = await readJson<Position[]>(res);
      return Array.isArray(body) ? body : [];
    },
  });

  if (!authenticated || !address) return null;
  const pos = positions?.find((p) => p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
  if (!pos) return null;

  const value = Number(pos.valueEth ?? 0);
  const cost = Number(pos.costBasisEth ?? 0);
  const unrealized = value - cost;
  const realized = Number(pos.realizedPnlEth ?? 0);
  const total = unrealized + realized;
  const pct = cost > 0 ? (unrealized / cost) * 100 : 0;
  const positive = total >= 0;

  async function share() {
    const text = `我在 SnowOn Terminal 交易 $${symbol},当前盈亏 ${positive ? "+" : ""}${total.toFixed(4)} ETH(${positive ? "+" : ""}${pct.toFixed(1)}%)🚀 ${window.location.href}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 剪贴板不可用时静默 */ }
  }

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
        borderRadius: 8, fontSize: 12,
        border: `1px solid ${positive ? "#0ecb8144" : "#f6465d44"}`,
        background: positive ? "rgba(14,203,129,0.06)" : "rgba(246,70,93,0.06)",
      }}
    >
      <span style={{ color: "#848e9c" }}>我的 PNL</span>
      <span style={{ fontWeight: 800, color: positive ? "#0ecb81" : "#f6465d", fontVariantNumeric: "tabular-nums" }}>
        {positive ? "+" : ""}{total.toFixed(4)} ETH ({positive ? "+" : ""}{pct.toFixed(1)}%)
      </span>
      <button
        onClick={share}
        style={{
          marginLeft: "auto", padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
          borderRadius: 6, border: "1px solid #2b3139", background: "transparent", color: "#848e9c",
        }}
      >
        {copied ? "✅ 已复制" : "📤 分享"}
      </button>
    </div>
  );
}
