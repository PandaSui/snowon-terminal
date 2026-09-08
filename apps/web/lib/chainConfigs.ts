import { eq } from "drizzle-orm";
import { chainConfigs } from "@terminal/db";
import {
  loadChainConfigsFromEnv,
  loadPonsEnv,
  DEFAULT_PONS_FACTORY,
  DEFAULT_PONS_HOOK,
  DEFAULT_PONS_DEPLOY_BLOCK,
  type ChainConfig,
} from "@terminal/adapters";
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
    const pons = loadPonsEnv(c.chainId, c.poolManager);
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
        ponsFactory: pons?.factory ?? DEFAULT_PONS_FACTORY,
        ponsHook: pons?.hook ?? DEFAULT_PONS_HOOK,
        ponsDeployBlock: pons?.deployBlock ?? DEFAULT_PONS_DEPLOY_BLOCK,
        enabled: true,
      })
      .onConflictDoNothing();
  }
}

/** 已有链行若 Pons 列为空,用 env / 已知主网默认值补上,管理页才能看到可编辑地址。 */
async function ensurePonsColumns(): Promise<void> {
  const rows = await db
    .select({
      chainId: chainConfigs.chainId,
      poolManager: chainConfigs.poolManager,
      ponsFactory: chainConfigs.ponsFactory,
      ponsHook: chainConfigs.ponsHook,
      ponsDeployBlock: chainConfigs.ponsDeployBlock,
      ponsEnabled: chainConfigs.ponsEnabled,
    })
    .from(chainConfigs);
  for (const row of rows) {
    if (row.ponsEnabled === false) continue;
    const needFactory = !row.ponsFactory;
    const needHook = !row.ponsHook;
    const needDeploy = row.ponsDeployBlock == null || row.ponsDeployBlock === 0n;
    if (!needFactory && !needHook && !needDeploy) continue;
    const pons = loadPonsEnv(row.chainId, row.poolManager as `0x${string}`);
    await db
      .update(chainConfigs)
      .set({
        ...(needFactory ? { ponsFactory: pons?.factory ?? DEFAULT_PONS_FACTORY } : {}),
        ...(needHook ? { ponsHook: pons?.hook ?? DEFAULT_PONS_HOOK } : {}),
        ...(needDeploy ? { ponsDeployBlock: pons?.deployBlock ?? DEFAULT_PONS_DEPLOY_BLOCK } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chainConfigs.chainId, row.chainId));
  }
}

/** 全部链配置(管理面板列表) */
export async function listChainConfigs(): Promise<ChainConfigRow[]> {
  await seedFromEnvIfEmpty();
  try {
    await ensurePonsColumns();
  } catch (e) {
    console.error("[chainConfigs] ensurePonsColumns:", (e as Error).message);
  }
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
      const pons = loadPonsEnv(env.chainId, env.poolManager);
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
        ponsFactory: pons?.factory ?? DEFAULT_PONS_FACTORY,
        ponsHook: pons?.hook ?? DEFAULT_PONS_HOOK,
        ponsDeployBlock: pons?.deployBlock ?? DEFAULT_PONS_DEPLOY_BLOCK,
        snowonEnabled: true,
        ponsEnabled: true,
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
