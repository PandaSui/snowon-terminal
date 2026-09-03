import type { Chain } from "viem";

export const robinhoodChain = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663),
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? process.env.RPC_URL_4663 ?? ""] } },
  // 链上已部署标准 multicall3(0xca11…ca11),viem 的 client.multicall 需要这里登记
  contracts: { multicall3: { address: "0xca11bde05977b3631167028862be2a173976ca11" } },
} as const satisfies Chain;

export function chainById(chainId: number): Chain {
  if (chainId === robinhoodChain.id) return robinhoodChain;
  throw new Error(`unsupported chain ${chainId}`);
}
