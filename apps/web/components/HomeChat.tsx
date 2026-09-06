"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { apiUrl } from "@/lib/apiBase";
import type { ChatMsg, Pin } from "@/lib/useGlobalChat";

interface Props {
  messages: ChatMsg[];
  pins: Pin[];
  connected: boolean;
  lastError: string | null;
  onSend: (content: string) => void;
  onPin: (content: string) => void;
  pinning: boolean;
}

/**
 * 主页公共聊天室栏:
 * 消息列表 → 付费叮住行(20U/2分钟,炫彩闪烁字体上顶部轮换)→ 输入 + 发送。
 */
export function HomeChat({ messages, pins, connected, lastError, onSend, onPin, pinning }: Props) {
  const { authenticated, login } = usePrivy();
  const [input, setInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [cfg, setCfg] = useState({ price: "100", durMin: 60, max: 5 });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(apiUrl("/api/settings"))
      .then((r) => r.json())
      .then((s) =>
        setCfg({
          price: String(s.pinPriceSnow ?? "100"),
          durMin: Math.round((Number(s.pinDurationSec) || 3600) / 60),
          max: Number(s.pinMax) || 5,
        }),
      )
      .catch(() => {});
  }, []);

  // 新消息自动滚到底
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function send() {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  }

  function pin() {
    if (!pinInput.trim()) return;
    onPin(pinInput);
    setPinInput("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 消息列表 */}
      <div ref={listRef} className="col-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 10px", fontSize: 12, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ color: "#5e6673", textAlign: "center", marginTop: 24 }}>
            {connected ? "还没有消息,来说第一句吧" : "连接中…"}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 6, lineHeight: 1.5 }}>
            <span style={{ color: "#f0b90b", fontWeight: 600 }}>{m.username}</span>
            {m.holdingShareBps != null && m.holdingShareBps > 0 && (
              <span style={{ marginLeft: 4, fontSize: 10, color: "#0ecb81" }}>
                持仓 {(m.holdingShareBps / 100).toFixed(2)}%
              </span>
            )}
            <span style={{ marginLeft: 6, wordBreak: "break-word" }}>{m.content}</span>
          </div>
        ))}
      </div>

      {lastError && (
        <div style={{ padding: "4px 10px", fontSize: 11, color: "#f6465d" }}>⚠ {lastError}</div>
      )}

      {/* 付费叮住行:消息输入的上一栏 */}
      <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderTop: "1px solid #1e2329", background: "#10141b" }}>
        <input
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !pinning && (authenticated ? pin() : login())}
          maxLength={140}
          disabled={pinning}
          placeholder={authenticated ? `叮住你的消息… (${pins.length}/${cfg.max})` : "登录后可付费叮住"}
          style={{
            flex: 1, minWidth: 0, padding: "7px 10px", fontSize: 12,
            background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
            color: "#fff", outline: "none",
          }}
        />
        <button
          onClick={authenticated ? pin : login}
          disabled={pinning}
          title={`付费 ${cfg.price} SNOW,消息在顶部栏轮换展示 ${cfg.durMin} 分钟(最多 ${cfg.max} 条)`}
          style={{
            flexShrink: 0, padding: "0 10px", border: 0, borderRadius: 6,
            cursor: pinning ? "wait" : "pointer", opacity: pinning ? 0.6 : 1,
            background: "linear-gradient(90deg,#ff8a00,#ff004c,#b15bff)",
            backgroundSize: "200% 100%",
            color: "#fff", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap",
          }}
        >
          {pinning ? "付款中…" : `📌 ${cfg.price} SNOW·${cfg.durMin}分钟`}
        </button>
      </div>

      {/* 输入 + 发送 */}
      <div style={{ display: "flex", borderTop: "1px solid #1e2329" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (authenticated ? send() : login())}
          placeholder={authenticated ? "说点什么… 😊" : "登录后参与聊天"}
          style={{
            flex: 1, minWidth: 0, padding: "10px 12px", fontSize: 12,
            background: "transparent", border: 0, color: "#fff", outline: "none",
          }}
        />
        <button
          onClick={authenticated ? send : login}
          style={{
            flexShrink: 0, padding: "0 18px", border: 0, cursor: "pointer",
            background: "#f0b90b", fontWeight: 700, fontSize: 12,
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
