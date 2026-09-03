"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";

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
  const { authenticated, user, getAccessToken } = usePrivy();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const room = `${chainId}:global`;

  useEffect(() => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      void (async () => {
        const token = authenticated ? await getAccessToken().catch(() => null) : null;
        ws.send(JSON.stringify({
          t: "auth",
          token,
          userId: user?.id ?? `anon:${Math.random().toString(36).slice(2)}`,
        }));
        ws.send(JSON.stringify({ t: "join", room }));
      })();
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
  }, [room, authenticated, user?.id, getAccessToken]);

  const send = useCallback((content: string) => {
    if (!content.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ t: "msg", room, content, clientMsgId: crypto.randomUUID() }));
  }, [room]);

  const pin = useCallback((content: string) => {
    if (!content.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    // 付费 20U/2分钟;链上验付待支付合约就绪后接入(服务端 PIN_REQUIRE_PAYMENT 开关)
    wsRef.current.send(JSON.stringify({ t: "pin", room, content }));
  }, [room]);

  return { messages, pins, send, pin, connected, lastError };
}
