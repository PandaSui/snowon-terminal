import { createPublicClient, http, type Address } from "viem";
import { and, eq } from "drizzle-orm";
import { createAdapter, mergePonsConfig, mergeFastConfig, PonsAdapter, FastLaunchAdapter, type LaunchpadAdapter } from "@terminal/adapters";
import { tokens } from "@terminal/db";
import { chainById } from "./chains";
import { getChainConfig, toAdapterConfig } from "./chainConfigs";
import { CHAIN_ID, db } from "./db";
import { ttlMap } from "./ttlCache";

let cached: { key: string; adapter: LaunchpadAdapter } | null = null;
let ponsCached: { key: string; adapter: PonsAdapter } | null = null;
let fastCached: { key: string; adapter: FastLaunchAdapter } | null = null;
const tokenMetaCache = ttlMap<string, {
  platformId: string | null;
  curveAddress: string;
  graduated: boolean;
  poolId: string | null;
  quoteAsset: string;
  buyTaxBps: number;
  sellTaxBps: number;
}>(8_000);

async function snowonAdapter(): Promise<LaunchpadAdapter> {
  const row = await getChainConfig(CHAIN_ID);
  if (!row) throw new Error(`chain ${CHAIN_ID} 未配置(chain_configs 表与 env 都没有)`);
  const key = `${row.chainId}:${row.rpcUrl}:${row.factory}:${row.swapRouter}:${row.poolManager}`;
  if (cached?.key === key) return cached.adapter;
  const client = createPublicClient({
    chain: chainById(row.chainId),
    transport: http(row.rpcUrl, { batch: false }),
  });
  const adapter = createAdapter(client, toAdapterConfig(row));
  cached = { key, adapter };
  return adapter;
}

async function ponsAdapter(): Promise<PonsAdapter> {
  const row = await getChainConfig(CHAIN_ID);
  if (!row) throw new Error(`chain ${CHAIN_ID} 未配置`);
  const pons = mergePonsConfig(CHAIN_ID, row.poolManager as Address, row);
  if (!pons) throw new Error("Pons V2 未配置(管理页工厂地址或 PONS_FACTORY_*)");
  const key = `${row.chainId}:${row.rpcUrl}:${pons.factory}:${pons.hook}:${pons.poolManager}`;
  if (ponsCached?.key === key) return ponsCached.adapter;
  const client = createPublicClient({
    chain: chainById(row.chainId),
    transport: http(row.rpcUrl, { batch: false }),
  });
  const adapter = new PonsAdapter(CHAIN_ID, client, pons.factory, pons.hook, pons.poolManager);
  ponsCached = { key, adapter };
  return adapter;
}

async function fastAdapter(): Promise<FastLaunchAdapter> {
  const row = await getChainConfig(CHAIN_ID);
  if (!row) throw new Error(`chain ${CHAIN_ID} 未配置`);
  const fast = mergeFastConfig(CHAIN_ID, row.poolManager as Address, row);
  if (!fast) throw new Error("Fast Launch 未配置(池管理器地址缺失)");
  const key = `${row.chainId}:${row.rpcUrl}:${fast.hook}:${fast.poolManager}:${row.swapRouter}`;
  if (fastCached?.key === key) return fastCached.adapter;
  const client = createPublicClient({
    chain: chainById(row.chainId),
    transport: http(row.rpcUrl, { batch: false }),
  });
  const adapter = new FastLaunchAdapter(CHAIN_ID, client, fast.hook, fast.poolManager, row.swapRouter as Address);
  fastCached = { key, adapter };
  return adapter;
}

/** 报价/构交易共用 adapter。传入 token 时按 platformId 选 snowon / pons / fast。 */
export async function getAdapter(token?: string): Promise<LaunchpadAdapter> {
  if (token) {
    const addr = token.toLowerCase();
    let tok = tokenMetaCache.get(addr);
    if (!tok) {
      const [row] = await db
        .select({
          platformId: tokens.platformId,
          curveAddress: tokens.curveAddress,
          graduated: tokens.graduated,
          poolId: tokens.poolId,
          quoteAsset: tokens.quoteAsset,
          buyTaxBps: tokens.buyTaxBps,
          sellTaxBps: tokens.sellTaxBps,
        })
        .from(tokens)
        .where(and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, addr)))
        .limit(1);
      if (row) {
        tok = row;
        tokenMetaCache.set(addr, row);
      }
    }
    if (tok?.platformId === "pons") {
      const adapter = await ponsAdapter();
      adapter.hint(addr as Address, {
        curve: tok.curveAddress,
        quoteAsset: tok.quoteAsset,
        graduated: tok.graduated,
        poolId: tok.poolId,
        taxBps: tok.buyTaxBps,
      });
      return adapter;
    }
    if (tok?.platformId === "fast") {
      const adapter = await fastAdapter();
      adapter.hint(addr as Address, {
        buyTaxBps: tok.buyTaxBps,
        sellTaxBps: tok.sellTaxBps,
      });
      return adapter;
    }
  }
  return snowonAdapter();
}
