"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Chain } from "viem";
import { TrackedWalletsProvider } from "@/lib/trackedWallets";

/** Robinhood Chain(viem 尚未收录,本地声明) */
export const robinhoodChain = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663),
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
} as const satisfies Chain;

const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  transports: { [robinhoodChain.id]: http() },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Privy 嵌入式钱包只在安全上下文(https / localhost)可用,
 * 裸 http://IP 访问时 PrivyProvider 会在渲染期抛
 * "Embedded wallet is only available over HTTPS" 崩掉整棵树 → 白屏。
 * 非安全上下文下去掉 embeddedWallets 配置:站点正常浏览,
 * 外部钱包(浏览器插件)登录可用,社交登录(依赖嵌入式钱包)降级不可用。
 */
function isSecureContextForPrivy(): boolean {
  if (typeof window === "undefined") return true;
  if (window.isSecureContext) return true;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const secure = isSecureContextForPrivy();
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmtosbw0d00a30ci6seosfrj9"}
      config={{
        // 双轨:Google / X 社交登录(嵌入式钱包,非托管) + 外部钱包
        loginMethods: ["google", "twitter", "wallet"],
        embeddedWallets: secure
          ? { ethereum: { createOnLogin: "users-without-wallets" } }
          : undefined,
        appearance: { theme: "dark" },
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <TrackedWalletsProvider>{children}</TrackedWalletsProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
