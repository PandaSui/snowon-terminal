"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";

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
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      title={`点击复制 ${label}`}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
        width: "100%", padding: "5px 0", background: "none", border: 0, borderBottom: "1px solid #161b22",
        cursor: "pointer", fontSize: 12, color: "#848e9c", textAlign: "left",
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: "monospace", color: copied ? OK : "#eaecef" }}>
        {copied ? "✓ 已复制" : shortAddr(value)}
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
  const buyTax = token.buyTaxBps ?? 0;
  const sellTax = token.sellTaxBps ?? 0;
  const score = token.bundleScore?.score;
  const { data: sec } = useQuery({
    queryKey: ["token-security", token.address],
    enabled: !!token.address,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/token/${token.address}/security`);
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
        🛡️ 合约安全
      </div>

      <div className="col-scroll" style={{ padding: "4px 12px 8px" }}>
        <Row
          label="合约开源"
          status={
            verified
              ? `已开源${contractName ? ` · ${contractName}` : ""} ↗`
              : verified === false
                ? token.github
                  ? "未验证 · 有 GitHub ↗"
                  : "未验证"
                : "查询中…"
          }
          color={verified ? OK : verified === false && !token.github ? DIM : WARN}
          href={verified ? explorerUrl : token.github || explorerUrl}
          sub={verified && sec?.compiler ? sec.compiler.replace(/^v/, "solc ") : undefined}
        />
        {(sec?.curveVerified || snowon) && token.curveAddress && (
          <Row
            label="曲线合约开源"
            status={`已开源${sec?.curveName ? ` · ${sec.curveName}` : " · SnowBondingCurve"} ↗`}
            color={OK}
            href={sec?.curveExplorerUrl ?? `https://robinhoodchain.blockscout.com/address/${token.curveAddress}#contract`}
          />
        )}
        {token.github && verified && (
          <Row label="GitHub" status="源码仓库 ↗" color={OK} href={token.github} />
        )}

        <div style={{ padding: "8px 0 2px", fontSize: 11, color: DIM, fontWeight: 700 }}>流动池锁定 / 燃烧</div>
        {token.graduated ? (
          <>
            <Row
              label="LP 锁定比例"
              status={fmtPct(lockPct)}
              color={lockColor(lockPct)}
              sub={lockPct === 100 ? "hook 禁止撤流动性" : undefined}
            />
            {lockPct != null && <RatioBar pct={lockPct} color={lockColor(lockPct)} />}
            <Row
              label="LP 燃烧锁定"
              status={fmtPct(burnPct)}
              color={lockColor(burnPct)}
              sub={burnPct === 100 ? "仓位永久锁死,等价燃烧" : undefined}
            />
            {burnPct != null && <RatioBar pct={burnPct} color={lockColor(burnPct)} />}
            <Row
              label="代币销毁占比"
              status={fmtPct(tokenBurn)}
              color={tokenBurn != null && tokenBurn > 0 ? OK : DIM}
            />
            {tokenBurn != null && tokenBurn > 0 && <RatioBar pct={tokenBurn} color={OK} />}
          </>
        ) : (
          <Row label="LP 锁定比例" status="曲线阶段 · 毕业后永久锁定" color={WARN} />
        )}

        <Row
          label="防捆绑 antiBundle"
          status={token.antiBundle ? "开启" : "关闭"}
          color={token.antiBundle ? OK : DIM}
        />
        <Row
          label="防狙击 antiSnipe"
          status={token.antiSnipe ? "开启" : "关闭"}
          color={token.antiSnipe ? OK : DIM}
        />
        <Row label="买税" status={`${(buyTax / 100).toFixed(2)}%`} color={taxColor(buyTax)} />
        <Row label="卖税" status={`${(sellTax / 100).toFixed(2)}%`} color={taxColor(sellTax)} />

        <div style={{ padding: "8px 0 2px", fontSize: 11, color: DIM, fontWeight: 700 }}>风险检测(启发式)</div>
        <Row
          label="貔貅检测"
          status={
            sec == null
              ? "检测中…"
              : sec.honeypotSuspected
                ? "疑似貔貅"
                : sec.sellRisk === "warn"
                  ? "高卖出税"
                  : "可正常卖出"
          }
          color={sec == null ? DIM : sec.honeypotSuspected ? BAD : sec.sellRisk === "warn" ? WARN : OK}
          sub={
            sec?.sellTaxOnchain != null
              ? `链上卖税 ${(sec.sellTaxOnchain / 100).toFixed(2)}%`
              : undefined
          }
        />
        <Row
          label="权限放弃"
          status={
            sec == null
              ? "检测中…"
              : sec.owner?.status === "renounced"
                ? "已放弃"
                : sec.owner?.status === "owned"
                  ? "未放弃"
                  : sec.owner?.status === "none"
                    ? "无所有权函数"
                    : "未知"
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
          label="黑名单功能"
          status={sec == null ? "检测中…" : sec.blacklist?.detected ? "检测到" : "无"}
          color={sec == null ? DIM : sec.blacklist?.detected ? BAD : OK}
          sub={sec?.blacklist?.detected ? sec.blacklist.hits.slice(0, 2).join(", ") : undefined}
        />
        {score != null && (
          <Row
            label="捆绑评分"
            status={`${score}/100`}
            color={score > 60 ? BAD : score > 30 ? WARN : OK}
          />
        )}

        <div style={{ padding: "8px 0 2px", fontSize: 11, color: DIM, fontWeight: 700 }}>地址</div>
        {token.graduated && token.poolId ? (
          <Row label="Uniswap V4 池" status={shortAddr(token.poolId)} color={OK} />
        ) : (
          <Row label="状态" status="联合曲线阶段(未毕业)" color={WARN} />
        )}
        {token.curveAddress && <CopyRow label="曲线合约" value={token.curveAddress} />}
        {token.address && <CopyRow label="代币合约" value={token.address} />}
        {token.creator && <CopyRow label="创建者" value={token.creator} />}
      </div>
    </div>
  );
}
