"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FAVORITES_EVENT, getFavorites } from "@/lib/favorites";
import { useQuery } from "@tanstack/react-query";
import { TokenLogo } from "./TokenLogo";
import { useT } from "@/lib/locale";
import type { HomeToken } from "./TokenCard";
import { readJson } from "@/lib/http";
import { fmtPriceUsd } from "@/lib/quoteUnit";

/**
 * 标星收藏代币栏(顶部栏下方的全宽细条)。
 * 卡片右上角 ☆ 收藏后出现在这里;点击芯片直达代币页。
 */
export function FavoritesBar({ tokens }: { tokens: HomeToken[] }) {
  const tr = useT();
  const [favs, setFavs] = useState<string[]>([]);
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    const sync = () => setFavs(getFavorites());
    sync();
    window.addEventListener(FAVORITES_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_EVENT, sync);
  }, []);

  const starred = favs
    .map((addr) => tokens.find((t) => t.address.toLowerCase() === addr))
    .filter((t): t is HomeToken => !!t);

  return (
    <div
      style={{
        flexShrink: 0, minHeight: 34, display: "flex", alignItems: "center", gap: 8,
        padding: "0 12px", background: "#10141b", border: "1px solid #1e2329",
        borderRadius: 8, overflowX: "auto", fontSize: 12,
      }}
    >
      <span style={{ flexShrink: 0, fontSize: 11, color: "#f0b90b", fontWeight: 700, letterSpacing: 1 }}>{tr("favorites")}</span>
      {starred.length === 0 ? (
        <span style={{ color: "#3d4450", fontSize: 11 }}>{tr("favoritesHint")}</span>
      ) : (
        starred.map((t) => {
          const pct = t.change24hPct == null ? null : Number(t.change24hPct) * 100;
          return (
            <Link
              key={t.address}
              href={`/token/${t.address}`}
              style={{
                flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6,
                padding: "3px 10px", borderRadius: 14, textDecoration: "none",
                border: "1px solid #2b3139", background: "#0b0e11", color: "#eaecef",
              }}
            >
              <TokenLogo src={t.logoUri} alt={t.symbol} size={16} />
              <b style={{ fontSize: 11 }}>${t.symbol}</b>
              {t.priceEth != null && (
                <span style={{ fontSize: 10, color: "#848e9c", fontVariantNumeric: "tabular-nums" }}>
                  {fmtPriceUsd(t.priceEth, eth?.price)}
                </span>
              )}
              {pct != null && (
                <span style={{ fontSize: 11, fontWeight: 700, color: pct >= 0 ? "#0ecb81" : "#f6465d" }}>
                  {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                </span>
              )}
            </Link>
          );
        })
      )}
    </div>
  );
}
