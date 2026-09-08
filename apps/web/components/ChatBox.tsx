"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { EmojiPicker } from "./EmojiPicker";
import { useT } from "@/lib/locale";
import { useSession } from "@/lib/useSession";
import { ChatMsgRow, isMineMsg } from "./ChatMsgRow";

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
 * 鉴权:签名登录会话令牌(useSession),服务端 verifySession 得到可信钱包地址。
 */
export function ChatBox({ chainId, tokenAddress }: { chainId: number; tokenAddress: string }) {
  const tr = useT();
  const { authenticated, login, user } = usePrivy();
  const session = useSession();
  const myId = (session.address || user?.wallet?.address || "").toLowerCase();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [dmkInput, setDmkInput] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const room = `${chainId}:${tokenAddress.toLowerCase()}`;

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL;
    if (!url) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "auth", token: session.token }));
      ws.send(JSON.stringify({ t: "join", room }));
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
      if (data.t === "error") {
        setLastError(data.message ?? "error");
        setTimeout(() => setLastError(null), 4000);
      }
    };
    return () => ws.close();
  }, [room, session.token]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  /** 发送门槛:未连钱包→Privy 登录;已连未签名→签名登录换会话令牌 */
  function ensureAuth(action: () => void) {
    if (!authenticated) return login();
    if (!session.signedIn) {
      void session.signIn();
      return;
    }
    action();
  }

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

  /** 弹幕:买入 ≥$5 该代币即可发(服务端按累计买入 ETH×现价校验),炫彩字体飘到 K 线图 */
  function sendDanmaku() {
    if (!dmkInput.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({
      t: "danmaku",
      room,
      content: dmkInput,
      wallet: session.address ?? undefined,
    }));
    setDmkInput("");
  }

  const hint = !authenticated
    ? { chat: tr("chatLogin"), dmk: tr("danmakuLogin") }
    : !session.signedIn
      ? { chat: tr("chatSignIn"), dmk: tr("danmakuSignIn") }
      : { chat: tr("saySomething"), dmk: tr("danmakuPh") };

  return (
    <div style={{ border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden", boxSizing: "border-box" }}>
      <div ref={listRef} className="col-scroll" style={{ flex: 1, overflowY: "auto", padding: 12, fontSize: 13, minHeight: 0 }}>
        {messages.map((m) => (
          <ChatMsgRow
            key={m.id}
            mine={isMineMsg(m.userId, myId)}
            userId={m.userId}
            username={m.username}
            content={m.content}
            holdingShareBps={m.holdingShareBps}
            avatarSize={18}
          />
        ))}
      </div>
      {(lastError || session.error) && (
        <div style={{ padding: "4px 10px", fontSize: 11, color: "#f6465d", borderTop: "1px solid #1e2329" }}>
          {lastError ?? session.error}
        </div>
      )}
      {/* 付费弹幕行:消息输入的上一栏 */}
      <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderTop: "1px solid #1e2329", background: "#10141b", minWidth: 0 }}>
        <input
          value={dmkInput}
          onChange={(e) => setDmkInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ensureAuth(sendDanmaku)}
          maxLength={60}
          placeholder={hint.dmk}
          style={{
            flex: 1, minWidth: 0, padding: "7px 8px", fontSize: 12,
            background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
            color: "#fff", outline: "none",
          }}
        />
        <button
          onClick={() => ensureAuth(sendDanmaku)}
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
          onKeyDown={(e) => e.key === "Enter" && ensureAuth(send)}
          placeholder={hint.chat}
          style={{
            flex: 1, minWidth: 0, padding: "10px 8px", background: "transparent",
            border: 0, color: "#fff", outline: "none", fontSize: 12,
          }}
        />
        <EmojiPicker onPick={(e) => setInput((v) => v + e)} />
        <button
          onClick={() => ensureAuth(send)}
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
