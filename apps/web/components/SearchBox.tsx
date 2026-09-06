"use client";

import { apiUrl } from "@/lib/apiBase";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readJson } from "@/lib/http";
import { openWalletTracker } from "@/lib/favorites";
import { TokenLogo } from "./TokenLogo";
import { EmojiAvatar } from "./EmojiAvatar";
import { TranslatedText } from "@/lib/useTranslated";
import { useT } from "@/lib/locale";

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
  const tr = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
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
        const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(query)}`));
        const body = await readJson<SearchResult>(res);
        setResult(body);
        setCopied(false);
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
    router.push("/track");
  }

  function copyAddress(address: string) {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  const isAddr = result?.kind === "address";
  // 合约地址命中代币 → 居中大弹窗;其余维持输入框下方下拉
  const showTokenModal = !!(open && isAddr && result?.isToken && result.tokens[0]);
  const modalToken = showTokenModal ? result!.tokens[0] : null;

  return (
    <div ref={ref} style={{ position: "relative", width: 380, maxWidth: "38vw" }}>
      <input
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => result && setOpen(true)}
        placeholder={tr("searchPh")}
        style={{
          width: "100%", boxSizing: "border-box", padding: "7px 12px 7px 30px", fontSize: 12,
          background: "#10141b", border: "1px solid #2b3139", borderRadius: 8,
          color: "#fff", outline: "none",
        }}
      />
      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#5e6673", fontSize: 12 }}>🔍</span>

      {showTokenModal && modalToken && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 92vw)", background: "#0d1117", border: "1px solid #2b3139",
              borderRadius: 14, padding: "22px 22px 18px", boxShadow: "0 24px 64px rgba(0,0,0,0.65)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <TokenLogo src={modalToken.logoUri} alt={modalToken.symbol} size={56} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 18, fontWeight: 800 }}><TranslatedText text={modalToken.name} /></span>
                  <span style={{ fontSize: 13, color: "#848e9c", fontWeight: 700 }}>${modalToken.symbol}</span>
                  {modalToken.graduated && (
                    <span style={{ fontSize: 10, color: "#0ecb81", fontWeight: 700, border: "1px solid rgba(14,203,129,0.4)", borderRadius: 4, padding: "1px 5px" }}>
                      {tr("graduatedTag")}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "#5e6673", wordBreak: "break-all" }}>
                    {result!.address}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyAddress(result!.address!)}
                    style={{
                      flexShrink: 0, padding: "2px 8px", fontSize: 10, cursor: "pointer",
                      background: "#1c2127", border: "1px solid #2b3139", borderRadius: 4,
                      color: copied ? "#0ecb81" : "#848e9c",
                    }}
                  >
                    {copied ? `✓ ${tr("copied")}` : tr("copy")}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => goToken(result!.address!)}
                style={{
                  flex: 1, padding: "11px 0", border: 0, borderRadius: 8, cursor: "pointer",
                  background: "#f0b90b", color: "#000", fontWeight: 800, fontSize: 14,
                }}
              >
                {tr("viewToken")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: "11px 18px", borderRadius: 8, cursor: "pointer",
                  background: "#1c2127", border: "1px solid #2b3139", color: "#848e9c", fontWeight: 700, fontSize: 13,
                }}
              >
                {tr("close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {open && result && !showTokenModal && (
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
                    <b><TranslatedText text={result.tokens[0]?.name ?? ""} /></b> (${result.tokens[0]?.symbol})
                    <span style={{ color: "#5e6673", marginLeft: 8, fontFamily: "monospace" }}>{result.address}</span>
                  </span>
                  <span style={{ marginLeft: "auto", color: "#f0b90b" }}>{tr("viewToken")}</span>
                </DropItem>
              ) : (
                <div style={{ padding: "8px 12px", color: "#5e6673" }}>{tr("notIndexed")}</div>
              )}
              <DropItem onClick={() => trackWallet(result.address!)}>
                <EmojiAvatar seed={result.address!} size={22} />
                <span style={{ fontFamily: "monospace" }}>{result.address}</span>
                <span style={{ marginLeft: "auto", color: "#f0b90b" }}>{tr("trackThisWallet")}</span>
              </DropItem>
            </>
          )}

          {result.kind === "text" && result.tokens.length === 0 && (
            <div style={{ padding: "8px 12px", color: "#5e6673" }}>{tr("noMatch")}</div>
          )}
          {result.kind === "text" &&
            result.tokens.map((t) => (
              <DropItem key={t.address} onClick={() => goToken(t.address)}>
                <TokenLogo src={t.logoUri} alt={t.symbol} size={22} />
                <span>
                  <b><TranslatedText text={t.name} /></b> <span style={{ color: "#848e9c" }}>${t.symbol}</span>
                </span>
                {t.graduated && <span style={{ color: "#0ecb81", fontSize: 10 }}>{tr("graduatedTag")}</span>}
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
