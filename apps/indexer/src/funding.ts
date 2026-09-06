import type { PublicClient } from "viem";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import type { Db } from "@terminal/db";
import { wallets } from "@terminal/db";

/**
 * 资金来源回填:每个新钱包第一笔入账原生币的 from。
 * Robinhood RPC 没有 trace_filter,主路径走 Blockscout 账户交易列表。
 */
const inFlight = new Set<string>();
const done = new Set<string>();
const queue: Array<() => Promise<void>> = [];
let pumping = false;

const EXPLORER_API: Record<number, string> = {
  4663: "https://robinhoodchain.blockscout.com/api",
  46630: "https://explorer.testnet.chain.robinhood.com/api",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface ExplorerTx {
  from?: string;
  to?: string;
  value?: string;
  hash?: string;
  timeStamp?: string;
  blockNumber?: string;
}

async function explorerTxs(api: string, address: string, action: "txlist" | "txlistinternal"): Promise<ExplorerTx[]> {
  const url = `${api}?module=account&action=${action}&address=${address}&startblock=0&endblock=99999999&page=1&offset=40&sort=asc`;
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "application/json, text/plain, */*",
      referer: `${api.replace(/\/api$/, "")}/`,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 429) throw new Error("429");
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  const j = (await res.json()) as { result?: ExplorerTx[] | string };
  return Array.isArray(j.result) ? j.result : [];
}

function firstInbound(addr: string, rows: ExplorerTx[]): ExplorerTx | null {
  for (const t of rows) {
    const to = (t.to ?? "").toLowerCase();
    const from = (t.from ?? "").toLowerCase();
    if (to !== addr || !from || from === addr) continue;
    try {
      if (BigInt(t.value || "0") > 0n) return t;
    } catch {
      /* skip */
    }
  }
  return null;
}

async function fromExplorer(chainId: number, addr: string): Promise<{ from: string; tx: string; at: Date | null } | null> {
  const api = EXPLORER_API[chainId];
  if (!api) return null;
  const [ext, intern] = await Promise.all([
    explorerTxs(api, addr, "txlist"),
    explorerTxs(api, addr, "txlistinternal").catch(() => [] as ExplorerTx[]),
  ]);
  const a = firstInbound(addr, ext);
  const b = firstInbound(addr, intern);
  const pick = [a, b].filter(Boolean).sort((x, y) => {
    const nx = Number(x!.blockNumber ?? x!.timeStamp ?? 0);
    const ny = Number(y!.blockNumber ?? y!.timeStamp ?? 0);
    return nx - ny;
  })[0];
  if (!pick?.from) {
    if (ext.length === 0 && intern.length === 0) return null;
    return null;
  }
  const ts = Number(pick.timeStamp ?? 0);
  return {
    from: pick.from.toLowerCase(),
    tx: pick.hash ?? "",
    at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : null,
  };
}

async function fromTrace(
  client: PublicClient,
  addr: string,
): Promise<{ from: string; tx: string; at: Date | null } | null> {
  if (process.env.TRACE_FILTER !== "1") return null;
  const rawRequest = client.request as (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  const traces = (await rawRequest({
    method: "trace_filter",
    params: [{ toAddress: [addr], fromBlock: "0x0" }],
  })) as Array<{ transactionHash: string; action: { from: string; value: string }; blockNumber: number }>;
  const first = traces
    .filter((t) => BigInt(t.action.value ?? "0x0") > 0n)
    .sort((a, b) => a.blockNumber - b.blockNumber)[0];
  if (!first) return null;
  const block = await client.getBlock({ blockNumber: BigInt(first.blockNumber) });
  return {
    from: first.action.from.toLowerCase(),
    tx: first.transactionHash,
    at: new Date(Number(block.timestamp) * 1000),
  };
}

async function backfillFirstFunder(
  db: Db,
  client: PublicClient,
  chainId: number,
  address: string,
): Promise<void> {
  const addr = address.toLowerCase();
  const key = `${chainId}:${addr}`;
  if (done.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const [existing] = await db
      .select({ firstFunder: wallets.firstFunder })
      .from(wallets)
      .where(and(eq(wallets.chainId, chainId), eq(wallets.address, addr)))
      .limit(1);
    if (existing?.firstFunder) {
      done.add(key);
      return;
    }

    let hit: { from: string; tx: string; at: Date | null } | null = null;
    try {
      hit = await fromExplorer(chainId, addr);
    } catch {
      hit = null;
    }
    if (!hit) {
      try {
        hit = await fromTrace(client, addr);
      } catch {
        hit = null;
      }
    }
    if (!hit) return;

    await db
      .update(wallets)
      .set({
        firstFunder: hit.from,
        firstFundTx: hit.tx || null,
        firstFundAt: hit.at,
      })
      .where(and(eq(wallets.chainId, chainId), eq(wallets.address, addr), isNull(wallets.firstFunder)));
    done.add(key);
    if (done.size > 200_000) done.clear();
  } finally {
    inFlight.delete(key);
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    await job().catch(() => {});
    await sleep(400);
  }
  pumping = false;
}

/** 成交路径:排队慢查,避免打爆浏览器接口。 */
export function enqueueFirstFunder(db: Db, client: PublicClient, chainId: number, address: string): void {
  if (queue.length > 800) queue.splice(0, queue.length - 800);
  queue.push(() => backfillFirstFunder(db, client, chainId, address));
  void pump();
}

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

/** 把库里还没资金来源的钱包慢慢补上。 */
export async function backfillMissingFunders(db: Db, client: PublicClient, chainId: number, limit = 12): Promise<void> {
  const rows = asRows<{ address: string }>(await db.execute(sql`
    SELECT address FROM wallets
    WHERE chain_id = ${chainId} AND first_funder IS NULL
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT ${limit}
  `));
  for (const r of rows) enqueueFirstFunder(db, client, chainId, r.address);
}
