"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { readJson } from "@/lib/http";
import { AppNav } from "@/components/AppNav";
import { SearchBox } from "@/components/SearchBox";
import { AiPanel } from "@/components/AiPanel";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { FavoritesBar } from "@/components/FavoritesBar";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { QuoteUnitToggle } from "@/components/QuoteUnitToggle";
import { useAdmins } from "@/lib/useAdmins";
import { useIsMobile } from "@/lib/useIsMobile";
import { t, useLocale } from "@/lib/locale";
import { fmtPnl, fmtQuote, useQuoteUnit } from "@/lib/quoteUnit";
import { addressUrl } from "@/lib/explorers";
import type { HomeToken } from "@/components/TokenCard";
import {
  IMPORT_SAMPLE,
  TRACK_LIMIT,
  TRACKED_CHANGED_EVENT,
  addTrackedWallets,
  formatTrackedExport,
  loadTrackedWallets,
  parseTrackedImport,
  patchTrackedWallet,
  removeTrackedWallet,
  shortAddr,
  type TrackedWallet,
} from "@/lib/trackedWallets";
import type { SerializedWalletPnl, WindowStats } from "@/lib/walletPnl";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
const GOLD = "#f0b90b";
const OK = "#0ecb81";
const BAD = "#f6465d";
const DIM = "#5e6673";
const PAGE = 50;

type SortKey = "pnl7" | "pnl15" | "pnl30" | "pnlTotal" | "wr7" | "wr15" | "wr30" | "wrTotal" | "balance" | "trades";
type LeaderFilter = "profit" | "all";

interface LeadersResp {
  total: number;
  rows: SerializedWalletPnl[];
}

const btnStyle: React.CSSProperties = {
  background: GOLD, border: 0, borderRadius: 6, padding: "7px 14px",
  fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  padding: "7px 10px", fontSize: 12, background: "#0b0e11",
  border: "1px solid #2b3139", borderRadius: 6, color: "#eaecef", outline: "none",
};

const COLS = "36px minmax(148px,1.2fr) 100px 108px 72px 108px 72px 108px 72px 108px 88px";

const EMPTY_WR: WindowStats = { wins: 0, losses: 0, closed: 0, pct: null };

function emptyPnlRow(address: string): SerializedWalletPnl {
  return {
    address,
    pnl: { d7: "0", d15: "0", d30: "0", total: "0" },
    winrate: { d7: EMPTY_WR, d15: EMPTY_WR, d30: EMPTY_WR, total: EMPTY_WR },
    tradeCount: 0,
    lastAt: null,
  };
}

function pnlColor(n: number) {
  if (n > 0) return OK;
  if (n < 0) return BAD;
  return "#eaecef";
}

function wrText(w: WindowStats) {
  return w.pct == null ? "—" : `${w.pct}%`;
}

function sortNum(row: SerializedWalletPnl, key: SortKey, bal: Record<string, string | null>): number {
  switch (key) {
    case "pnl7": return Number(row.pnl.d7);
    case "pnl15": return Number(row.pnl.d15);
    case "pnl30": return Number(row.pnl.d30);
    case "wr7": return row.winrate.d7.pct ?? -1;
    case "wr15": return row.winrate.d15.pct ?? -1;
    case "wr30": return row.winrate.d30.pct ?? -1;
    case "wrTotal": return row.winrate.total.pct ?? -1;
    case "balance": {
      const v = bal[row.address];
      return v == null || v === "" ? -1 : Number(v);
    }
    case "trades": return row.tradeCount;
    default: return Number(row.pnl.total);
  }
}

function HeadBtn({
  label, k, sort, dir, onSort, align = "right",
}: {
  label: string; k: SortKey; sort: SortKey; dir: "asc" | "desc";
  onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const on = sort === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      style={{
        background: "none", border: 0, padding: 0, cursor: "pointer",
        color: on ? GOLD : DIM, fontWeight: on ? 800 : 600, fontSize: 11,
        textAlign: align, width: "100%",
      }}
    >
      {label}{on ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </button>
  );
}

function PnlCell({ v, unit, ethUsd }: { v: string; unit: "eth" | "usd"; ethUsd?: number }) {
  const n = Number(v);
  return (
    <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: pnlColor(n), fontSize: 12 }}>
      {fmtPnl(n, unit, ethUsd)}
    </span>
  );
}

function WrCell({ w }: { w: WindowStats }) {
  const c = w.pct == null ? DIM : w.pct >= 50 ? OK : BAD;
  return (
    <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: c, fontSize: 12 }} title={w.closed ? `盈 ${w.wins} · 亏 ${w.losses}` : undefined}>
      {wrText(w)}
    </span>
  );
}

function TableHead({ sort, dir, onSort, extra }: { sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; extra?: string }) {
  return (
    <div className="track-row" style={{ display: "grid", gridTemplateColumns: extra ? `${COLS} minmax(120px,0.8fr)` : COLS, gap: 8, padding: "8px 12px", fontSize: 11, color: DIM, borderBottom: "1px solid #161b22", alignItems: "center" }}>
      <span>#</span>
      <span>地址</span>
      <HeadBtn label="余额" k="balance" sort={sort} dir={dir} onSort={onSort} />
      <HeadBtn label="7日PNL" k="pnl7" sort={sort} dir={dir} onSort={onSort} />
      <HeadBtn label="7日胜率" k="wr7" sort={sort} dir={dir} onSort={onSort} />
      <HeadBtn label="15日PNL" k="pnl15" sort={sort} dir={dir} onSort={onSort} />
      <HeadBtn label="15日胜率" k="wr15" sort={sort} dir={dir} onSort={onSort} />
      <HeadBtn label="30日PNL" k="pnl30" sort={sort} dir={dir} onSort={onSort} />
      <HeadBtn label="30日胜率" k="wr30" sort={sort} dir={dir} onSort={onSort} />
      <HeadBtn label="总PNL" k="pnlTotal" sort={sort} dir={dir} onSort={onSort} />
      {extra
        ? <span style={{ textAlign: "right" }}>操作</span>
        : <HeadBtn label="成交" k="trades" sort={sort} dir={dir} onSort={onSort} />}
      {extra && <span>{extra}</span>}
    </div>
  );
}

function AddrCell({
  address, note, tracked, onTrack,
}: {
  address: string; note?: string; tracked?: boolean; onTrack?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <Link href={`/profile?address=${address}`} style={{ color: "#eaecef", textDecoration: "none", fontFamily: "monospace", fontWeight: 700, fontSize: 12 }} title={address}>
        {shortAddr(address)}
      </Link>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }).catch(() => {});
        }}
        style={{ background: "none", border: 0, color: copied ? OK : DIM, cursor: "pointer", fontSize: 10, padding: 0 }}
      >
        {copied ? "已复制" : "复制"}
      </button>
      <a href={addressUrl(CHAIN_ID, address)} target="_blank" rel="noreferrer" style={{ color: DIM, fontSize: 10 }}>浏览器</a>
      {onTrack && (
        <button
          type="button"
          disabled={tracked}
          onClick={onTrack}
          style={{ background: "none", border: 0, cursor: tracked ? "default" : "pointer", color: tracked ? DIM : GOLD, fontWeight: 700, fontSize: 11, padding: 0 }}
        >
          {tracked ? "已追踪" : "+ 追踪"}
        </button>
      )}
      {note ? <span style={{ color: GOLD, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }} title={note}>{note}</span> : null}
    </span>
  );
}

function DataRow({
  rank, row, unit, ethUsd, bal, extra, actions, tracked, onTrack,
}: {
  rank: number;
  row: SerializedWalletPnl;
  unit: "eth" | "usd";
  ethUsd?: number;
  bal: string | null | undefined;
  extra?: ReactNode;
  actions?: ReactNode;
  tracked?: boolean;
  onTrack?: () => void;
}) {
  const loadingBal = bal === undefined;
  const balN = bal == null || bal === "" ? null : Number(bal);
  return (
    <div
      className="track-row"
      style={{
        display: "grid",
        gridTemplateColumns: extra ? `${COLS} minmax(120px,0.8fr)` : COLS,
        gap: 8, alignItems: "center", padding: "9px 12px",
        borderBottom: "1px solid #161b22",
      }}
    >
      <span style={{ fontSize: 12, color: rank <= 3 ? GOLD : DIM, fontWeight: rank <= 3 ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>{rank}</span>
      <AddrCell address={row.address} tracked={tracked} onTrack={onTrack} />
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12, color: "#848e9c" }}>
        {loadingBal ? "…" : balN == null || !Number.isFinite(balN) ? "—" : fmtQuote(balN, unit, ethUsd)}
      </span>
      <PnlCell v={row.pnl.d7} unit={unit} ethUsd={ethUsd} />
      <WrCell w={row.winrate.d7} />
      <PnlCell v={row.pnl.d15} unit={unit} ethUsd={ethUsd} />
      <WrCell w={row.winrate.d15} />
      <PnlCell v={row.pnl.d30} unit={unit} ethUsd={ethUsd} />
      <WrCell w={row.winrate.d30} />
      <PnlCell v={row.pnl.total} unit={unit} ethUsd={ethUsd} />
      <span style={{ textAlign: "right", fontSize: 11, color: DIM, fontVariantNumeric: "tabular-nums" }}>
        {actions ?? row.tradeCount}
      </span>
      {extra}
    </div>
  );
}

function useTrackedList() {
  const [list, setList] = useState<TrackedWallet[]>([]);
  useEffect(() => {
    const sync = () => setList(loadTrackedWallets());
    sync();
    window.addEventListener(TRACKED_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TRACKED_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return list;
}

export default function TrackPage() {
  const [locale] = useLocale();
  const [unit] = useQuoteUnit();
  const { login, logout, authenticated, user } = usePrivy();
  const isMobile = useIsMobile();
  const wallet = user?.wallet?.address?.toLowerCase() ?? "";
  const isAdmin = useAdmins(wallet).isAdmin;
  const mine = useTrackedList();
  const trackedSet = useMemo(() => new Set(mine.map((w) => w.address)), [mine]);

  const [leaderSort, setLeaderSort] = useState<SortKey>("pnlTotal");
  const [leaderDir, setLeaderDir] = useState<"asc" | "desc">("desc");
  const [leaderFilter, setLeaderFilter] = useState<LeaderFilter>("profit");
  const [leaderPage, setLeaderPage] = useState(0);
  const [leaderQ, setLeaderQ] = useState("");

  const [mineSort, setMineSort] = useState<SortKey>("pnlTotal");
  const [mineDir, setMineDir] = useState<"asc" | "desc">("desc");
  const [minePage, setMinePage] = useState(0);
  const [mineQ, setMineQ] = useState("");

  const [addrInput, setAddrInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [importText, setImportText] = useState(IMPORT_SAMPLE);
  const [msg, setMsg] = useState<string | null>(null);
  const [balMap, setBalMap] = useState<Record<string, string | null>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: tokens } = useQuery({
    queryKey: ["tokens"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/tokens"));
      const body = await readJson<HomeToken[] | { error?: string }>(res);
      return Array.isArray(body) ? body : [];
    },
    staleTime: 8_000,
  });
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });
  const ethUsd = eth?.price;

  const { data: leaders, isFetching: leadersLoading } = useQuery({
    queryKey: ["track-leaders", leaderFilter],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/track/leaders?filter=${leaderFilter}&limit=2000`));
      const body = await readJson<LeadersResp | { error?: string }>(res);
      if (!res.ok || !body || !("rows" in body)) throw new Error("load failed");
      return body;
    },
    staleTime: 15_000,
  });

  const { data: mineStats } = useQuery({
    queryKey: ["track-stats", mine.map((w) => w.address).join(",")],
    enabled: mine.length > 0,
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/track/stats"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: mine.map((w) => w.address) }),
      });
      const body = await readJson<{ rows?: SerializedWalletPnl[] }>(res);
      const map: Record<string, SerializedWalletPnl> = {};
      for (const r of body.rows ?? []) map[r.address] = r;
      return map;
    },
    staleTime: 15_000,
  });

  function toggleSort(cur: SortKey, dir: "asc" | "desc", setS: (k: SortKey) => void, setD: (d: "asc" | "desc") => void, next: SortKey) {
    if (cur === next) setD(dir === "desc" ? "asc" : "desc");
    else {
      setS(next);
      setD("desc");
    }
  }

  const leaderFiltered = useMemo(() => {
    const rows = [...(leaders?.rows ?? [])];
    const q = leaderQ.trim().toLowerCase();
    return q ? rows.filter((r) => r.address.includes(q)) : rows;
  }, [leaders, leaderQ]);

  const mineFiltered = useMemo(() => {
    const q = mineQ.trim().toLowerCase();
    return mine
      .filter((w) => !q || w.address.includes(q) || (w.note ?? "").toLowerCase().includes(q) || w.label.toLowerCase().includes(q))
      .map((w) => ({ wallet: w, row: mineStats?.[w.address] ?? emptyPnlRow(w.address) }));
  }, [mine, mineQ, mineStats]);

  const leaderViewAll = useMemo(() => {
    const sign = leaderDir === "asc" ? 1 : -1;
    return [...leaderFiltered].sort((a, b) => (sortNum(a, leaderSort, balMap) - sortNum(b, leaderSort, balMap)) * sign);
  }, [leaderFiltered, leaderSort, leaderDir, balMap]);

  const mineViewAll = useMemo(() => {
    const sign = mineDir === "asc" ? 1 : -1;
    return [...mineFiltered].sort((a, b) => (sortNum(a.row, mineSort, balMap) - sortNum(b.row, mineSort, balMap)) * sign);
  }, [mineFiltered, mineSort, mineDir, balMap]);

  const leaderView = leaderViewAll.slice(leaderPage * PAGE, leaderPage * PAGE + PAGE);
  const mineView = mineViewAll.slice(minePage * PAGE, minePage * PAGE + PAGE);

  const visAddrs = useMemo(() => {
    const s = new Set<string>();
    for (const r of leaderView) s.add(r.address);
    for (const r of mineView) s.add(r.wallet.address);
    return [...s];
  }, [leaderView, mineView]);

  const { data: bals } = useQuery({
    queryKey: ["track-balances", visAddrs.join(",")],
    enabled: visAddrs.length > 0,
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/track/balances"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: visAddrs }),
      });
      const body = await readJson<{ balances?: Record<string, string | null> }>(res);
      return body.balances ?? {};
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!bals) return;
    setBalMap((prev) => ({ ...prev, ...bals }));
  }, [bals]);

  function addOne() {
    const address = addrInput.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      setMsg("请输入合法的 0x 钱包地址");
      return;
    }
    const r = addTrackedWallets([{ address, note: noteInput }]);
    if (r.limitHit) setMsg(`已达上限 ${TRACK_LIMIT} 个`);
    else if (r.added === 0) setMsg("该地址已在追踪列表");
    else setMsg(`已添加 ${shortAddr(address)}`);
    setAddrInput("");
    setNoteInput("");
  }

  function doImport(text: string) {
    const parsed = parseTrackedImport(text);
    if (parsed.entries.length === 0) {
      setMsg(parsed.invalid ? `没有可导入的地址（${parsed.invalid} 行无效）` : "没有可导入的地址");
      return;
    }
    const r = addTrackedWallets(parsed.entries);
    const bits = [`导入 ${r.added} 个`];
    if (r.skipped) bits.push(`跳过 ${r.skipped} 个`);
    if (parsed.invalid) bits.push(`无效 ${parsed.invalid} 行`);
    if (r.limitHit) bits.push(`已达上限 ${TRACK_LIMIT}`);
    setMsg(bits.join(" · "));
  }

  function doExport() {
    const blob = new Blob([formatTrackedExport(loadTrackedWallets())], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "snowon-track-wallets.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const chip = (on: boolean): CSSProperties => ({
    padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
    border: 0, borderRadius: 6, background: on ? GOLD : "#1e2329", color: on ? "#000" : "#848e9c",
  });

  function Pager({ page, setPage, total }: { page: number; setPage: (n: number) => void; total: number }) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (total <= PAGE) return null;
    return (
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "8px 12px", fontSize: 12, color: DIM }}>
        <button type="button" disabled={page <= 0} onClick={() => setPage(Math.max(0, page - 1))} style={chip(false)}>上一页</button>
        <span>{page + 1} / {pages} · 共 {total}</span>
        <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(Math.min(pages - 1, page + 1))} style={chip(false)}>下一页</button>
      </div>
    );
  }

  return (
    <main style={{ minHeight: "calc(100vh - 44px)", padding: isMobile ? "8px 8px" : "10px 14px", display: "flex", flexDirection: "column", gap: 8, boxSizing: "border-box" }}>
      <header className="site-header" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1 style={{ fontSize: isMobile ? 15 : 18, margin: 0, fontWeight: 800, whiteSpace: "nowrap" }}>
            SnowOn <span style={{ color: GOLD }}>Terminal</span>
          </h1>
        </Link>
        <AppNav current="track" />
        {isAdmin && (
          <Link href="/admin" className="desktop-only" style={{ color: "#848e9c", textDecoration: "none", fontSize: 13 }}>管理</Link>
        )}
        <div className="search-wrap" style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <SearchBox />
        </div>
        <AiPanel />
        <PortfolioPanel />
        <LanguageSwitcher />
        <button onClick={authenticated ? logout : login} style={btnStyle}>
          {authenticated ? `${user?.wallet?.address?.slice(0, 6) ?? user?.email ?? ""}…` : t(locale, "wallet")}
        </button>
      </header>

      <FavoritesBar tokens={tokens ?? []} />

      {/* 盈利地址排行 */}
      <section style={{ border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 280 }}>
        <header style={{ padding: "12px 14px", borderBottom: "1px solid #1e2329", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>👁 {t(locale, "track")}</span>
          <span style={{ fontSize: 12, color: DIM }}>交易盈利地址 · 已实现PNL（卖出结算）· 点表头排序</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={() => { setLeaderFilter("profit"); setLeaderPage(0); }} style={chip(leaderFilter === "profit")}>盈利</button>
            <button type="button" onClick={() => { setLeaderFilter("all"); setLeaderPage(0); }} style={chip(leaderFilter === "all")}>全部</button>
          </div>
          <input
            value={leaderQ}
            onChange={(e) => { setLeaderQ(e.target.value); setLeaderPage(0); }}
            placeholder="筛选地址"
            style={{ ...inputStyle, width: 180 }}
          />
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <QuoteUnitToggle size={16} />
            <span style={{ fontSize: 11, color: DIM }}>{leaders?.total ?? 0} 个地址</span>
          </span>
        </header>
        <div className="track-scroll col-scroll">
          <TableHead
            sort={leaderSort}
            dir={leaderDir}
            onSort={(k) => { toggleSort(leaderSort, leaderDir, setLeaderSort, setLeaderDir, k); setLeaderPage(0); }}
          />
          {leadersLoading && !leaders && (
            <div style={{ color: DIM, fontSize: 13, textAlign: "center", margin: "36px 0" }}>加载中…</div>
          )}
          {leaderView.length === 0 && !leadersLoading && (
            <div style={{ color: DIM, fontSize: 13, textAlign: "center", margin: "36px 0" }}>暂无成交地址</div>
          )}
          {leaderView.map((row, i) => {
            const rank = leaderPage * PAGE + i + 1;
            const tracked = trackedSet.has(row.address);
            return (
              <DataRow
                key={row.address}
                rank={rank}
                row={row}
                unit={unit}
                ethUsd={ethUsd}
                bal={balMap[row.address]}
                tracked={tracked}
                onTrack={() => {
                  const r = addTrackedWallets([{ address: row.address }]);
                  setMsg(r.limitHit ? `已达上限 ${TRACK_LIMIT}` : tracked ? "已在列表" : "已加入追踪");
                }}
              />
            );
          })}
        </div>
        <Pager page={leaderPage} setPage={setLeaderPage} total={leaderViewAll.length} />
      </section>

      {/* 我的追踪 */}
      <section style={{ border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 320 }}>
        <header style={{ padding: "12px 14px", borderBottom: "1px solid #1e2329", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>我的追踪</span>
          <span style={{ fontSize: 12, color: DIM }}>{mine.length} / {TRACK_LIMIT}</span>
          <input
            value={mineQ}
            onChange={(e) => { setMineQ(e.target.value); setMinePage(0); }}
            placeholder="筛选地址 / 备注"
            style={{ ...inputStyle, width: 180 }}
          />
        </header>

        <div style={{ padding: "10px 14px", borderBottom: "1px solid #1e2329", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              value={addrInput}
              onChange={(e) => setAddrInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOne()}
              placeholder="钱包地址 0x…"
              style={{ ...inputStyle, flex: 1, minWidth: 220, fontFamily: "monospace" }}
            />
            <input
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOne()}
              placeholder="备注（可选）"
              style={{ ...inputStyle, width: 180 }}
            />
            <button type="button" onClick={addOne} style={btnStyle}>添加钱包</button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            spellCheck={false}
            style={{
              ...inputStyle, width: "100%", minHeight: 110, resize: "vertical",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              lineHeight: 1.45, boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => doImport(importText)} style={btnStyle}>导入</button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{ ...btnStyle, background: "#1e2329", color: "#eaecef" }}
            >
              从文件导入
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                void f.text().then((t) => {
                  setImportText(t);
                  doImport(t);
                });
              }}
            />
            <button
              type="button"
              onClick={doExport}
              disabled={mine.length === 0}
              style={{ ...btnStyle, background: "#1e2329", color: mine.length ? "#eaecef" : DIM }}
            >
              导出 CSV
            </button>
            <button
              type="button"
              onClick={() => setImportText(IMPORT_SAMPLE)}
              style={{ background: "none", border: 0, color: DIM, cursor: "pointer", fontSize: 12 }}
            >
              恢复样本
            </button>
            {msg && <span style={{ fontSize: 12, color: GOLD }}>{msg}</span>}
          </div>
        </div>

        <div className="track-scroll col-scroll">
          <TableHead
            sort={mineSort}
            dir={mineDir}
            onSort={(k) => { toggleSort(mineSort, mineDir, setMineSort, setMineDir, k); setMinePage(0); }}
            extra="备注"
          />
          {mineView.length === 0 && (
            <div style={{ color: DIM, fontSize: 13, textAlign: "center", margin: "36px 0" }}>
              还没有追踪任何地址，填写地址添加或按上方格式批量导入
            </div>
          )}
          {mineView.map((item, i) => (
            <DataRow
              key={item.wallet.address}
              rank={minePage * PAGE + i + 1}
              row={item.row}
              unit={unit}
              ethUsd={ethUsd}
              bal={balMap[item.wallet.address]}
              actions={
                <button
                  type="button"
                  onClick={() => removeTrackedWallet(item.wallet.address)}
                  style={{ background: "none", border: 0, color: BAD, cursor: "pointer", fontSize: 11 }}
                >
                  移除
                </button>
              }
              extra={
                <input
                  value={item.wallet.note ?? ""}
                  onChange={(e) => patchTrackedWallet(item.wallet.address, { note: e.target.value })}
                  placeholder="备注"
                  style={{ ...inputStyle, width: "100%", padding: "5px 8px", fontSize: 11 }}
                />
              }
            />
          ))}
        </div>
        <Pager page={minePage} setPage={setMinePage} total={mineViewAll.length} />
      </section>
    </main>
  );
}
