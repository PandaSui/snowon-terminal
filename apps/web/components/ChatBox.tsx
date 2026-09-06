"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { EmojiPicker } from "./EmojiPicker";
import { EmojiAvatar } from "./EmojiAvatar";
import { useT } from "@/lib/locale";

interface ChatMsg {
  id: string;
  userId: string;
  username: string;
  content: string;
  holdingShareBps?: number | null;
  createdAt: string;
}

/**
 * 代币聊天室。emoji 直接输入(UTF-8);表情面板前端用 emoji-mart 增强。
 * 持仓徽章:用户名旁的百分比,来自消息发送时的快照。
 */
export function ChatBox({ chainId, tokenAddress }: { chainId: number; tokenAddress: string }) {
  const tr = useT();
  const { authenticated, user, login, getAccessToken } = usePrivy();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [dmkInput, setDmkInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const room = `${chainId}:${tokenAddress.toLowerCase()}`;

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL;
    if (!url) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      // 服务端启用 PRIVY_APP_SECRET 时校验 token;开发模式回退到 userId
      void (async () => {
        const token = authenticated ? await getAccessToken().catch(() => null) : null;
        ws.send(JSON.stringify({
          t: "auth",
          token,
          userId: user?.id ?? `anon:${Math.random().toString(36).slice(2)}`,
          wallet: user?.wallet?.address,
        }));
        ws.send(JSON.stringify({ t: "join", room }));
      })();
    };
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
      if (data.t === "msg") setMessages((prev) => [...prev.slice(-199), { ...data, id: String(data.id), username: data.username ?? "anon" }]);
      if (data.t === "delete") setMessages((prev) => prev.filter((m) => m.id !== data.id));
    };
    return () => ws.close();
  }, [room, user?.id]);

  function send() {
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({
      t: "msg",
      room,
      content: input,
      clientMsgId: crypto.randomUUID(),
    }));
    setInput("");
  }

  /** 付费弹幕:5U/条,炫彩字体飘到 K 线图(支付验证待合约,见服务端 DANMAKU_REQUIRE_PAYMENT) */
  function sendDanmaku() {
    if (!dmkInput.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({
      t: "danmaku",
      room,
      content: dmkInput,
      wallet: user?.wallet?.address,
    }));
    setDmkInput("");
  }

  return (
    <div style={{ border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, fontSize: 13 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 6 }}>
            <EmojiAvatar seed={m.userId || m.username} size={18} />
            <span style={{ minWidth: 0 }}>
            <span style={{ color: "#f0b90b", fontWeight: 600 }}>{m.username}</span>
            {m.holdingShareBps != null && m.holdingShareBps > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, color: "#0ecb81" }}>
                {tr("holdShare", { pct: (m.holdingShareBps / 100).toFixed(2) })}
              </span>
            )}
            <span style={{ marginLeft: 8, wordBreak: "break-word" }}>{m.content}</span>
            </span>
          </div>
        ))}
      </div>
      {/* 付费弹幕行:消息输入的上一栏 */}
      <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderTop: "1px solid #1e2329", background: "#10141b", minWidth: 0 }}>
        <input
          value={dmkInput}
          onChange={(e) => setDmkInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (authenticated ? sendDanmaku() : login())}
          maxLength={60}
          placeholder={authenticated ? tr("danmakuPh") : tr("danmakuLogin")}
          style={{
            flex: 1, minWidth: 0, padding: "7px 8px", fontSize: 12,
            background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
            color: "#fff", outline: "none",
          }}
        />
        <button
          onClick={authenticated ? sendDanmaku : login}
          title={tr("danmakuTip")}
          style={{
            flexShrink: 0, padding: "0 8px", border: 0, borderRadius: 6, cursor: "pointer",
            background: "linear-gradient(90deg,#00c3ff,#b15bff,#ff004c)",
            color: "#fff", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap",
          }}
        >
          {tr("danmaku")}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "stretch", borderTop: "1px solid #1e2329", minWidth: 0 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (authenticated ? send() : login())}
          placeholder={authenticated ? tr("saySomething") : tr("chatLogin")}
          style={{
            flex: 1, minWidth: 0, padding: "10px 8px", background: "transparent",
            border: 0, color: "#fff", outline: "none", fontSize: 12,
          }}
        />
        <EmojiPicker onPick={(e) => setInput((v) => v + e)} />
        <button
          onClick={authenticated ? send : login}
          style={{
            flexShrink: 0, padding: "0 12px", border: 0, background: "#f0b90b",
            fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontSize: 12,
          }}
        >
          {tr("send")}
        </button>
      </div>
    </div>
  );
}
