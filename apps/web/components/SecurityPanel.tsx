"use client";

import { apiUrl } from "@/lib/apiBase";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { useT } from "@/lib/locale";

/** 与 /api/token/[address] 返回的代币行对应的字段(仅安全面板用到的) */
export interface TokenSecurity {
  address?: string;
  curveAddress?: string;
  creator?: string;
  poolId?: string | null;
  graduated?: boolean;
  lpLockedForever?: boolean;
  antiBundle?: boolean;
  antiSnipe?: boolean;
  buyTaxBps?: number;
  sellTaxBps?: number;
  github?: string | null;
  bundleScore?: { score: number } | null;
  platformId?: string;
}

interface OnchainSecurity {
  verified: boolean;
  contractName: string | null;
  compiler: string | null;
  isProxy: boolean;
  implementation: string | null;
  explorerUrl: string;
  curveVerified: boolean;
  curveName: string | null;
  curveExplorerUrl: string | null;
  github: string | null;
  graduated: boolean;
  lpLockedForever: boolean;
  lpLockPct: number | null;
  lpBurnPct: number | null;
  tokenBurnPct: number | null;
  poolLiquidity: string | null;
  poolId: string | null;
  owner: { status: "renounced" | "owned" | "none" | "unknown"; address: string | null } | null;
  blacklist: { detected: boolean; hits: string[] } | null;
  sellTaxOnchain: number | null;
  honeypotSuspected: boolean;
  sellRisk: "ok" | "warn" | "bad";
}

const OK = "#0ecb81";
const WARN = "#f0b90b";
const BAD = "#f6465d";
const DIM = "#5e6673";

function shortAddr(a: string) {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${n.toFixed(n >= 10 ? 1 : 2)}%`;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const tr = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      title={tr("clickCopy", { label })}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
        width: "100%", padding: "5px 0", background: "none", border: 0, borderBottom: "1px solid #161b22",
        cursor: "pointer", fontSize: 12, color: "#848e9c", textAlign: "left",
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: "monospace", color: copied ? OK : "#eaecef" }}>
        {copied ? `✓ ${tr("copied")}` : shortAddr(value)}
      </span>
    </button>
  );
}

function Row({ label, status, color, href, sub }: { label: string; status: string; color: string; href?: string; sub?: string }) {
  const right = (
    <span style={{ color, fontWeight: 700, textAlign: "right" }}>
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: color, marginRight: 6 }} />
      {status}
      {sub && <span style={{ display: "block", fontSize: 10, fontWeight: 400, color: DIM, marginTop: 2 }}>{sub}</span>}
    </span>
  );
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #161b22", fontSize: 12, color: "#848e9c" }}>
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>{right}</a>
      ) : right}
    </div>
  );
}

function RatioBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ margin: "2px 0 6px", height: 4, borderRadius: 2, background: "#1e2329", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: color }} />
    </div>
  );
}

function taxColor(bps: number) {
  return bps <= 0 ? OK : bps <= 500 ? WARN : BAD;
}

function lockColor(pct: number | null) {
  if (pct == null) return DIM;
  if (pct >= 100) return OK;
  if (pct >= 80) return WARN;
  return BAD;
}

/** 合约安全性 / 流动性池 / 开源信息面板(底部第三栏) */
export function SecurityPanel({ token }: { token: TokenSecurity }) {
  const tr = useT();
  const buyTax = token.buyTaxBps ?? 0;
  const sellTax = token.sellTaxBps ?? 0;
  const score = token.bundleScore?.score;
  const { data: sec } = useQuery({
    queryKey: ["token-security", token.address],
    enabled: !!token.address,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/token/${token.address}/security`));
      return readJson<OnchainSecurity>(r);
    },
  });

  const snowon = token.platformId === "snowon";
  const verified = sec?.verified ?? (snowon ? true : undefined);
  const contractName = sec?.contractName ?? (snowon ? "SnowLaunchToken" : null);
  const explorerUrl = sec?.explorerUrl ?? (token.address
    ? `https://robinhoodchain.blockscout.com/address/${token.address}#contract`
    : undefined);
  const lockPct = sec?.lpLockPct ?? (token.lpLockedForever && token.graduated ? 100 : token.graduated ? 0 : null);
  const burnPct = sec?.lpBurnPct ?? (token.lpLockedForever && token.graduated ? 100 : null);
  const tokenBurn = sec?.tokenBurnPct;

  return (
    <div style={{ border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1e2329", fontSize: 13, fontWeight: 700 }}>
        {tr("contractSecurity")}
      </div>

      <div className="col-scroll" style={{ padding: "4px 12px 8px" }}>
        <Row
          label={tr("contractOpenSource")}
          status={
            verified
              ? contractName
                ? tr("openSourcedName", { name: contractName })
                : `${tr("openSourced")} ↗`
              : verified === false
                ? token.github
                  ? tr("unverifiedGithub")
                  : tr("unverified")
                : tr("querying")
          }
          color={verified ? OK : verified === false && !token.github ? DIM : WARN}
          href={verified ? explorerUrl : token.github || explorerUrl}
          sub={verified && sec?.compiler ? sec.compiler.replace(/^v/, "solc ") : undefined}
        />
        {(sec?.curveVerified || snowon) && token.curveAddress && (
          <Row
            label={tr("curveOpenSource")}
            status={tr("openSourcedName", { name: sec?.curveName ? sec.curveName : "SnowBondingCurve" })}
            color={OK}
            href={sec?.curveExplorerUrl ?? `https://robinhoodchain.blockscout.com/address/${token.curveAddress}#contract`}
          />
        )}
        {token.github && verified && (
          <Row label="GitHub" status={tr("sourceRepo")} color={OK} href={token.github} />
        )}

        <div style={{ padding: "8px 0 2px", fontSize: 11, color: DIM, fontWeight: 700 }}>{tr("lpLockBurn")}</div>
        {token.graduated ? (
          <>
            <Row
              label={tr("lpLockPct")}
              status={fmtPct(lockPct)}
              color={lockColor(lockPct)}
              sub={lockPct === 100 ? tr("hookNoRemove") : undefined}
            />
            {lockPct != null && <RatioBar pct={lockPct} color={lockColor(lockPct)} />}
            <Row
              label={tr("lpBurnLock")}
              status={fmtPct(burnPct)}
              color={lockColor(burnPct)}
              sub={burnPct === 100 ? tr("permLock") : undefined}
            />
            {burnPct != null && <RatioBar pct={burnPct} color={lockColor(burnPct)} />}
            <Row
              label={tr("tokenBurnPct")}
              status={fmtPct(tokenBurn)}
              color={tokenBurn != null && tokenBurn > 0 ? OK : DIM}
            />
            {tokenBurn != null && tokenBurn > 0 && <RatioBar pct={tokenBurn} color={OK} />}
          </>
        ) : (
          <Row label={tr("lpLockPct")} status={tr("curveThenLock")} color={WARN} />
        )}

        <Row
          label={tr("antiBundleLabel")}
          status={token.antiBundle ? tr("enabled") : tr("disabled")}
          color={token.antiBundle ? OK : DIM}
        />
        <Row
          label={tr("antiSnipeLabel")}
          status={token.antiSnipe ? tr("enabled") : tr("disabled")}
          color={token.antiSnipe ? OK : DIM}
        />
        <Row label={tr("buyTax")} status={`${(buyTax / 100).toFixed(2)}%`} color={taxColor(buyTax)} />
        <Row label={tr("sellTax")} status={`${(sellTax / 100).toFixed(2)}%`} color={taxColor(sellTax)} />

        <div style={{ padding: "8px 0 2px", fontSize: 11, color: DIM, fontWeight: 700 }}>{tr("riskHeuristic")}</div>
        <Row
          label={tr("honeypot")}
          status={
            sec == null
              ? tr("detecting")
              : sec.honeypotSuspected
                ? tr("suspectedHoneypot")
                : sec.sellRisk === "warn"
                  ? tr("highSellTax")
                  : tr("canSell")
          }
          color={sec == null ? DIM : sec.honeypotSuspected ? BAD : sec.sellRisk === "warn" ? WARN : OK}
          sub={
            sec?.sellTaxOnchain != null
              ? tr("onchainSellTax", { n: (sec.sellTaxOnchain / 100).toFixed(2) })
              : undefined
          }
        />
        <Row
          label={tr("renounced")}
          status={
            sec == null
              ? tr("detecting")
              : sec.owner?.status === "renounced"
                ? tr("abandoned")
                : sec.owner?.status === "owned"
                  ? tr("notAbandoned")
                  : sec.owner?.status === "none"
                    ? tr("noOwnerFn")
                    : tr("unknown")
          }
          color={
            sec == null
              ? DIM
              : sec.owner?.status === "renounced" || sec.owner?.status === "none"
                ? OK
                : sec.owner?.status === "owned"
                  ? WARN
                  : DIM
          }
          sub={sec?.owner?.status === "owned" && sec.owner.address ? `owner: ${shortAddr(sec.owner.address)}` : undefined}
        />
        <Row
          label={tr("blacklistFn")}
          status={sec == null ? tr("detecting") : sec.blacklist?.detected ? tr("detected") : tr("noneFound")}
          color={sec == null ? DIM : sec.blacklist?.detected ? BAD : OK}
          sub={sec?.blacklist?.detected ? sec.blacklist.hits.slice(0, 2).join(", ") : undefined}
        />
        {score != null && (
          <Row
            label={tr("bundleRating")}
            status={`${score}/100`}
            color={score > 60 ? BAD : score > 30 ? WARN : OK}
          />
        )}

        <div style={{ padding: "8px 0 2px", fontSize: 11, color: DIM, fontWeight: 700 }}>{tr("addresses")}</div>
        {token.graduated && token.poolId ? (
          <Row label={tr("v4PoolLabel")} status={shortAddr(token.poolId)} color={OK} />
        ) : (
          <Row label={tr("statusLabel")} status={tr("onCurveUngrad")} color={WARN} />
        )}
        {token.curveAddress && <CopyRow label={tr("curveContract")} value={token.curveAddress} />}
        {token.address && <CopyRow label={tr("tokenContract")} value={token.address} />}
        {token.creator && <CopyRow label={tr("creator")} value={token.creator} />}
      </div>
    </div>
  );
}
