"use client";

import { apiUrl } from "@/lib/apiBase";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { readJson } from "@/lib/http";
import { useTranslatedTexts } from "@/lib/useTranslated";

interface Preview {
  handle: string;
  name: string;
  bio: string;
  avatar: string | null;
  banner: string | null;
  followers: number | null;
  following: number | null;
  website: string | null;
  tweet: string | null;
  url: string;
}

function fmtCount(n: number | null): string {
  if (n == null) return "-";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function Card({ data, name, bio, tweet }: { data: Preview; name: string; bio: string; tweet: string }) {
  return (
    <div
      className="twitter-preview-card"
      style={{
        width: 280, background: "#0d1117", border: "1px solid #2b3139", borderRadius: 10,
        overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.55)", fontSize: 12, color: "#eaecef",
      }}
    >
      {data.banner && (
        <div style={{ height: 56, background: `#1e2329 url(${data.banner}) center/cover no-repeat` }} />
      )}
      <div style={{ padding: "10px 12px 12px", display: "flex", gap: 8 }}>
        {data.avatar ? (
          <img src={data.avatar} alt="" width={40} height={40} style={{ borderRadius: 20, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: 20, background: "#1e2329", flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name || data.handle}
          </div>
          <div style={{ color: "#5e6673", fontSize: 11 }}>@{data.handle}</div>
        </div>
      </div>
      {bio && (
        <p style={{ margin: "0 12px 8px", fontSize: 11, color: "#b7bcc5", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {bio}
        </p>
      )}
      {tweet && (
        <p style={{ margin: "0 12px 8px", fontSize: 11, color: "#eaecef", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", borderTop: "1px solid #161b22", paddingTop: 8 }}>
          {tweet}
        </p>
      )}
      <div style={{ display: "flex", gap: 12, padding: "0 12px 10px", fontSize: 11, color: "#848e9c" }}>
        <span><b style={{ color: "#eaecef" }}>{fmtCount(data.followers)}</b> followers</span>
        <span><b style={{ color: "#eaecef" }}>{fmtCount(data.following)}</b> following</span>
      </div>
    </div>
  );
}

/** 推特链接预览:头像/名称/简介/推文,文案随界面语言翻译(handle 不译) */
export function TwitterPreview({ href, compact = true }: { href: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["twitter-preview", href],
    enabled: open && !!href,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/twitter-preview?url=${encodeURIComponent(href)}`));
      const body = await readJson<Preview & { error?: string }>(res);
      if (!res.ok || body.error) return null;
      return body;
    },
  });
  const [nameT, bioT, tweetT] = useTranslatedTexts([
    data?.name ?? "",
    data?.bio ?? "",
    data?.tweet ?? "",
  ]);

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <a
        href={data?.url ?? href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={data ? `@${data.handle}` : href}
        style={
          compact
            ? {
                width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center",
                borderRadius: 4, background: "#1e2329", color: "#848e9c", textDecoration: "none",
              }
            : {
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#848e9c",
                textDecoration: "none", border: "1px solid #1e2329", borderRadius: 4, padding: "3px 8px",
              }
        }
      >
        <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M14.2 2H17l-5.2 6 6.2 8H13.6L9.8 11.4 5.2 16H2.4l5.6-6.4L2 2h4.5l3.4 4.8L14.2 2zm-1.1 12.6h1.5L7 3.3H5.4l7.7 11.3z" />
        </svg>
        {!compact && <span>@{data?.handle ?? "X"}</span>}
      </a>
      {open && data && (
        <div style={{ position: "absolute", left: 22, top: 0, zIndex: 40 }}>
          <Card data={data} name={nameT || data.name} bio={bioT || data.bio} tweet={tweetT || data.tweet || ""} />
        </div>
      )}
    </span>
  );
}
