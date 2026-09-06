"use client";

import { emojiAvatar } from "@/lib/emojiAvatar";

export function EmojiAvatar({
  seed,
  size = 20,
}: {
  seed: string;
  size?: number;
}) {
  const face = emojiAvatar(seed);
  return (
    <span
      aria-hidden
      title={face}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: Math.max(11, Math.round(size * 0.62)),
        lineHeight: 1,
        background: "#161b22",
        border: "1px solid #2b3139",
        userSelect: "none",
      }}
    >
      {face}
    </span>
  );
}
