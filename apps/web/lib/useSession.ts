"use client";

import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { apiUrl } from "@/lib/apiBase";
import { buildLoginMessage } from "@/lib/authShared";

const KEY = "snowon:session";

/** 会话令牌里的地址与过期(客户端只解析,不校验签名——真伪由服务端 HMAC 保证)。 */
function decode(token: string | null): { addr: string; exp: number } | null {
  if (!token || !token.includes(".")) return null;
  try {
    const p = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))) as { addr: string; exp: number };
    return p.exp * 1000 > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const t = localStorage.getItem(KEY);
    if (decode(t)) return t;
    if (t) localStorage.removeItem(KEY);
  } catch {
    /* localStorage 不可用 */
  }
  return null;
}

export interface SessionValue {
  token: string | null;
  address: string | null;
  signedIn: boolean;
  signIn: () => Promise<string | null>;
  signOut: () => void;
  /** 没有对当前钱包有效的会话则弹出签名,返回可用 Bearer 令牌 */
  ensure: () => Promise<string>;
  signing: boolean;
  error: string | null;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * 签名登录:用当前连接的钱包对 nonce 签名,换取服务端会话令牌。
 * 必须挂在 PrivyProvider 内。全站共享一份 token,避免管理页签名后子组件仍带着空令牌保存失败。
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { wallets } = useWallets();
  const { user } = usePrivy();
  const [token, setToken] = useState<string | null>(readStored);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preferred = (user?.wallet?.address ?? "").toLowerCase();
  const decoded = decode(token);
  const address = decoded && (!preferred || decoded.addr === preferred) ? decoded.addr : null;
  const activeToken = address ? token : null;

  const pickWallet = useCallback(() => {
    const list = wallets ?? [];
    if (preferred) {
      const hit = list.find((w) => w.address.toLowerCase() === preferred);
      if (hit) return hit;
    }
    return list[0];
  }, [wallets, preferred]);

  const signIn = useCallback(async () => {
    const wallet = pickWallet();
    if (!wallet) {
      setError("请先连接钱包");
      return null;
    }
    setSigning(true);
    setError(null);
    try {
      const addr = wallet.address;
      const { nonce, error: nonceErr } = await fetch(apiUrl("/api/auth/nonce")).then((r) => r.json());
      if (!nonce) throw new Error(nonceErr ?? "获取登录凭证失败");
      const provider = await wallet.getEthereumProvider();
      const signature = (await provider.request({
        method: "personal_sign",
        params: [buildLoginMessage(addr, nonce), addr],
      })) as string;
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr, nonce, signature }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "登录失败");
      try {
        localStorage.setItem(KEY, body.token);
      } catch {
        /* ignore */
      }
      setToken(body.token);
      return body.token as string;
    } catch (e) {
      setError((e as Error).message?.slice(0, 160) ?? "登录失败");
      return null;
    } finally {
      setSigning(false);
    }
  }, [pickWallet]);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
  }, []);

  const ensure = useCallback(async () => {
    if (activeToken && address) return activeToken;
    const t = await signIn();
    if (!t) throw new Error("请先用当前连接的管理员钱包签名登录");
    return t;
  }, [activeToken, address, signIn]);

  const value = useMemo<SessionValue>(
    () => ({
      token: activeToken,
      address,
      signedIn: !!address,
      signIn,
      signOut,
      ensure,
      signing,
      error,
    }),
    [activeToken, address, signIn, signOut, ensure, signing, error],
  );

  return createElement(SessionContext.Provider, { value }, children);
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession 必须放在 SessionProvider 内");
  return ctx;
}
