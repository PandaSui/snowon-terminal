import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { ttlCache } from "@/lib/ttlCache";

/** 已实现 PNL + 胜率(7/15/30 天 + 全部),口径与 /api/profile/pnl 一致:加权平均成本、卖出结算。 */

export interface WindowStats {
  wins: number;
  losses: number;
  closed: number;
  pct: number | null;
}

export interface WalletPnl {
  address: string;
  pnl7: number;
  pnl15: number;
  pnl30: number;
  pnlTotal: number;
  wr7: WindowStats;
  wr15: WindowStats;
  wr30: WindowStats;
  wrTotal: WindowStats;
  tradeCount: number;
  lastAt: string | null;
}

export interface SerializedWalletPnl {
  address: string;
  pnl: { d7: string; d15: string; d30: string; total: string };
  winrate: { d7: WindowStats; d15: WindowStats; d30: WindowStats; total: WindowStats };
  tradeCount: number;
  lastAt: string | null;
}

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

function toWei(v: string | null | undefined): bigint {
  try {
    return BigInt((v ?? "0").split(".")[0] || "0");
  } catch {
    return 0n;
  }
}

function dayKey(ts: Date): string {
  return new Date(ts.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function wr(wins: number, losses: number): WindowStats {
  const closed = wins + losses;
  return { wins, losses, closed, pct: closed > 0 ? Math.round((wins / closed) * 1000) / 10 : null };
}

interface TradeRow {
  trader: string;
  token_address: string;
  is_buy: boolean;
  eth_amount: string;
  token_amount: string;
  block_timestamp: string | Date;
}

const E18 = 1e18;
const D7 = 7 * 86400_000;
const D15 = 15 * 86400_000;
const D30 = 30 * 86400_000;
const ZERO = "0x0000000000000000000000000000000000000000";

function replay(rows: TradeRow[]): WalletPnl[] {
  type Tok = {
    bal: bigint;
    cost: bigint;
    r7: number;
    r15: number;
    r30: number;
    rAll: number;
    s7: boolean;
    s15: boolean;
    s30: boolean;
    sAny: boolean;
  };
  type Acc = {
    tokens: Map<string, Tok>;
    pnl7: number;
    pnl15: number;
    pnl30: number;
    pnlTotal: number;
    trades: number;
    lastAt: number;
  };
  const wallets = new Map<string, Acc>();
  const now = Date.now();

  function accOf(addr: string): Acc {
    let a = wallets.get(addr);
    if (!a) {
      a = { tokens: new Map(), pnl7: 0, pnl15: 0, pnl30: 0, pnlTotal: 0, trades: 0, lastAt: 0 };
      wallets.set(addr, a);
    }
    return a;
  }
  function tokOf(a: Acc, token: string): Tok {
    let t = a.tokens.get(token);
    if (!t) {
      t = { bal: 0n, cost: 0n, r7: 0, r15: 0, r30: 0, rAll: 0, s7: false, s15: false, s30: false, sAny: false };
      a.tokens.set(token, t);
    }
    return t;
  }

  for (const r of rows) {
    const address = (r.trader ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address) || address === ZERO) continue;
    const a = accOf(address);
    a.trades += 1;
    const ts = new Date(r.block_timestamp);
    const tms = ts.getTime();
    if (Number.isFinite(tms) && tms > a.lastAt) a.lastAt = tms;
    const p = tokOf(a, (r.token_address ?? "").toLowerCase());
    const amt = toWei(r.token_amount);
    const ethWei = toWei(r.eth_amount);
    const eth = Number(ethWei) / E18;
    if (r.is_buy) {
      p.bal += amt;
      p.cost += ethWei;
      continue;
    }
    let realized = 0;
    if (p.bal > 0n && amt > 0n) {
      const sold = amt > p.bal ? p.bal : amt;
      const costPart = (p.cost * sold) / p.bal;
      realized = eth - Number(costPart) / E18;
      p.cost -= costPart;
      p.bal -= sold;
      if (p.cost < 0n) p.cost = 0n;
    } else {
      realized = eth;
    }
    p.sAny = true;
    p.rAll += realized;
    a.pnlTotal += realized;
    const age = now - (new Date(`${dayKey(ts)}T00:00:00Z`).getTime() - 8 * 3600_000);
    if (age <= D7) {
      p.r7 += realized;
      p.s7 = true;
      a.pnl7 += realized;
    }
    if (age <= D15) {
      p.r15 += realized;
      p.s15 = true;
      a.pnl15 += realized;
    }
    if (age <= D30) {
      p.r30 += realized;
      p.s30 = true;
      a.pnl30 += realized;
    }
  }

  const out: WalletPnl[] = [];
  for (const [address, a] of wallets) {
    let w7 = 0, l7 = 0, w15 = 0, l15 = 0, w30 = 0, l30 = 0, wA = 0, lA = 0;
    for (const t of a.tokens.values()) {
      if (t.s7) {
        if (t.r7 > 0) w7 += 1;
        else if (t.r7 < 0) l7 += 1;
      }
      if (t.s15) {
        if (t.r15 > 0) w15 += 1;
        else if (t.r15 < 0) l15 += 1;
      }
      if (t.s30) {
        if (t.r30 > 0) w30 += 1;
        else if (t.r30 < 0) l30 += 1;
      }
      if (t.sAny) {
        if (t.rAll > 0) wA += 1;
        else if (t.rAll < 0) lA += 1;
      }
    }
    out.push({
      address,
      pnl7: a.pnl7,
      pnl15: a.pnl15,
      pnl30: a.pnl30,
      pnlTotal: a.pnlTotal,
      wr7: wr(w7, l7),
      wr15: wr(w15, l15),
      wr30: wr(w30, l30),
      wrTotal: wr(wA, lA),
      tradeCount: a.trades,
      lastAt: a.lastAt ? new Date(a.lastAt).toISOString() : null,
    });
  }
  out.sort((x, y) => y.pnlTotal - x.pnlTotal);
  return out;
}

const packCache = ttlCache<{ list: WalletPnl[]; map: Map<string, WalletPnl> }>(20_000);

export async function loadWalletPnlPack(): Promise<{ list: WalletPnl[]; map: Map<string, WalletPnl> }> {
  const hit = packCache.get();
  if (hit) return hit;
  const res = await db.execute(sql`
    SELECT trader, token_address, is_buy, eth_amount::text, token_amount::text, block_timestamp
    FROM trades
    WHERE chain_id = ${CHAIN_ID}
      AND coalesce(kind, case when is_buy then 'buy' else 'sell' end) IN ('buy', 'sell')
    ORDER BY trader ASC, token_address ASC, block_timestamp ASC, log_index ASC
  `);
  const list = replay(asRows<TradeRow>(res));
  const map = new Map(list.map((w) => [w.address, w] as const));
  const pack = { list, map };
  packCache.set(pack);
  return pack;
}

export function emptyPnl(address: string): WalletPnl {
  const z = wr(0, 0);
  return {
    address,
    pnl7: 0,
    pnl15: 0,
    pnl30: 0,
    pnlTotal: 0,
    wr7: z,
    wr15: z,
    wr30: z,
    wrTotal: z,
    tradeCount: 0,
    lastAt: null,
  };
}

export function serializePnl(w: WalletPnl): SerializedWalletPnl {
  return {
    address: w.address,
    pnl: {
      d7: w.pnl7.toFixed(8),
      d15: w.pnl15.toFixed(8),
      d30: w.pnl30.toFixed(8),
      total: w.pnlTotal.toFixed(8),
    },
    winrate: { d7: w.wr7, d15: w.wr15, d30: w.wr30, total: w.wrTotal },
    tradeCount: w.tradeCount,
    lastAt: w.lastAt,
  };
}

export type LeaderSort =
  | "pnl7"
  | "pnl15"
  | "pnl30"
  | "pnlTotal"
  | "wr7"
  | "wr15"
  | "wr30"
  | "wrTotal"
  | "trades";

export function sortLeaders(list: WalletPnl[], sort: LeaderSort, dir: "asc" | "desc"): WalletPnl[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (w: WalletPnl): number => {
    switch (sort) {
      case "pnl7": return w.pnl7;
      case "pnl15": return w.pnl15;
      case "pnl30": return w.pnl30;
      case "wr7": return w.wr7.pct ?? -1;
      case "wr15": return w.wr15.pct ?? -1;
      case "wr30": return w.wr30.pct ?? -1;
      case "wrTotal": return w.wrTotal.pct ?? -1;
      case "trades": return w.tradeCount;
      default: return w.pnlTotal;
    }
  };
  return [...list].sort((a, b) => {
    const d = val(a) - val(b);
    if (d !== 0) return d * sign;
    return b.pnlTotal - a.pnlTotal;
  });
}
