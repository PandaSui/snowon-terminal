import { createPublicClient, webSocket, type PublicClient, type Chain } from "viem";
import type { ChainConfig } from "@terminal/adapters";
import { throttledHttp, sharedLimiter } from "./ratelimit.js";

/** Robinhood Chain(未收录进 viem chains 前本地声明) */
export const robinhoodChain: Chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL_4663!] } },
};

export const robinhoodTestnet: Chain = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL_46630!] } },
};

export const bscChain: Chain = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL_56!] } },
};

export function chainById(chainId: number): Chain {
  switch (chainId) {
    case 4663: return robinhoodChain;
    case 46630: return robinhoodTestnet;
    case 56: return bscChain;
    default: throw new Error(`unknown chain ${chainId}`);
  }
}

export function clientFor(cfg: ChainConfig): PublicClient {
  // 注意:batch 必须关掉——该 RPC 的网关在批量模式下会间歇性丢响应(viem 报
  // "reading 'error'"),单请求模式稳定。429 限流改由 throttledHttp/sharedLimiter
  // 在 transport 层全局处理(并发闸 + 429 全局暂停 + 内部重试),取代原先各请求
  // 各自退避的惊群做法;index.ts 的 getLogsWithRetry 只再管 "exceeds limit" 拆分。
  const transport = cfg.wsUrl
    ? webSocket(cfg.wsUrl)
    : throttledHttp(cfg.rpcUrl, sharedLimiter, { batch: false, retryCount: 5, retryDelay: 1000, timeout: 20_000 });
  return createPublicClient({ chain: chainById(cfg.chainId), transport });
}
