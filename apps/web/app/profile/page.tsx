"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useMemo, useState, type MouseEvent } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { AppNav } from "@/components/AppNav";
import { LastActiveTokens, PositionPnlLists } from "@/components/PositionPnlLists";
import { QuoteUnitToggle } from "@/components/QuoteUnitToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { fmtPnl, useQuoteUnit, type QuoteUnit } from "@/lib/quoteUnit";
import { EmojiAvatar } from "@/components/EmojiAvatar";
import { useT } from "@/lib/locale";

/* ────────────────────────── 类型 ────────────────────────── */

interface Profile {
  wallet: string;
  username: string | null;
  twitter: string | null;
}

interface PnlData {
  address: string;
  winrate: { wins: number; losses: number; closed: number; pct: number | null };
  pnl: { d7: string; d30: string; total: string };
  daily: { date: string; pnl: string }[];
  monthly: { month: string; pnl: string }[];
  tradeCount: number;
}

/* ────────────────────────── 样式常量 ────────────────────────── */

const GOLD = "#f0b90b";
const OK = "#0ecb81";
const BAD = "#f6465d";
const DIM = "#5e6673";
const BORDER = "#1e2329";
const PANEL = "#0d1117";

const inputStyle: React.CSSProperties = {
  padding: "7px 10px", fontSize: 13, background: "#0b0e11",
  border: `1px solid #2b3139`, borderRadius: 6, color: "#eaecef", outline: "none",
};

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/* ────────────────────────── 资料卡 ────────────────────────── */

function ProfileCard({ address, readOnly }: { address: string; readOnly?: boolean }) {
  const tr = useT();
  const [username, setUsername] = useState("");
  const [twitter, setTwitter] = useState("");
  const [savedAt, setSavedAt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["profile", address],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/profile?address=${address}`));
      return readJson<Profile>(r);
    },
  });

  useEffect(() => {
    if (profile) {
      setUsername(profile.username ?? "");
      setTwitter(profile.twitter ?? "");
    }
  }, [profile]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(apiUrl("/api/profile"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, username, twitter }),
      });
      const body = await readJson<{ ok?: boolean; error?: string }>(r);
      if (!r.ok || !body.ok) throw new Error(body.error ?? tr("saveFailed"));
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <EmojiAvatar seed={address} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#eaecef" }}>
            {profile?.username || tr("unnamed")}
          </div>
          <div style={{ fontSize: 11, color: DIM, fontFamily: "monospace" }}>{address}</div>
          {profile?.twitter && (
            <a
              href={`https://x.com/${profile.twitter}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: GOLD, textDecoration: "none" }}
            >
              @{profile.twitter} ↗
            </a>
          )}
        </div>
      </div>

      {readOnly ? (
        <div style={{ fontSize: 11, color: DIM }}>
          {tr("viewingOther")}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
            <label style={{ display: "grid", gap: 4, fontSize: 11, color: DIM }}>
              {tr("username")}
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={tr("namePh")}
                maxLength={24}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 11, color: DIM }}>
              {tr("twitterBind")}
              <input
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                placeholder="your_handle"
                maxLength={32}
                style={inputStyle}
              />
            </label>
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: "8px 18px", border: 0, borderRadius: 6, cursor: "pointer",
                background: GOLD, color: "#000", fontWeight: 700, fontSize: 13,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? tr("saving") : tr("save")}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, minHeight: 14 }}>
            {err && <span style={{ color: BAD }}>{err}</span>}
            {!err && savedAt > 0 && <span style={{ color: OK }}>{tr("saved")}</span>}
            {!err && savedAt === 0 && (
              <span style={{ color: DIM }}>{tr("twitterManual")}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ────────────────────────── 统计卡 ────────────────────────── */

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: DIM, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color ?? "#eaecef", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ────────────────────────── PNL 日历 + 资金起伏 ────────────────────────── */

type DayPt = { day: number; key: string; daily: number; equity: number };

function fmtPnlShort(v: number, unit: QuoteUnit, ethUsd?: number): string {
  if (unit === "usd" && ethUsd && ethUsd > 0) {
    const usd = v * ethUsd;
    const sign = usd > 0 ? "+" : usd < 0 ? "−" : "";
    const a = Math.abs(usd);
    if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`;
    if (a >= 10) return `${sign}$${a.toFixed(0)}`;
    if (a >= 1) return `${sign}$${a.toFixed(1)}`;
    return `${sign}$${a.toFixed(2)}`;
  }
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1) return `${sign}${a.toFixed(2)}`;
  if (a >= 0.01) return `${sign}${a.toFixed(3)}`;
  return `${sign}${a.toPrecision(2)}`;
}

function EquityChart({
  days, opening, unit, ethUsd, hoverDay, onHover, emptyHint, dayLabel, cumLabel,
}: {
  days: DayPt[];
  opening: number;
  unit: QuoteUnit;
  ethUsd?: number;
  hoverDay: number | null;
  onHover: (d: number | null) => void;
  emptyHint: string;
  dayLabel: string;
  cumLabel: string;
}) {
  const uid = useId().replace(/:/g, "");
  const W = 640;
  const H = 168;
  const padL = 6;
  const padR = 6;
  const padT = 14;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = days.length;
  const ys = days.map((d) => d.equity);
  let min = Math.min(opening, ...ys);
  let max = Math.max(opening, ...ys);
  if (!(max > min)) {
    const pad = Math.max(Math.abs(max) * 0.08, 1e-6);
    min -= pad;
    max += pad;
  }
  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * innerH;
  const up = (days[n - 1]?.equity ?? opening) >= opening;
  const stroke = up ? OK : BAD;
  const fillId = `${uid}${up ? "Up" : "Dn"}`;
  let step = "";
  let area = "";
  if (n) {
    step = `M ${xAt(0).toFixed(1)} ${yAt(days[0].equity).toFixed(1)}`;
    area = `M ${xAt(0).toFixed(1)} ${yAt(min).toFixed(1)} V ${yAt(days[0].equity).toFixed(1)}`;
    for (let i = 1; i < n; i++) {
      const x = xAt(i).toFixed(1);
      const y = yAt(days[i].equity).toFixed(1);
      step += ` H ${x} V ${y}`;
      area += ` H ${x} V ${y}`;
    }
    area += ` V ${yAt(min).toFixed(1)} Z`;
  }
  const hover = hoverDay != null ? days.find((d) => d.day === hoverDay) : null;
  const hoverI = hover ? days.findIndex((d) => d.day === hover.day) : -1;
  const hasMove = days.some((d) => d.daily !== 0);

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = rect.width <= 0 ? 0 : (e.clientX - rect.left) / rect.width;
    const i = Math.round(t * Math.max(n - 1, 0));
    const pt = days[Math.max(0, Math.min(n - 1, i))];
    if (pt) onHover(pt.day);
  }

  return (
    <div style={{ position: "relative", width: "100%", minHeight: 168 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height={168}
        onMouseMove={onMove}
        style={{ display: "block", cursor: "crosshair" }}
      >
        <defs>
          <linearGradient id={`${uid}Up`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={OK} stopOpacity="0.28" />
            <stop offset="100%" stopColor={OK} stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`${uid}Dn`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BAD} stopOpacity="0.26" />
            <stop offset="100%" stopColor={BAD} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={padL} y1={yAt(opening)} x2={W - padR} y2={yAt(opening)} stroke="#2b3139" strokeDasharray="4 4" strokeWidth="1" />
        {area && <path d={area} fill={`url(#${fillId})`} />}
        {step && <path d={step} fill="none" stroke={hasMove ? stroke : DIM} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {days.map((d, i) => d.daily !== 0 ? (
          <circle key={d.key} cx={xAt(i)} cy={yAt(d.equity)} r="2.4" fill={d.daily > 0 ? OK : BAD} />
        ) : null)}
        {hover && hoverI >= 0 && (
          <>
            <line x1={xAt(hoverI)} y1={padT} x2={xAt(hoverI)} y2={H - padB} stroke="#f0b90b" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={xAt(hoverI)} cy={yAt(hover.equity)} r="4.5" fill="#0d1117" stroke="#f0b90b" strokeWidth="2" />
          </>
        )}
        {n >= 2 && [0, n - 1].map((i) => (
          <text key={i} x={xAt(i)} y={H - 6} textAnchor={i === 0 ? "start" : "end"} fill={DIM} fontSize="11">
            {days[i].day}
          </text>
        ))}
      </svg>
      {!hasMove && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: DIM, fontSize: 12, pointerEvents: "none" }}>
          {emptyHint}
        </div>
      )}
      {hover && (
        <div
          style={{
            position: "absolute", top: 8, left: hoverI < n / 2 ? undefined : 10, right: hoverI < n / 2 ? 10 : undefined,
            background: "rgba(13,17,23,0.92)", border: `1px solid ${BORDER}`, borderRadius: 8,
            padding: "6px 10px", fontSize: 11, pointerEvents: "none", minWidth: 128,
            boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ color: "#eaecef", fontWeight: 700 }}>{hover.key}</div>
          <div style={{ marginTop: 2, color: hover.daily >= 0 ? OK : BAD, fontVariantNumeric: "tabular-nums" }}>
            {dayLabel} {fmtPnl(hover.daily, unit, ethUsd)}
          </div>
          <div style={{ marginTop: 2, color: DIM, fontVariantNumeric: "tabular-nums" }}>
            {cumLabel} {fmtPnl(hover.equity, unit, ethUsd)}
          </div>
        </div>
      )}
    </div>
  );
}

function PnlCalendar({ pnl }: { pnl: PnlData }) {
  const tr = useT();
  const [unit] = useQuoteUnit();
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });
  const ethUsd = eth?.price;
  const pnlByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of pnl.daily) m.set(d.date, Number(d.pnl));
    return m;
  }, [pnl.daily]);
  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of pnl.monthly) m.set(r.month, Number(r.pnl));
    return m;
  }, [pnl.monthly]);

  const nowUtc8 = new Date(Date.now() + 8 * 3600_000);
  const todayKey = nowUtc8.toISOString().slice(0, 10);
  const [year, setYear] = useState(nowUtc8.getUTCFullYear());
  const [month, setMonth] = useState(nowUtc8.getUTCMonth());
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const firstDay = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startWeekday = (firstDay.getUTCDay() + 6) % 7;
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthTotal = monthly.get(monthKey) ?? 0;
  const isCurrent = monthKey === todayKey.slice(0, 7);
  const lastPlotDay = isCurrent ? Number(todayKey.slice(8, 10)) : daysInMonth;

  const opening = useMemo(() => {
    const start = `${monthKey}-01`;
    let s = 0;
    for (const [k, v] of pnlByDay) if (k < start) s += v;
    return s;
  }, [pnlByDay, monthKey]);

  const series = useMemo(() => {
    const out: DayPt[] = [];
    let eq = opening;
    for (let d = 1; d <= lastPlotDay; d++) {
      const key = `${monthKey}-${String(d).padStart(2, "0")}`;
      const daily = pnlByDay.get(key) ?? 0;
      eq += daily;
      out.push({ day: d, key, daily, equity: eq });
    }
    return out;
  }, [opening, lastPlotDay, monthKey, pnlByDay]);

  const closeEq = series[series.length - 1]?.equity ?? opening;

  function shift(delta: number) {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
    setHoverDay(null);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <section
      onMouseLeave={() => setHoverDay(null)}
      style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px", minWidth: 0 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{tr("calendar")}</div>
          <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{tr("equityCurve")}</div>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <QuoteUnitToggle size={14} />
          <button type="button" onClick={() => shift(-1)} style={navBtn}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 700, minWidth: 88, textAlign: "center", color: "#eaecef" }}>
            {year}.{String(month + 1).padStart(2, "0")}
          </span>
          <button type="button" onClick={() => shift(1)} style={navBtn}>›</button>
        </span>
      </div>

      <div
        style={{
          display: "grid", gap: 10, marginBottom: 10,
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        }}
      >
        <MiniStat label={tr("monthStart")} value={fmtPnl(opening, unit, ethUsd)} />
        <MiniStat label={tr("monthEnd")} value={fmtPnl(closeEq, unit, ethUsd)} color={closeEq >= opening ? OK : BAD} />
        <MiniStat label={tr("monthN", { n: month + 1 })} value={fmtPnl(monthTotal, unit, ethUsd)} color={monthTotal >= 0 ? OK : BAD} />
      </div>

      <div className="pnl-board">
        <div style={{ minWidth: 0, background: "#0b0e11", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 8px 4px" }}>
          <EquityChart
            days={series}
            opening={opening}
            unit={unit}
            ethUsd={ethUsd}
            hoverDay={hoverDay}
            onHover={setHoverDay}
            emptyHint={tr("noMonthPnl")}
            dayLabel={tr("dayPnl")}
            cumLabel={tr("cumPnl")}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontSize: 10, color: DIM, textAlign: "center", marginBottom: 6, fontWeight: 700 }}>
            {([1, 2, 3, 4, 5, 6, 7] as const).map((d) => <span key={d}>{tr(`week${d}`)}</span>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={`x${i}`} />;
              const key = `${monthKey}-${String(d).padStart(2, "0")}`;
              const v = pnlByDay.get(key);
              const has = v != null && v !== 0;
              const future = key > todayKey;
              const today = key === todayKey;
              const active = hoverDay === d;
              const color = has ? (v > 0 ? OK : BAD) : DIM;
              return (
                <div
                  key={key}
                  onMouseEnter={() => !future && setHoverDay(d)}
                  title={has ? `${key}: ${fmtPnl(v, unit, ethUsd)}` : key}
                  style={{
                    border: `1px solid ${active ? GOLD : today ? GOLD : has ? (v > 0 ? "rgba(14,203,129,0.4)" : "rgba(246,70,93,0.4)") : BORDER}`,
                    background: active
                      ? "rgba(240,185,11,0.12)"
                      : has ? (v > 0 ? "rgba(14,203,129,0.10)" : "rgba(246,70,93,0.10)") : today ? "rgba(240,185,11,0.06)" : "transparent",
                    borderRadius: 6, padding: "6px 2px", minHeight: 48,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                    opacity: future ? 0.38 : 1, cursor: future ? "default" : "pointer",
                  }}
                >
                  <span style={{ fontSize: 11, color: today ? GOLD : DIM, fontWeight: today ? 800 : 600, lineHeight: 1 }}>{d}</span>
                  {has && (
                    <span style={{ fontSize: 10, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                      {fmtPnlShort(v, unit, ethUsd)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "#0b0e11", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: DIM, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color ?? "#eaecef", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 26, height: 26, border: `1px solid #2b3139`, borderRadius: 6,
  background: "transparent", color: "#848e9c", cursor: "pointer", fontSize: 16, lineHeight: 1,
};

/* ────────────────────────── 页面 ────────────────────────── */

function ProfilePageInner() {
  const tr = useT();
  const [unit] = useQuoteUnit();
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });
  const ethUsd = eth?.price;
  const { authenticated, login, logout, user } = usePrivy();
  const params = useSearchParams();
  const viewParam = params.get("address")?.toLowerCase() ?? null;
  const viewAddress = viewParam && /^0x[0-9a-f]{40}$/.test(viewParam) ? viewParam : null;
  const ownAddress = user?.wallet?.address?.toLowerCase();
  // ?address= 优先:看别人的主页;是自己的钱包则仍可编辑
  const address = viewAddress ?? ownAddress;
  const readOnly = viewAddress != null && viewAddress !== ownAddress;

  const { data: pnl, isFetching } = useQuery({
    queryKey: ["profile-pnl", address],
    enabled: !!address,
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/profile/pnl?address=${address}`));
      const body = await readJson<PnlData | { error?: string }>(r);
      if (!r.ok || !("pnl" in body)) throw new Error("load failed");
      return body;
    },
  });

  const pnlColor = (v: string) => (Number(v) > 0 ? OK : Number(v) < 0 ? BAD : "#eaecef");

  return (
    <main style={{ minHeight: "calc(100vh - 44px)", padding: "10px 14px", maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1 style={{ fontSize: 18, margin: 0, fontWeight: 800, whiteSpace: "nowrap" }}>
            SnowOn <span style={{ color: GOLD }}>Terminal</span>
          </h1>
        </Link>
        <AppNav current="profile" />
        <div style={{ flex: 1 }} />
        <LanguageSwitcher />
        <button
          onClick={authenticated ? logout : login}
          style={{
            padding: "7px 14px", border: 0, borderRadius: 6, cursor: "pointer",
            background: GOLD, color: "#000", fontWeight: 700, fontSize: 12,
          }}
        >
          {authenticated ? `${shortAddr(ownAddress ?? "")}` : tr("connectWallet")}
        </button>
      </header>

      {!address ? (
        <div
          style={{
            background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10,
            padding: "60px 20px", textAlign: "center", color: DIM, fontSize: 13,
          }}
        >
          {tr("connectToSee")}
          <div style={{ marginTop: 14 }}>
            <button
              onClick={login}
              style={{ padding: "9px 26px", border: 0, borderRadius: 6, background: GOLD, fontWeight: 700, cursor: "pointer" }}
            >
              {tr("connectWallet")}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <ProfileCard address={address} readOnly={readOnly} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <QuoteUnitToggle size={16} />
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <StatCard
              label={tr("winrateClosed")}
              value={pnl?.winrate.pct != null ? `${pnl.winrate.pct}%` : "-"}
              sub={pnl ? tr("winLoss", { wins: pnl.winrate.wins, losses: pnl.winrate.losses }) : undefined}
              color={pnl?.winrate.pct != null ? (pnl.winrate.pct >= 50 ? OK : BAD) : undefined}
            />
            <StatCard
              label={tr("pnl7d")}
              value={pnl ? fmtPnl(Number(pnl.pnl.d7), unit, ethUsd) : isFetching ? "…" : "-"}
              color={pnl ? pnlColor(pnl.pnl.d7) : undefined}
            />
            <StatCard
              label={tr("pnl30d")}
              value={pnl ? fmtPnl(Number(pnl.pnl.d30), unit, ethUsd) : isFetching ? "…" : "-"}
              color={pnl ? pnlColor(pnl.pnl.d30) : undefined}
            />
            <StatCard
              label={tr("pnlTotalRealized")}
              value={pnl ? fmtPnl(Number(pnl.pnl.total), unit, ethUsd) : isFetching ? "…" : "-"}
              sub={pnl ? tr("tradesN", { n: pnl.tradeCount }) : undefined}
              color={pnl ? pnlColor(pnl.pnl.total) : undefined}
            />
          </div>

          {pnl ? <PnlCalendar pnl={pnl} /> : null}

          <div
            className="asset-two"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.5fr) minmax(220px, 300px)",
              gap: 8,
              alignItems: "stretch",
            }}
          >
            <PositionPnlLists address={address} />
            <LastActiveTokens address={address} />
          </div>

          <div style={{ fontSize: 11, color: DIM }}>
            {tr("pnlNote")}
          </div>
        </div>
      )}
    </main>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfilePageInner />
    </Suspense>
  );
}
