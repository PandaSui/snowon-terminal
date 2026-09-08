import type { PublicClient } from "viem";
import type { ChainConfig, LaunchpadAdapter } from "./types.js";
import { SnowOnAdapter } from "./snowon/adapter.js";

export * from "./types.js";
export * from "./snowon/adapter.js";
export * as snowCurveMath from "./snowon/curveMath.js";
export * as snowAbis from "./snowon/abis.js";
export { readPoolSqrtP, readPoolLiquidity } from "./snowon/poolState.js";
export { fetchTokenOffchainMeta, type TokenOffchainMeta } from "./snowon/tokenMeta.js";
export { PonsAdapter, loadPonsEnv, mergePonsConfig, DEFAULT_PONS_FACTORY, DEFAULT_PONS_HOOK, DEFAULT_PONS_DEPLOY_BLOCK, type PonsEnv, type PonsTokenHint } from "./pons/adapter.js";
export * as ponsAbis from "./pons/abis.js";
export * as ponsCurveMath from "./pons/curveMath.js";

type AdapterFactory = (client: PublicClient, cfg: ChainConfig) => LaunchpadAdapter;

const factories: Record<string, AdapterFactory> = {
  snowon: (client, cfg) => new SnowOnAdapter(cfg.chainId, client, cfg),
  // BSC 预留: 'snowon-bsc': (client, cfg) => new SnowOnBscAdapter(...)
};

export function createAdapter(client: PublicClient, cfg: ChainConfig): LaunchpadAdapter {
  const f = factories[cfg.platformId];
  if (!f) throw new Error(`no adapter for platform '${cfg.platformId}'`);
  return f(client, cfg);
}

/** 已注册链配置(registry 数据驱动,新链 = 加一条记录) */
export function loadChainConfigsFromEnv(): ChainConfig[] {
  const enabled = (process.env.ENABLED_CHAINS ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean);
  const configs: ChainConfig[] = [];
  for (const chainId of enabled) {
    const env = (k: string) => {
      const v = process.env[`${k}_${chainId}`];
      if (!v) throw new Error(`missing env ${k}_${chainId}`);
      return v;
    };
    configs.push({
      chainId,
      rpcUrl: process.env[`RPC_URL_${chainId}`]!,
      wsUrl: process.env[`WS_URL_${chainId}`],
      platformId: "snowon",
      factory: env("SNOWON_FACTORY") as `0x${string}`,
      hook: env("SNOWON_HOOK") as `0x${string}`,
      registry: env("SNOWON_REGISTRY") as `0x${string}`,
      swapRouter: env("SNOWON_SWAP_ROUTER") as `0x${string}`,
      poolManager: env("SNOWON_POOL_MANAGER") as `0x${string}`,
      deployBlock: BigInt(process.env[`SNOWON_DEPLOY_BLOCK_${chainId}`] ?? "0"),
    });
  }
  return configs;
}
