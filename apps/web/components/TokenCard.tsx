"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { memo, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TokenLogo } from "./TokenLogo";
import { FAVORITES_EVENT, isFavorite, toggleFavorite } from "@/lib/favorites";
import { readJson } from "@/lib/http";
import { formatTimeAgo, t as tr, useLocale } from "@/lib/locale";
import { useTranslatedTexts } from "@/lib/useTranslated";
import { TwitterPreview } from "./TwitterPreview";

export interface HomeToken {
  address: string;
  platformId?: string | null;
  name: string;
  symbol: string;
  logoUri: string | null;
  graduated: boolean;
  graduatedAt: string | null;
  antiBundle: boolean;
  createdAt: string;
  priceEth: string | null;
  graduationProgress: string | null;
  mcapEth: string | null;
  change24hPct: string | null;
  /** 24h 成交量(ETH 计)与按量排名;排名 ≤3 且量 >0 视为热门 */
  volume24hEth?: string | null;
  volRank?: number | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  github?: string | null;
  description?: string | null;
  skill?: string | null;
  top10Share?: string | null;
  bundleShare?: string | null;
  launchBuyShare?: string | null;
  phishShare?: string | null;
  bundleScore?: number | null;
  spark?: number[];
  creator?: string | null;
  creatorBal?: string | null;
  devDumped?: boolean;
}

function numShare(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isHttp(v?: string | null): v is string {
  return !!v && /^https?:\/\//i.test(v);
}

/** Top10 / 捆绑:越高越危险。钓鱼:0 绿,≥2% 黄,≥10% 红 */
function warnColor(share: number | null, kind: "hold" | "phish" = "hold"): string {
  if (share == null) return "#5e6673";
  if (kind === "phish") {
    if (share <= 0) return "#0ecb81";
    if (share >= 0.1) return "#f6465d";
    return "#f0b90b";
  }
  if (share >= 0.5) return "#f6465d";
  if (share >= 0.3) return "#f0b90b";
  return "#0ecb81";
}

function fmtPct(share: number | null): string {
  if (share == null) return "-";
  return `${(share * 100).toFixed(1)}%`;
}

function fmtUsd(mcapEth: string | null, ethUsd?: number): string {
  if (!mcapEth || !ethUsd) return "-";
  const v = Number(mcapEth) * ethUsd;
  if (!Number.isFinite(v) || v <= 0) return "-";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(3)}`;
}

function fmtChange(pct: string | null): { text: string; color: string } {
  if (pct == null) return { text: "-", color: "#848e9c" };
  const v = Number(pct) * 100;
  if (!Number.isFinite(v)) return { text: "-", color: "#848e9c" };
  const sign = v > 0 ? "+" : "";
  return { text: `${sign}${v.toFixed(1)}%`, color: v > 0 ? "#0ecb81" : v < 0 ? "#f6465d" : "#848e9c" };
}

async function fetchEthPrice() {
  const res = await fetch(apiUrl("/api/eth-price"));
  return readJson<{ price: number }>(res);
}

async function fetchTokenDetail(address: string) {
  const res = await fetch(apiUrl(`/api/token/${address}`));
  return readJson<{
    description?: string | null;
    skill?: string | null;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    github?: string | null;
  }>(res);
}

function Sparkline({ prices, up, id }: { prices: number[]; up: boolean; id: string }) {
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const w = 320;
  const h = 88;
  const pts = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((p - min) / span) * (h * 0.72) - h * 0.14;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = up ? "#0ecb81" : "#f6465d";
  const fid = `sb-${id}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="token-card-spark" aria-hidden>
      <defs>
        <linearGradient id={`${fid}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.42" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${fid}-g)`} opacity="0.55" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function SocialIcon({ href, kind, title }: { href: string; kind: "x" | "tg" | "web" | "gh"; title: string }) {
  const [tip, setTip] = useState(false);
  const path =
    kind === "x"
      ? "M14.2 2H17l-5.2 6 6.2 8H13.6L9.8 11.4 5.2 16H2.4l5.6-6.4L2 2h4.5l3.4 4.8L14.2 2zm-1.1 12.6h1.5L7 3.3H5.4l7.7 11.3z"
      : kind === "tg"
        ? "M18 3L2.5 9.1c-1 .4-1 1.1-.2 1.4l4 1.2 9.3-5.9c.4-.3.8-.1.5.2l-7.5 6.8-.3 4.2c.4 0 .6-.2.9-.5l2.1-2 4.4 3.2c.8.4 1.4.2 1.6-.8L19.2 4c.3-1.1-.4-1.6-1.2-1z"
        : kind === "web"
          ? "M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zm0 1.6c1.3 0 2.5 2.6 2.7 6H7.3c.2-3.4 1.4-6 2.7-6zm-3.5.9C5.2 5.2 4 7.2 3.5 9.1h3.1C6.5 6.8 6.1 4.9 6.5 4zm7 0c.4.9 0 2.8-.1 5.1h3.1C16 7.2 14.8 5.2 13.5 4zM3.3 10.9c.4 2.2 1.7 4.4 3.2 5.3.3-.9.6-2.5.7-4.2H3.4l-.1-1.1zm4.2 0c-.1 2-.5 3.8-1 5.1 1 .5 2.2.8 3.5.8.4-1.6.7-3.6.8-5.9H7.5zm5.1 0c.1 2.3.4 4.3.8 5.9 1.3 0 2.5-.3 3.5-.8-.5-1.3-.9-3.1-1-5.1h-3.3zm4.3 0c.1 1.7.4 3.3.7 4.2 1.5-.9 2.8-3.1 3.2-5.3h-3.1l-.8 1.1z"
          : "M10 1.6c-4.6 0-8.4 3.8-8.4 8.4 0 3.7 2.4 6.9 5.7 8 .4.1.6-.2.6-.4v-1.5c-2.3.5-2.8-1.1-2.8-1.1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.8-.9-3.8-4.1 0-.9.3-1.6.8-2.2-.1-.2-.4-1.1.1-2.2 0 0 .7-.2 2.3.8a7.8 7.8 0 014.2 0c1.6-1 2.3-.8 2.3-.8.5 1.1.2 2 .1 2.2.5.6.8 1.3.8 2.2 0 3.2-1.9 3.9-3.8 4.1.3.3.6.8.6 1.6v2.3c0 .2.2.5.6.4 3.3-1.1 5.7-4.3 5.7-8 0-4.6-3.8-8.4-8.4-8.4z";
  const host = (() => {
    try {
      return new URL(href).host.replace(/^www\./, "");
    } catch {
      return href;
    }
  })();
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="social-icon"
      title={href}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
      style={{
        width: 18, height: 18, alignItems: "center", justifyContent: "center",
        borderRadius: 4, background: "#1e2329", color: "#848e9c",
      }}
    >
      <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path d={path} />
      </svg>
      {tip && <span className="social-preview">{host}</span>}
    </a>
  );
}

function Stat({ label, share, kind, hint }: { label: string; share: number | null; kind?: "hold" | "phish"; hint: string }) {
  const color = warnColor(share, kind);
  return (
    <span style={{ fontSize: 11 }} title={hint}>
      <span style={{ color: "#5e6673" }}>{label} </span>
      <span style={{ color, fontWeight: 800 }}>{fmtPct(share)}</span>
    </span>
  );
}

function sameSpark(a?: number[], b?: number[]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

function multValue(pct: string | null): number | null {
  if (pct == null) return null;
  const v = Number(pct);
  if (!Number.isFinite(v) || v < 0.2) return null;
  const x = 1 + v;
  if (x < 1.2) return null;
  return x;
}

function fmtMult(x: number): string {
  return `x${x >= 10 ? x.toFixed(0) : x.toFixed(1)}`.replace(/\.0$/, "");
}

/** 主页代币小卡片:火花线背景 + Top10/捆绑/钓鱼警告色 + 美元市值 + 社交 logo;介绍固定 2 行省略号,hover 不改变布局 */
function TokenCardInner({ t, showMultiplier }: { t: HomeToken; showMultiplier?: boolean }) {
  const [locale] = useLocale();
  const change = fmtChange(t.change24hPct);
  const xMult = showMultiplier ? multValue(t.change24hPct) : null;
  const progress = t.graduated ? null : Math.min(1, Math.max(0, Number(t.graduationProgress ?? 0)));
  const [fav, setFav] = useState(false);
  const [extra, setExtra] = useState<Partial<HomeToken>>({});
  const qc = useQueryClient();
  const { data: eth } = useQuery({ queryKey: ["eth-price"], queryFn: fetchEthPrice, staleTime: 15_000 });

  const top10 = numShare(t.top10Share);
  const bundle = numShare(t.bundleShare);
  const phish = numShare(t.phishShare);
  const vol24 = numShare(t.volume24hEth) ?? 0;
  const hot = t.volRank != null && t.volRank <= 3 && vol24 > 0;
  const spark = t.spark ?? [];
  const sparkUp = spark.length >= 2 ? spark[spark.length - 1] >= spark[0] : change.color === "#0ecb81";

  const description = extra.description ?? t.description;
  const [nameT, descT] = useTranslatedTexts([t.name, description ?? ""]);
  const skill = extra.skill ?? t.skill;
  const socials = [
    isHttp(extra.twitter ?? t.twitter) && { href: extra.twitter ?? t.twitter!, kind: "x" as const, title: extra.twitter ?? t.twitter! },
    isHttp(extra.telegram ?? t.telegram) && { href: extra.telegram ?? t.telegram!, kind: "tg" as const, title: extra.telegram ?? t.telegram! },
    isHttp(extra.website ?? t.website) && { href: extra.website ?? t.website!, kind: "web" as const, title: extra.website ?? t.website! },
    isHttp(extra.github ?? t.github) && { href: extra.github ?? t.github!, kind: "gh" as const, title: extra.github ?? t.github! },
  ].filter(Boolean) as Array<{ href: string; kind: "x" | "tg" | "web" | "gh"; title: string }>;

  useEffect(() => {
    const sync = () => setFav(isFavorite(t.address));
    sync();
    window.addEventListener(FAVORITES_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_EVENT, sync);
  }, [t.address]);

  return (
    <Link href={`/token/${t.address}`} prefetch={false} style={{ textDecoration: "none", color: "inherit" }}>
      <div
        className="token-card"
        onMouseEnter={() => {
          // hover 时补拉链下元数据(介绍/社交);介绍区域高度已固定,填充不会顶动卡片
          const hasMeta = t.description != null || t.website != null || t.twitter != null || t.telegram != null;
          if (hasMeta) return;
          void qc
            .fetchQuery({
              queryKey: ["token", t.address],
              queryFn: () => fetchTokenDetail(t.address),
              staleTime: 30_000,
            })
            .then((d) => {
              if (d) setExtra(d);
            });
        }}
        style={{
          position: "relative",
          border: "1px solid #1e2329",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 8,
          background: "#0f1319",
          cursor: "pointer",
          overflow: "visible",
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 8, pointerEvents: "none", zIndex: 0 }}>
          <Sparkline prices={spark} up={sparkUp} id={t.address.slice(2, 10)} />
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <TokenLogo src={t.logoUri} alt={t.symbol} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.symbol}
                </span>
                {hot && (
                  <span
                    title={tr(locale, "hotRank", { n: t.volRank ?? 0 })}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0,
                      padding: "1px 6px", fontSize: 10, fontWeight: 800, lineHeight: "14px",
                      borderRadius: 4, color: "#ff8a00",
                      background: "rgba(255,138,0,0.12)", border: "1px solid rgba(255,138,0,0.35)",
                    }}
                  >
                    🔥{t.volRank === 1 ? "TOP1" : t.volRank === 2 ? "TOP2" : "TOP3"}
                  </span>
                )}
                {t.platformId === "pons" && (
                  <span
                    title="Pons V2"
                    style={{
                      flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: 0.3,
                      padding: "1px 5px", borderRadius: 3, color: "#00c3ff",
                      background: "rgba(0,195,255,0.12)", border: "1px solid rgba(0,195,255,0.35)",
                    }}
                  >
                    PONS
                  </span>
                )}
                {t.antiBundle && <span title="antiBundle" style={{ fontSize: 10 }}>🛡</span>}
              </div>
              <div style={{ fontSize: 11, color: "#848e9c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {nameT || t.name} · {formatTimeAgo(t.createdAt, locale)}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, minWidth: 56 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: change.color, fontVariantNumeric: "tabular-nums" }}>{change.text}</div>
              <div style={{ fontSize: 11, color: "#848e9c" }}>24h</div>
              {xMult != null && (
                <div
                  title={tr(locale, "xMultiple")}
                  className={xMult >= 10 ? "mult-gold" : undefined}
                  style={{
                    marginTop: 2, fontSize: 18, fontWeight: 800, fontStyle: "italic",
                    color: xMult >= 10 ? undefined : "#0ecb81",
                    letterSpacing: 0.2, lineHeight: 1.1, fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtMult(xMult)}
                </div>
              )}
            </div>
            <span
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleFavorite(t.address);
              }}
              title={fav ? tr(locale, "unfav") : tr(locale, "fav")}
              style={{
                flexShrink: 0, cursor: "pointer", fontSize: 14, lineHeight: 1, width: 16, textAlign: "center",
                color: fav ? "#f0b90b" : "#3d4450", userSelect: "none", alignSelf: "flex-start",
              }}
            >
              {fav ? "★" : "☆"}
            </span>
          </div>

          {socials.length > 0 && (
            <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
              {socials.map((s) =>
                s.kind === "x" ? (
                  <TwitterPreview key="x" href={s.href} compact />
                ) : (
                  <SocialIcon key={s.kind} href={s.href} kind={s.kind} title={s.title} />
                ),
              )}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", marginTop: 8 }}>
            <Stat label={tr(locale, "top10")} share={top10} hint={tr(locale, "top10conc")} />
            <Stat label={tr(locale, "bundle")} share={bundle} hint={tr(locale, "bundle")} />
            <Stat label={tr(locale, "phish")} share={phish} kind="phish" hint={tr(locale, "phish")} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, fontSize: 12 }}>
            <span style={{ color: "#848e9c", whiteSpace: "nowrap" }}>
              {tr(locale, "mcap")} <span style={{ color: "#eaecef", fontWeight: 700 }}>{fmtUsd(t.mcapEth, eth?.price)}</span>
            </span>
            <span style={{ color: "#848e9c", whiteSpace: "nowrap" }} title={tr(locale, "vol24h")}>
              {tr(locale, "vol")} <span style={{ color: hot ? "#ff8a00" : "#eaecef", fontWeight: 700 }}>
                {vol24 > 0 ? fmtUsd(String(vol24), eth?.price) : "-"}
              </span>
            </span>
            {t.graduated ? (
              <span style={{ color: "#0ecb81", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>✅ {tr(locale, "graduatedTag")}</span>
            ) : (
              <span style={{ color: "#f0b90b", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
                {((progress ?? 0) * 100).toFixed(1)}%
              </span>
            )}
          </div>

          {progress != null && (
            <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: "#1e2329", overflow: "hidden" }}>
              <div
                style={{
                  width: `${(progress * 100).toFixed(1)}%`,
                  height: "100%",
                  background: progress > 0.8 ? "#0ecb81" : "#f0b90b",
                  borderRadius: 2,
                }}
              />
            </div>
          )}

          {/* 介绍区:固定 2 行高度,超长省略号;hover 看全文用原生 tooltip。始终渲染保证卡片高度一致、不跳动;无内容时边框透明但占位相同 */}
          <div
            title={(description ?? "") || undefined}
            style={{
              marginTop: 8, paddingTop: 8,
              borderTop: `1px solid ${description || skill ? "#1e2329" : "transparent"}`,
              fontSize: 11, color: "#b7bcc5", lineHeight: 1.5, height: 33,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}
          >
            {skill && (
              <span style={{ color: "#5e8bff", fontWeight: 700, marginRight: 6 }}>{skill}</span>
            )}
            {descT || description || ""}
          </div>
        </div>
      </div>
    </Link>
  );
}

export const TokenCard = memo(TokenCardInner, (prev, next) => {
  const a = prev.t;
  const b = next.t;
  return (
    prev.showMultiplier === next.showMultiplier &&
    a.address === b.address &&
    a.priceEth === b.priceEth &&
    a.change24hPct === b.change24hPct &&
    a.mcapEth === b.mcapEth &&
    a.volume24hEth === b.volume24hEth &&
    a.volRank === b.volRank &&
    a.graduationProgress === b.graduationProgress &&
    a.graduated === b.graduated &&
    a.top10Share === b.top10Share &&
    a.bundleShare === b.bundleShare &&
    a.phishShare === b.phishShare &&
    a.logoUri === b.logoUri &&
    a.description === b.description &&
    sameSpark(a.spark, b.spark)
  );
});
TokenCard.displayName = "TokenCard";
