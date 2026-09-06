"use client";

import Link from "next/link";
import { t, useLocale } from "@/lib/locale";

/** 顶栏主导航:发现 / 热门 / 追踪 / Launch */
export function AppNav({ current }: { current?: "discover" | "hot" | "track" | "profile" | "admin" | "token" }) {
  const [locale] = useLocale();
  const item = (active: boolean): React.CSSProperties => ({
    color: active ? "#eaecef" : "#848e9c",
    textDecoration: "none",
    fontWeight: active ? 600 : 400,
  });
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 13, color: "#848e9c" }}>
      <Link href="/" style={item(current === "discover")}>{t(locale, "discover")}</Link>
      <Link href="/hot" style={item(current === "hot")}>{t(locale, "hot")}</Link>
      <Link href="/track" style={item(current === "track")}>{t(locale, "track")}</Link>
      <a
        href="https://www.snowon.fun/create"
        target="_blank"
        rel="noreferrer"
        style={{ color: "#f0b90b", textDecoration: "none", fontWeight: 600 }}
      >
        {t(locale, "launch")}
      </a>
      {current === "profile" && <span style={{ color: "#eaecef", fontWeight: 600 }}>{t(locale, "profile")}</span>}
      {current === "admin" && <span style={{ color: "#eaecef", fontWeight: 600 }}>{t(locale, "admin")}</span>}
    </nav>
  );
}
