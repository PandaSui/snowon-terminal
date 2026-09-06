"use client";

import { useEffect, useState } from "react";
import type { Pin } from "@/lib/useGlobalChat";

const ROTATE_MS = 4_000;

/**
 * 叮住消息顶部轮换栏:最多 5 条付费消息,每 4s 以上翻动效轮换。
 * 消息为炫彩闪烁字体(.pin-flash);无钉住消息时整栏隐藏。
 */
export function PinBar({ pins }: { pins: Pin[] }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (pins.length <= 1) return;
    const timer = setInterval(() => setIdx((i) => (i + 1) % pins.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [pins.length]);

  if (pins.length === 0) {
    return (
      <div
        style={{
          minHeight: 64, display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", background: "#10141b", border: "1px dashed #2b3139",
          borderRadius: 10, overflow: "hidden", fontSize: 13, color: "#3d4450",
        }}
      >
        📌 钉住消息展示区 · 付费 20U 让你的消息炫彩置顶 2 分钟
      </div>
    );
  }
  const pin = pins[idx % pins.length];
  const remain = Math.max(0, Math.ceil((pin.expiresAt - Date.now()) / 1000));

  return (
    <div
      style={{
        minHeight: 64,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 18px",
        background: "#10141b",
        border: "1px solid #1e2329",
        borderRadius: 10,
        overflow: "hidden",
        fontSize: 16,
      }}
    >
      <span style={{ flexShrink: 0, fontSize: 13, color: "#f0b90b", fontWeight: 800, letterSpacing: 1 }}>
        📌 叮住
      </span>
      <div style={{ flex: 1, overflow: "hidden", minHeight: 36, display: "flex", alignItems: "center" }}>
        <div key={pin.id} className="pin-flip" style={{ lineHeight: 1.35 }}>
          <span className="pin-flash" style={{ fontSize: 16 }}>{pin.content}</span>
          <span style={{ color: "#848e9c", fontSize: 12, marginLeft: 10 }}>— {pin.username}</span>
        </div>
      </div>
      <span style={{ flexShrink: 0, fontSize: 12, color: "#5e6673" }}>
        {idx + 1}/{pins.length} · 剩 {remain}s
      </span>
    </div>
  );
}
