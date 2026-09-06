"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/locale";

const EMOJIS = [
  "😀", "😂", "🤣", "😅", "😊", "😍", "😘", "😎",
  "🤩", "😏", "😭", "😡", "🤯", "🤔", "🙄", "😴",
  "❤️", "🔥", "🚀", "💎", "💰", "📈", "📉", "🏆",
  "✅", "❌", "💯", "⚡", "🌙", "🐸", "🐳", "👀",
  "👏", "💪", "🙏", "🎉", "🎯", "📌", "💡", "🛡️",
];

/** 轻量 emoji 面板,点选插入输入框 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={tr("emoji")}
        style={{
          width: 36, height: "100%", minHeight: 36, border: 0, cursor: "pointer",
          background: open ? "#1c1f26" : "transparent", color: open ? "#f0b90b" : "#848e9c",
          fontSize: 16, lineHeight: 1,
        }}
      >
        😊
      </button>
      {open && (
        <div
          className="emoji-pop"
          style={{
            position: "absolute", bottom: "calc(100% + 6px)", right: 0, zIndex: 40,
            width: 232, padding: 8, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2,
            background: "#0d1117", border: "1px solid #2b3139", borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
          }}
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              style={{
                width: 26, height: 26, border: 0, borderRadius: 6, cursor: "pointer",
                background: "transparent", fontSize: 16, lineHeight: "26px", padding: 0,
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
