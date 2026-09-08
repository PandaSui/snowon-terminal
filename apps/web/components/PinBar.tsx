"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Pin } from "@/lib/useGlobalChat";
import { useT } from "@/lib/locale";
import { EmojiAvatar } from "./EmojiAvatar";

const ROTATE_MS = 4_000;
/** 字体自适应:从 16px 逐级降到 MIN_FONT,仍放不下则横向滚动播放 */
const MAX_FONT = 16;
const MIN_FONT = 11;
/** 滚动速度 px/s,首尾各停顿 HOLD_MS */
const SCROLL_PX_PER_S = 40;
const HOLD_MS = 1500;

/**
 * 叮住消息顶部轮换栏:最多 5 条付费消息,每 4s 以上翻动效轮换。
 * 消息为炫彩闪烁字体(.pin-flash);无钉住消息时整栏隐藏。
 * 内容自适应:超长先缩字体,缩到最小仍溢出则走马灯滚动,语言再长也看得全。
 */
export function PinBar({ pins }: { pins: Pin[] }) {
  const tr = useT();
  const [idx, setIdx] = useState(0);
  const [fontSize, setFontSize] = useState(MAX_FONT);
  const [now, setNow] = useState(() => Date.now());
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (pins.length <= 1) return;
    const timer = setInterval(() => setIdx((i) => (i + 1) % pins.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [pins.length]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const pin = pins.length > 0 ? pins[idx % pins.length] : null;

  // 测量 + 自适应:换 pin / 容器尺寸变化时重算
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || !pin) return;

    let anim: Animation | null = null;
    const fit = () => {
      anim?.cancel();
      anim = null;
      // 先恢复到最大字号测溢出,再逐级缩
      let fs = MAX_FONT;
      content.style.fontSize = `${fs}px`;
      while (fs > MIN_FONT && content.scrollWidth > viewport.clientWidth) {
        fs -= 1;
        content.style.fontSize = `${fs}px`;
      }
      setFontSize(fs);
      const overflow = content.scrollWidth - viewport.clientWidth;
      if (overflow > 0) {
        // 走马灯:起点停顿 → 匀速滚到尾 → 尾部停顿 → 循环
        const travel = overflow + 24; // 末尾多留一点空隙
        const ms = HOLD_MS * 2 + (travel / SCROLL_PX_PER_S) * 1000;
        const holdRatio = HOLD_MS / ms;
        anim = content.animate(
          [
            { transform: "translateX(0px)", offset: 0 },
            { transform: "translateX(0px)", offset: holdRatio },
            { transform: `translateX(-${travel}px)`, offset: 1 - holdRatio },
            { transform: `translateX(-${travel}px)`, offset: 1 },
          ],
          { duration: ms, iterations: Infinity, easing: "linear" },
        );
      }
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(viewport);
    return () => {
      ro.disconnect();
      anim?.cancel();
    };
  }, [pin?.id, pin?.content]);

  if (!pin) {
    return (
      <div
        style={{
          minHeight: 64, display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", background: "#10141b", border: "1px dashed #2b3139",
          borderRadius: 10, overflow: "hidden", fontSize: 13, color: "#3d4450",
        }}
      >
        📌 {tr("pinBar")}
      </div>
    );
  }
  const remain = Math.max(0, Math.ceil((pin.expiresAt - now) / 1000));

  return (
    <div
      style={{
        minHeight: 64,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        padding: "8px 12px 10px",
        background: "#10141b",
        border: "1px solid #1e2329",
        borderRadius: 10,
        overflow: "hidden",
        fontSize: 16,
      }}
    >
      {/* 条数/倒计时顶到右上角,正文独占下一行全宽 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, minWidth: 0 }}>
        <span title={tr("pinned")} style={{ flexShrink: 0, fontSize: 15, lineHeight: 1 }}>📌</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "#848e9c", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <EmojiAvatar seed={pin.userId || pin.username} size={14} /> {pin.username}
        </span>
        <span style={{ flexShrink: 0, alignSelf: "flex-start", fontSize: 11, color: "#5e6673", whiteSpace: "nowrap", lineHeight: 1.3 }}>
          {tr("pinRemain", { i: idx + 1, n: pins.length, s: remain })}
        </span>
      </div>
      <div
        ref={viewportRef}
        style={{ overflow: "hidden", minHeight: 24, width: "100%", minWidth: 0 }}
      >
        <div key={pin.id} className="pin-flip" style={{ width: "max-content", minWidth: "100%", lineHeight: 1.3 }}>
          <span
            ref={contentRef}
            className="pin-flash"
            style={{
              fontSize, display: "inline-block", whiteSpace: "nowrap",
              maskImage: "linear-gradient(90deg, #000 92%, transparent)",
              WebkitMaskImage: "linear-gradient(90deg, #000 92%, transparent)",
            }}
          >
            {pin.content}
          </span>
        </div>
      </div>
    </div>
  );
}
