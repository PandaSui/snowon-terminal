import { eq } from "drizzle-orm";
import { chainConfigs } from "@terminal/db";
import { loadChainConfigsFromEnv, type ChainConfig } from "@terminal/adapters";
import { db } from "./db";

export type ChainConfigRow = typeof chainConfigs.$inferSelect;

const CHAIN_NAMES: Record<number, string> = {
  4663: "Robinhood Chain",
  46630: "Robinhood Chain Testnet",
  56: "BNB Smart Chain",
};

let seeded = false;
const cfgCache = new Map<number, { at: number; row: ChainConfigRow | undefined }>();
const CFG_TTL_MS = 30_000;

export function invalidateChainConfigCache(chainId?: number) {
  if (chainId == null) cfgCache.clear();
  else cfgCache.delete(chainId);
}

/** 表为空时把 env(SNOWON_*_<chainId>)种子导入 DB,现有部署零迁移;只跑一次 */
async function seedFromEnvIfEmpty(): Promise<void> {
  if (seeded) return;
  seeded = true;
  const rows = await db.select({ chainId: chainConfigs.chainId }).from(chainConfigs).limit(1);
  if (rows.length > 0) return;
  let envConfigs: ChainConfig[];
  try {
    envConfigs = loadChainConfigsFromEnv();
  } catch {
    return; // env 未配置(ENABLED_CHAINS 空)——保持空表
  }
  for (const c of envConfigs) {
    await db
      .insert(chainConfigs)
      .values({
        chainId: c.chainId,
        platformId: c.platformId,
        name: CHAIN_NAMES[c.chainId] ?? `Chain ${c.chainId}`,
        rpcUrl: c.rpcUrl,
        wsUrl: c.wsUrl ?? null,
        factory: c.factory,
        hook: c.hook,
        registry: c.registry,
        swapRouter: c.swapRouter,
        poolManager: c.poolManager,
        deployBlock: c.deployBlock,
        enabled: true,
      })
      .onConflictDoNothing();
  }
}

/** 全部链配置(管理面板列表) */
export async function listChainConfigs(): Promise<ChainConfigRow[]> {
  await seedFromEnvIfEmpty();
  return db.select().from(chainConfigs).orderBy(chainConfigs.chainId);
}

/**
 * 单链配置:DB 优先;DB 读失败或缺行时回退 env,保证交易 API 永远有配置可用。
 * 返回形状与 chain_configs 行一致(wsUrl 可能为 null)。
 */
export async function getChainConfig(chainId: number): Promise<ChainConfigRow | undefined> {
  const hit = cfgCache.get(chainId);
  if (hit && Date.now() - hit.at < CFG_TTL_MS) return hit.row;

  let row: ChainConfigRow | undefined;
  try {
    await seedFromEnvIfEmpty();
    const [dbRow] = await db.select().from(chainConfigs).where(eq(chainConfigs.chainId, chainId)).limit(1);
    if (dbRow) row = dbRow;
  } catch (e) {
    console.error("[chainConfigs] DB 读取失败,回退 env:", (e as Error).message);
  }
  if (!row) {
    const env = loadChainConfigsFromEnv().find((c) => c.chainId === chainId);
    if (env) {
      row = {
        chainId: env.chainId,
        platformId: env.platformId,
        name: CHAIN_NAMES[env.chainId] ?? `Chain ${env.chainId}`,
        rpcUrl: env.rpcUrl,
        wsUrl: env.wsUrl ?? null,
        factory: env.factory,
        hook: env.hook,
        registry: env.registry,
        swapRouter: env.swapRouter,
        poolManager: env.poolManager,
        deployBlock: env.deployBlock,
        enabled: true,
        updatedAt: new Date(0),
      };
    }
  }
  cfgCache.set(chainId, { at: Date.now(), row });
  return row;
}

/** 行 → adapters 的 ChainConfig(wsUrl null → undefined,地址列按 0x 模板收窄) */
export function toAdapterConfig(row: ChainConfigRow): ChainConfig {
  return { ...row, wsUrl: row.wsUrl ?? undefined } as unknown as ChainConfig;
}
