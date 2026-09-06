"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { TokenLogo } from "./TokenLogo";
import { useT } from "@/lib/locale";

interface Position {
  tokenAddress: string;
  name: string | null;
  symbol: string | null;
  logoUri: string | null;
  graduated: boolean;
  balanceWhole: string;
  costBasisEth: string;
  realizedPnlEth: string;
  priceEth: string | null;
  valueEth: string | null;
}

/** 资产面板:已登录钱包的持仓估值 + 盈亏 */
export function PortfolioPanel() {
  const tr = useT();
  const { authenticated, login, user } = usePrivy();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const address = user?.wallet?.address?.toLowerCase();

  const { data: positions, isFetching } = useQuery({
    queryKey: ["portfolio", address],
    enabled: open && !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/portfolio?address=${address}`));
      const body = await readJson<Position[] | { error?: string }>(res);
      if (!res.ok || !Array.isArray(body)) throw new Error("load failed");
      return body;
    },
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const totalValue = (positions ?? []).reduce((s, p) => s + Number(p.valueEth ?? 0), 0);
  const totalRealized = (positions ?? []).reduce((s, p) => s + Number(p.realizedPnlEth ?? 0), 0);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={hdrBtn(open)}>
        {tr("assets")}
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60,
            width: 360, background: "#0d1117", border: "1px solid #2b3139", borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)", overflow: "hidden", fontSize: 12,
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #1e2329", fontWeight: 700 }}>
            {tr("myAssets")}
            {address && (
              <span style={{ marginLeft: 8, fontSize: 11, color: "#5e6673", fontFamily: "monospace", fontWeight: 400 }}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
            )}
          </div>

          {!authenticated ? (
            <div style={{ padding: 16, textAlign: "center" }}>
              <div style={{ color: "#5e6673", marginBottom: 10 }}>{tr("loginToSee")}</div>
              <button onClick={login} style={{ padding: "7px 18px", border: 0, borderRadius: 6, background: "#f0b90b", fontWeight: 700, cursor: "pointer" }}>
                {tr("login")}
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, padding: "10px 12px", borderBottom: "1px solid #1e2329" }}>
                <span style={{ color: "#848e9c" }}>
                  {tr("posValue")} <b style={{ color: "#eaecef" }}>{totalValue.toFixed(4)} ETH</b>
                </span>
                <span style={{ color: "#848e9c" }}>
                  {tr("realizedPnl")}{" "}
                  <b style={{ color: totalRealized >= 0 ? "#0ecb81" : "#f6465d" }}>
                    {totalRealized >= 0 ? "+" : ""}{totalRealized.toFixed(4)} ETH
                  </b>
                </span>
              </div>
              <div className="col-scroll" style={{ maxHeight: 320, overflowY: "auto", padding: "4px 12px 8px" }}>
                {isFetching && !positions && <div style={{ color: "#5e6673", padding: "12px 0", textAlign: "center" }}>{tr("loading")}</div>}
                {positions && positions.length === 0 && (
                  <div style={{ color: "#5e6673", padding: "12px 0", textAlign: "center" }}>{tr("noPositions")}</div>
                )}
                {positions?.map((p) => {
                  const value = Number(p.valueEth ?? 0);
                  const cost = Number(p.costBasisEth ?? 0);
                  const unrealized = value - cost;
                  return (
                    <Link
                      key={p.tokenAddress}
                      href={`/token/${p.tokenAddress}`}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #161b22", textDecoration: "none", color: "inherit" }}
                    >
                      <TokenLogo src={p.logoUri} alt={p.symbol ?? "?"} size={22} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{p.symbol ?? "?"}</b>
                        <span style={{ color: "#5e6673", marginLeft: 6, fontSize: 11 }}>
                          {tr("nPieces", { n: Number(p.balanceWhole).toLocaleString("en-US", { maximumFractionDigits: 0 }) })}
                        </span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700 }}>{value.toFixed(4)} ETH</div>
                        <div style={{ fontSize: 11, color: unrealized >= 0 ? "#0ecb81" : "#f6465d" }}>
                          {unrealized >= 0 ? "+" : ""}{unrealized.toFixed(4)}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
              <div style={{ padding: "8px 12px", borderTop: "1px solid #1e2329" }}>
                <Link
                  href="/profile"
                  style={{
                    display: "block", textAlign: "center", padding: "7px 0", borderRadius: 6,
                    background: "#1c1f26", border: "1px solid #2b3139", textDecoration: "none",
                    color: "#f0b90b", fontWeight: 700, fontSize: 12,
                  }}
                >
                  {tr("profileLink")}
                </Link>
              </div>
            </>
          )}
        </div>
      )}
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
