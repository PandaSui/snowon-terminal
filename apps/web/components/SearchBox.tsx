"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readJson } from "@/lib/http";
import { openWalletTracker } from "@/lib/favorites";
import { TokenLogo } from "./TokenLogo";

interface SearchToken {
  address: string;
  name: string;
  symbol: string;
  logoUri: string | null;
  graduated: boolean;
}

interface SearchResult {
  kind: "address" | "text" | "empty";
  tokens: SearchToken[];
  isToken?: boolean;
  address?: string;
}

/** 全局搜索框:代币名 / 代币合约地址 / 钱包地址 三路识别 */
export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function onChange(v: string) {
    setQ(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    const query = v.trim();
    if (!query) {
      setResult(null);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const body = await readJson<SearchResult>(res);
        setResult(body);
        setOpen(true);
      } catch { /* 静默,不打断输入 */ }
    }, 250);
  }

  function goToken(address: string) {
    setOpen(false);
    setQ("");
    router.push(`/token/${address}`);
  }

  function trackWallet(address: string) {
    openWalletTracker(address);
    setOpen(false);
    setQ("");
  }

  const isAddr = result?.kind === "address";

  return (
    <div ref={ref} style={{ position: "relative", width: 380, maxWidth: "38vw" }}>
      <input
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => result && setOpen(true)}
        placeholder="搜索 / 代币名 / 代币合约地址 / 钱包地址"
        style={{
          width: "100%", boxSizing: "border-box", padding: "7px 12px 7px 30px", fontSize: 12,
          background: "#10141b", border: "1px solid #2b3139", borderRadius: 8,
          color: "#fff", outline: "none",
        }}
      />
      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#5e6673", fontSize: 12 }}>🔍</span>

      {open && result && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 60,
            background: "#0d1117", border: "1px solid #2b3139", borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)", overflow: "hidden", fontSize: 12,
          }}
        >
          {isAddr && (
            <>
              {result.isToken ? (
                <DropItem onClick={() => goToken(result.address!)}>
                  <TokenLogo src={result.tokens[0]?.logoUri ?? null} alt={result.tokens[0]?.symbol ?? "?"} size={22} />
                  <span>
                    <b>{result.tokens[0]?.name}</b> (${result.tokens[0]?.symbol})
                    <span style={{ color: "#5e6673", marginLeft: 8, fontFamily: "monospace" }}>{result.address}</span>
                  </span>
                  <span style={{ marginLeft: "auto", color: "#f0b90b" }}>查看代币 →</span>
                </DropItem>
              ) : (
                <div style={{ padding: "8px 12px", color: "#5e6673" }}>该地址不是已索引的代币合约</div>
              )}
              <DropItem onClick={() => trackWallet(result.address!)}>
                <span>👁</span>
                <span style={{ fontFamily: "monospace" }}>{result.address}</span>
                <span style={{ marginLeft: "auto", color: "#f0b90b" }}>追踪该钱包 →</span>
              </DropItem>
            </>
          )}

          {result.kind === "text" && result.tokens.length === 0 && (
            <div style={{ padding: "8px 12px", color: "#5e6673" }}>没有匹配的代币</div>
          )}
          {result.kind === "text" &&
            result.tokens.map((t) => (
              <DropItem key={t.address} onClick={() => goToken(t.address)}>
                <TokenLogo src={t.logoUri} alt={t.symbol} size={22} />
                <span>
                  <b>{t.name}</b> <span style={{ color: "#848e9c" }}>${t.symbol}</span>
                </span>
                {t.graduated && <span style={{ color: "#0ecb81", fontSize: 10 }}>已毕业</span>}
              </DropItem>
            ))}
        </div>
      )}
    </div>
  );
}

function DropItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className="token-card"
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #161b22" }}
    >
      {children}
    </div>
  );
}
