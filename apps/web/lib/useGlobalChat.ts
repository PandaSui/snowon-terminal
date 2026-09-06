"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useWallets } from "@privy-io/react-auth";
import { apiUrl } from "@/lib/apiBase";
import { useSession } from "@/lib/useSession";

export interface ChatMsg {
  id: string;
  userId: string;
  username: string;
  content: string;
  holdingShareBps?: number | null;
  createdAt: string;
}

export interface Pin {
  id: string;
  userId: string;
  username: string;
  content: string;
  expiresAt: number;
}

/**
 * 公共聊天室(room = "{chainId}:global")hook:
 * WebSocket 连接 + 消息历史/广播 + 叮住消息全量同步。
 */
export function useGlobalChat(chainId: number) {
  const session = useSession();
  const { wallets } = useWallets();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [connected, setConnected] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const room = `${chainId}:global`;

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL;
    if (!url) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ t: "auth", token: session.token }));
      ws.send(JSON.stringify({ t: "join", room }));
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.t === "history") {
        setMessages(
          (data.messages ?? []).map((m: ChatMsg) => ({
            ...m,
            id: String(m.id),
            username: m.username ?? "anon",
          })),
        );
      }
      if (data.t === "msg") {
        setMessages((prev) => [...prev.slice(-199), { ...data, id: String(data.id), username: data.username ?? "anon" }]);
      }
      if (data.t === "delete") setMessages((prev) => prev.filter((m) => m.id !== data.id));
      if (data.t === "pins") setPins(data.pins ?? []);
      if (data.t === "error") {
        setLastError(data.message ?? "error");
        setTimeout(() => setLastError(null), 4000);
      }
    };
    return () => ws.close();
  }, [room, session.token]);

  const send = useCallback((content: string) => {
    if (!content.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ t: "msg", room, content, clientMsgId: crypto.randomUUID() }));
  }, [room]);

  const showErr = useCallback((m: string) => {
    setLastError(m);
    setTimeout(() => setLastError(null), 5000);
  }, []);

  /** 付费叮住:先向国库转 SNOW,等上链后带 txHash 发 pin;服务端做链上验付。 */
  const pin = useCallback(
    async (content: string) => {
      if (!content.trim() || wsRef.current?.readyState !== WebSocket.OPEN || pinning) return;
      const wallet = wallets?.[0];
      if (!wallet) return showErr("请先连接钱包");
      setPinning(true);
      try {
        const s = await fetch(apiUrl("/api/settings")).then((r) => r.json());
        const priceWei = BigInt(String(s.pinPriceSnow).split(".")[0] || "0") * 10n ** 18n;
        const pad = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
        const data = ("0xa9059cbb" + pad(s.pinPayee) + priceWei.toString(16).padStart(64, "0")) as `0x${string}`;

        const provider = await wallet.getEthereumProvider();
        if (Number(String(wallet.chainId).split(":").pop()) !== chainId) await wallet.switchChain(chainId);
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: wallet.address, to: s.snowToken, data, value: "0x0" }],
        })) as string;
        // 等待上链(服务端要靠 receipt 验付)
        for (let i = 0; i < 90; i++) {
          const r = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
          if (r) break;
          await new Promise((res) => setTimeout(res, 2000));
        }
        wsRef.current?.send(JSON.stringify({ t: "pin", room, content, payTxHash: hash, payer: wallet.address }));
      } catch (e) {
        showErr("付款失败:" + ((e as Error).message ?? "").slice(0, 100));
      } finally {
        setPinning(false);
      }
    },
    [room, chainId, wallets, pinning, showErr],
  );

  return {
    messages, pins, send, pin, connected, pinning, lastError,
    signedIn: session.signedIn, signIn: session.signIn, signing: session.signing,
  };
}
