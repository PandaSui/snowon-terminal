import { createPublicClient, http } from "viem";
import { createAdapter, type LaunchpadAdapter } from "@terminal/adapters";
import { chainById } from "./chains";
import { getChainConfig, toAdapterConfig } from "./chainConfigs";
import { CHAIN_ID } from "./db";

let cached: { key: string; adapter: LaunchpadAdapter } | null = null;

/** 报价/构交易共用 adapter,避免每个请求新建 PublicClient */
export async function getAdapter(): Promise<LaunchpadAdapter> {
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
