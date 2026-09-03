"use client";

import { useState } from "react";

export function TokenLogo({
  src,
  alt,
  size = 32,
}: {
  src?: string | null;
  alt: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const letter = (alt || "?").slice(0, 1).toUpperCase();
  if (!src || failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          background: "#1e2329",
          color: "#f0b90b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.max(12, size * 0.4),
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {letter}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={{ width: size, height: size, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
      onError={() => setFailed(true)}
    />
  );
}
