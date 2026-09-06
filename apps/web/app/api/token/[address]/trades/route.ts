import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

const NEW_WALLET_HOURS = 24;

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

function parseLabels(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return [];
    try {
      const j = JSON.parse(t) as unknown;
      if (Array.isArray(j)) return j.map(String);
    } catch {
      /* ignore */
    }
    return [t];
  }
  return [];
}

function isPhish(funderLabel: string | null | undefined, labels: string[]): boolean {
  const blob = `${funderLabel ?? ""} ${labels.join(" ")}`.toLowerCase();
  return funderLabel === "mixer" || /(phish|scam|mixer|钓鱼|诈骗)/.test(blob);
}

function isBundle(labels: string[], clusterSize: number): boolean {
  if (clusterSize >= 2) return true;
  return /(bundler|bundle|sniper|捆)/.test(labels.join(" ").toLowerCase());
}

function toWei(s: string | null | undefined): bigint {
  try {
    return BigInt((s ?? "0").split(".")[0] || "0");
  } catch {
    return 0n;
  }
}

function priceFromWei(ethWei: bigint, tokenWei: bigint): string | null {
  if (tokenWei <= 0n || ethWei <= 0n) return null;
  const scaled = (ethWei * 10n ** 18n) / tokenWei;
  const intPart = scaled / 10n ** 18n;
  const frac = scaled % 10n ** 18n;
  return `${intPart}.${frac.toString().padStart(18, "0")}`;
}

/** 按时间回放加权成本:买入后均价 / 卖出前持仓成本 */
function replayCost(
  rows: Array<{ trader: string; isBuy: boolean; ethAmount: string; tokenAmount: string; txHash: string; logIndex: number }>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const byTrader = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byTrader.get(r.trader) ?? [];
    list.push(r);
    byTrader.set(r.trader, list);
  }
  for (const list of byTrader.values()) {
    let bal = 0n;
    let cost = 0n;
    for (const r of list) {
      const tok = toWei(r.tokenAmount);
      const eth = toWei(r.ethAmount);
      const key = `${r.txHash}:${r.logIndex}`;
      if (r.isBuy) {
        bal += tok;
        cost += eth;
        out.set(key, priceFromWei(cost, bal));
      } else {
        out.set(key, bal > 0n ? priceFromWei(cost, bal) : null);
        if (bal > 0n && tok > 0n) {
          const sold = tok > bal ? bal : tok;
          cost -= (cost * sold) / bal;
          bal -= sold;
          if (cost < 0n) cost = 0n;
        }
      }
    }
  }
  return out;
}

function timePred(windowKey: string) {
  switch (windowKey) {
    case "1h": return sql`tr.block_timestamp >= now() - interval '1 hour'`;
    case "4h": return sql`tr.block_timestamp >= now() - interval '4 hours'`;
    case "24h": return sql`tr.block_timestamp >= now() - interval '24 hours'`;
    case "3d": return sql`tr.block_timestamp >= now() - interval '3 days'`;
    case "7d": return sql`tr.block_timestamp >= now() - interval '7 days'`;
    default: return sql`TRUE`;
  }
}

/**
 * 某代币成交 + 钱包档案(首见时间/资金来源/标签)。
 * ?window=1h|4h|24h|3d|7d|all  ?order=asc|desc  ?limit=20..500
 */
export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const addr = address.toLowerCase();
    const url = new URL(req.url);
    const windowKey = ["1h", "4h", "24h", "3d", "7d", "all"].includes(url.searchParams.get("window") ?? "")
      ? (url.searchParams.get("window") as string)
      : "all";
    const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
    const limitRaw = Number(url.searchParams.get("limit") ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(20, Math.floor(limitRaw))) : 200;
    const since = timePred(windowKey);
    const orderBy = order === "asc"
      ? sql`tr.block_timestamp ASC, tr.log_index ASC`
      : sql`tr.block_timestamp DESC, tr.log_index DESC`;
    const outerOrder = order === "asc"
      ? sql`r.block_timestamp ASC, r.log_index ASC`
      : sql`r.block_timestamp DESC, r.log_index DESC`;

    const res = await db.execute(sql`
      WITH recent AS (
        SELECT
          tr.tx_hash, tr.log_index, tr.trader, tr.is_buy, tr.kind,
          tr.eth_amount, tr.token_amount, tr.price_eth, tr.phase, tr.block_timestamp,
          w.first_seen_at, w.last_seen_at, w.first_funder, w.funder_label, w.labels,
          p.buy_count, p.sell_count, p.total_bought_eth, p.balance, p.first_buy_at
        FROM trades tr
        LEFT JOIN wallets w ON w.chain_id = tr.chain_id AND w.address = tr.trader
        LEFT JOIN positions p
          ON p.chain_id = tr.chain_id AND p.wallet = tr.trader AND p.token_address = tr.token_address
        WHERE tr.chain_id = ${CHAIN_ID} AND tr.token_address = ${addr}
          AND ${since}
        ORDER BY ${orderBy}
        LIMIT ${limit}
      ),
      clusters AS (
        SELECT w.first_funder, count(*)::int AS n
        FROM positions p
        JOIN wallets w ON w.chain_id = p.chain_id AND w.address = p.wallet
        WHERE p.chain_id = ${CHAIN_ID}
          AND p.token_address = ${addr}
          AND p.balance > 0
          AND w.first_funder IS NOT NULL AND w.first_funder <> ''
        GROUP BY w.first_funder
        HAVING count(*) >= 2
      )
      SELECT
        r.tx_hash AS "txHash",
        r.log_index AS "logIndex",
        r.trader,
        r.is_buy AS "isBuy",
        coalesce(r.kind, case when r.is_buy then 'buy' else 'sell' end) AS kind,
        r.eth_amount::text AS "ethAmount",
        (r.token_amount::numeric / 1e18)::text AS "tokenAmountWhole",
        r.price_eth::text AS "priceEth",
        r.phase,
        to_json(r.block_timestamp)#>>'{}' AS "blockTimestamp",
        to_json(r.first_seen_at)#>>'{}' AS "firstSeenAt",
        to_json(r.last_seen_at)#>>'{}' AS "lastSeenAt",
        r.first_funder AS "firstFunder",
        r.funder_label AS "funderLabel",
        r.labels,
        r.buy_count AS "buyCount",
        r.sell_count AS "sellCount",
        (r.total_bought_eth::numeric / 1e18)::text AS "totalBoughtEth",
        to_json(r.first_buy_at)#>>'{}' AS "firstBuyAt",
        coalesce(c.n, 0)::int AS "clusterSize"
      FROM recent r
      LEFT JOIN clusters c ON c.first_funder = r.first_funder
      ORDER BY ${outerOrder}
    `);

    const cutoff = Date.now() - NEW_WALLET_HOURS * 3600 * 1000;
    const trades = asRows<{
      txHash: string;
      logIndex: number;
      trader: string;
      isBuy: boolean;
      kind: string | null;
      ethAmount: string;
      tokenAmountWhole: string;
      priceEth: string;
      phase: string;
      blockTimestamp: string | Date;
      firstSeenAt: string | Date | null;
      lastSeenAt: string | Date | null;
      firstFunder: string | null;
      funderLabel: string | null;
      labels: unknown;
      buyCount: number;
      sellCount: number;
      totalBoughtEth: string | null;
      firstBuyAt: string | Date | null;
      clusterSize: number;
    }>(res).map((t) => {
      const labels = parseLabels(t.labels);
      const firstSeen = t.firstSeenAt ? new Date(t.firstSeenAt).getTime() : NaN;
      const isNewWallet = Number.isFinite(firstSeen) && firstSeen >= cutoff;
      const clusterSize = Number(t.clusterSize ?? 0);
      const tradeMs = t.blockTimestamp ? new Date(t.blockTimestamp).getTime() : NaN;
      const firstBuyMs = t.firstBuyAt ? new Date(t.firstBuyAt).getTime() : NaN;
      const isFirstBuy = !!t.isBuy && Number.isFinite(tradeMs) && Number.isFinite(firstBuyMs) && Math.abs(tradeMs - firstBuyMs) <= 3000;
      return {
        txHash: t.txHash,
        logIndex: t.logIndex,
        trader: t.trader,
        isBuy: !!t.isBuy,
        kind: (t.kind || (t.isBuy ? "buy" : "sell")).toLowerCase(),
        ethAmount: t.ethAmount,
        tokenAmountWhole: t.tokenAmountWhole,
        priceEth: t.priceEth,
        phase: t.phase,
        blockTimestamp: t.blockTimestamp instanceof Date ? t.blockTimestamp.toISOString() : String(t.blockTimestamp),
        firstSeenAt: t.firstSeenAt instanceof Date ? t.firstSeenAt.toISOString() : t.firstSeenAt,
        buyCount: t.buyCount ?? 0,
        sellCount: t.sellCount ?? 0,
        totalBoughtEth: t.totalBoughtEth,
        firstFunder: t.firstFunder,
        isNewWallet,
        isFirstBuy,
        sameFunder: clusterSize >= 2,
        clusterSize,
        isPhish: isPhish(t.funderLabel, labels),
        isBundle: isBundle(labels, clusterSize),
        costEth: null as string | null,
      };
    });

    const traders = [...new Set(trades.map((t) => t.trader))];
    if (traders.length > 0) {
      const hist = asRows<{
        trader: string;
        is_buy: boolean;
        eth_amount: string;
        token_amount: string;
        tx_hash: string;
        log_index: number;
      }>(
        await db.execute(sql`
          SELECT trader, is_buy, eth_amount::text, token_amount::text, tx_hash, log_index
          FROM trades
          WHERE chain_id = ${CHAIN_ID}
            AND token_address = ${addr}
            AND trader IN (${sql.join(traders.map((a) => sql`${a}`), sql`, `)})
            AND coalesce(kind, case when is_buy then 'buy' else 'sell' end) IN ('buy', 'sell')
          ORDER BY trader, block_timestamp ASC, log_index ASC
        `),
      );
      const costs = replayCost(
        hist.map((r) => ({
          trader: r.trader,
          isBuy: !!r.is_buy,
          ethAmount: r.eth_amount,
          tokenAmount: r.token_amount,
          txHash: r.tx_hash,
          logIndex: r.log_index,
        })),
      );
      for (const t of trades) {
        t.costEth = costs.get(`${t.txHash}:${t.logIndex}`) ?? null;
      }
    }

    return NextResponse.json({ trades, newWalletHours: NEW_WALLET_HOURS, window: windowKey, order, limit });
  } catch (e) {
    return apiError(e);
  }
}
