"use client";

import type { CSSProperties } from "react";
import { TwitterPreview } from "./TwitterPreview";

const linkStyle: CSSProperties = {
  fontSize: 12,
  color: "#848e9c",
  textDecoration: "none",
  border: "1px solid #1e2329",
  borderRadius: 4,
  padding: "3px 8px",
};

export function SocialLinks({
  website,
  twitter,
  telegram,
  github,
}: {
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  github?: string | null;
}) {
  const items = [
    website && { href: website, label: "Website" },
    telegram && { href: telegram, label: "Telegram" },
    github && { href: github, label: "GitHub" },
  ].filter(Boolean) as Array<{ href: string; label: string }>;
  if (items.length === 0 && !twitter) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {twitter ? <TwitterPreview href={twitter} compact={false} /> : null}
      {items.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noreferrer" style={linkStyle}>
          {l.label}
        </a>
      ))}
    </div>
  );
}
