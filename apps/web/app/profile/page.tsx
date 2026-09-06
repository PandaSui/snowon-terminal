"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { AppNav } from "@/components/AppNav";
import { LastActiveTokens, PositionPnlLists } from "@/components/PositionPnlLists";
import { QuoteUnitToggle } from "@/components/QuoteUnitToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { fmtPnl, useQuoteUnit } from "@/lib/quoteUnit";

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
      if (!r.ok || !body.ok) throw new Error(body.error ?? "保存失败");
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 22, flexShrink: 0,
            background: "linear-gradient(135deg, #f0b90b 0%, #7a5c00 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 800, color: "#000",
          }}
        >
          {(username || address.slice(2, 4)).slice(0, 2).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#eaecef" }}>
            {profile?.username || "未命名用户"}
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
          正在查看 TA 的主页(只读)
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
            <label style={{ display: "grid", gap: 4, fontSize: 11, color: DIM }}>
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="给自己起个名字"
                maxLength={24}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 11, color: DIM }}>
              绑定推特(handle,不含 @)
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
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, minHeight: 14 }}>
            {err && <span style={{ color: BAD }}>{err}</span>}
            {!err && savedAt > 0 && <span style={{ color: OK }}>✓ 已保存</span>}
            {!err && savedAt === 0 && (
              <span style={{ color: DIM }}>推特为手动绑定(handle 直填),暂不做 OAuth 验证</span>
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

/* ────────────────────────── PNL 日历 ────────────────────────── */

function PnlCalendar({ pnl }: { pnl: PnlData }) {
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

  // 默认停在本月(UTC+8)
  const nowUtc8 = new Date(Date.now() + 8 * 3600_000);
  const [year, setYear] = useState(nowUtc8.getUTCFullYear());
  const [month, setMonth] = useState(nowUtc8.getUTCMonth()); // 0-based

  const firstDay = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startWeekday = (firstDay.getUTCDay() + 6) % 7; // 周一开头
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthTotal = monthly.get(monthKey) ?? 0;

  function shift(delta: number) {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <section style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>📅 盈亏日历</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          <QuoteUnitToggle size={13} />
          <button onClick={() => shift(-1)} style={navBtn}>‹</button>
          <span style={{ fontSize: 10, color: DIM, minWidth: 64, textAlign: "center" }}>
            {year}.{month + 1}
          </span>
          <button onClick={() => shift(1)} style={navBtn}>›</button>
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, fontSize: 9, color: DIM, textAlign: "center", marginBottom: 3 }}>
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => <span key={d}>{d}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={`x${i}`} />;
          const key = `${monthKey}-${String(d).padStart(2, "0")}`;
          const v = pnlByDay.get(key);
          const has = v != null && v !== 0;
          const color = has ? (v > 0 ? OK : BAD) : DIM;
          return (
            <div
              key={key}
              title={has ? `${key}: ${fmtPnl(v, unit, ethUsd)}` : key}
              style={{
                border: `1px solid ${has ? (v > 0 ? "rgba(14,203,129,0.35)" : "rgba(246,70,93,0.35)") : BORDER}`,
                background: has ? (v > 0 ? "rgba(14,203,129,0.08)" : "rgba(246,70,93,0.08)") : "transparent",
                borderRadius: 3, padding: "2px 1px", minHeight: 26,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0,
              }}
            >
              <span style={{ fontSize: 8, color: DIM, lineHeight: 1.1 }}>{d}</span>
              {has && (
                <span style={{ fontSize: 8, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>
                  {fmtPnl(v, unit, ethUsd).replace(" ETH", "")}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: "auto", paddingTop: 6, borderTop: `1px solid ${BORDER}`,
          display: "flex", justifyContent: "space-between", fontSize: 10,
        }}
      >
        <span style={{ color: DIM }}>{month + 1}月</span>
        <b style={{ color: monthTotal >= 0 ? OK : BAD, fontVariantNumeric: "tabular-nums" }}>
          {fmtPnl(monthTotal, unit, ethUsd)}
        </b>
      </div>
    </section>
  );
}

const navBtn: React.CSSProperties = {
  width: 18, height: 18, border: `1px solid #2b3139`, borderRadius: 4,
  background: "transparent", color: "#848e9c", cursor: "pointer", fontSize: 12, lineHeight: 1,
};

/* ────────────────────────── 页面 ────────────────────────── */

function ProfilePageInner() {
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
          {authenticated ? `${shortAddr(ownAddress ?? "")}` : "连接钱包"}
        </button>
      </header>

      {!address ? (
        <div
          style={{
            background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10,
            padding: "60px 20px", textAlign: "center", color: DIM, fontSize: 13,
          }}
        >
          连接钱包后查看个人资产与战绩
          <div style={{ marginTop: 14 }}>
            <button
              onClick={login}
              style={{ padding: "9px 26px", border: 0, borderRadius: 6, background: GOLD, fontWeight: 700, cursor: "pointer" }}
            >
              连接钱包
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
              label="胜率(已平仓代币)"
              value={pnl?.winrate.pct != null ? `${pnl.winrate.pct}%` : "-"}
              sub={pnl ? `盈 ${pnl.winrate.wins} · 亏 ${pnl.winrate.losses}` : undefined}
              color={pnl?.winrate.pct != null ? (pnl.winrate.pct >= 50 ? OK : BAD) : undefined}
            />
            <StatCard
              label="7 天 PNL"
              value={pnl ? fmtPnl(Number(pnl.pnl.d7), unit, ethUsd) : isFetching ? "…" : "-"}
              color={pnl ? pnlColor(pnl.pnl.d7) : undefined}
            />
            <StatCard
              label="30 天 PNL"
              value={pnl ? fmtPnl(Number(pnl.pnl.d30), unit, ethUsd) : isFetching ? "…" : "-"}
              color={pnl ? pnlColor(pnl.pnl.d30) : undefined}
            />
            <StatCard
              label="总 PNL(已实现)"
              value={pnl ? fmtPnl(Number(pnl.pnl.total), unit, ethUsd) : isFetching ? "…" : "-"}
              sub={pnl ? `共 ${pnl.tradeCount} 笔成交` : undefined}
              color={pnl ? pnlColor(pnl.pnl.total) : undefined}
            />
          </div>

          <div
            className="asset-three"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(200px, 240px) minmax(0, 1.5fr) minmax(210px, 280px)",
              gap: 8,
              alignItems: "stretch",
            }}
          >
            {pnl ? <PnlCalendar pnl={pnl} /> : <div />}
            <PositionPnlLists address={address} />
            <LastActiveTokens address={address} />
          </div>

          <div style={{ fontSize: 11, color: DIM }}>
            口径:已实现盈亏(加权平均成本法,仅统计卖出结算),不含未平仓浮动盈亏;日历按 UTC+8 分日,每月最后一天结算。
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
