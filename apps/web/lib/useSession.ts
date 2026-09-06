"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
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

/**
 * 签名登录:用连接的(注入式)钱包对 nonce 签名,换取服务端会话令牌。
 * admin 写接口用它做 Bearer;chat 连接用它鉴权。
 */
export function useSession() {
  const { wallets } = useWallets();
  const [token, setToken] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem(KEY);
      if (decode(t)) setToken(t);
      else if (t) localStorage.removeItem(KEY);
    } catch {
      /* localStorage 不可用 */
    }
  }, []);

  const address = decode(token)?.addr ?? null;

  const signIn = useCallback(async () => {
    const wallet = wallets?.[0];
    if (!wallet) {
      setError("请先连接钱包");
      return null;
    }
    setSigning(true);
    setError(null);
    try {
      const addr = wallet.address;
      const { nonce } = await fetch(apiUrl("/api/auth/nonce")).then((r) => r.json());
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
      setError((e as Error).message?.slice(0, 100) ?? "登录失败");
      return null;
    } finally {
      setSigning(false);
    }
  }, [wallets]);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
  }, []);

  return { token, address, signedIn: !!address, signIn, signOut, signing, error };
}
