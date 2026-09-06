"use client";

import { useEffect, useState } from "react";

export type Locale = "zh" | "en" | "ko";
export const LOCALE_KEY = "ui.locale";
export const LOCALE_EVENT = "ui-locale";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "zh", label: "中" },
  { id: "en", label: "EN" },
  { id: "ko", label: "한" },
];

export function readLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (v === "en" || v === "ko" || v === "zh") return v;
  } catch { /* ignore */ }
  return "zh";
}

export function useLocale(): [Locale, (l: Locale) => void] {
  const [locale, setLocale] = useState<Locale>("zh");
  useEffect(() => {
    setLocale(readLocale());
    const on = () => setLocale(readLocale());
    window.addEventListener(LOCALE_EVENT, on);
    return () => window.removeEventListener(LOCALE_EVENT, on);
  }, []);
  function set(next: Locale) {
    localStorage.setItem(LOCALE_KEY, next);
    setLocale(next);
    window.dispatchEvent(new Event(LOCALE_EVENT));
  }
  return [locale, set];
}

const dict: Record<Locale, Record<string, string>> = {
  zh: {
    discover: "发现",
    hot: "热门",
    track: "追踪",
    launch: "Launch Token",
    profile: "个人",
    admin: "管理",
    connected: "已连接",
    disconnected: "未连接",
    wallet: "钱包链接",
    movers: "🔥 异动代币",
    fresh: "✨ 新创建",
    almost: "⏳ 即将毕业",
    graduated: "🎓 毕业代币",
    chat: "💬 公共聊天室",
    mcap: "市值",
    vol: "量",
    graduatedTag: "已毕业",
    curve: "曲线阶段",
  },
  en: {
    discover: "Discover",
    hot: "Trending",
    track: "Track",
    launch: "Launch Token",
    profile: "Profile",
    admin: "Admin",
    connected: "Live",
    disconnected: "Offline",
    wallet: "Connect",
    movers: "🔥 Movers",
    fresh: "✨ New",
    almost: "⏳ Almost",
    graduated: "🎓 Graduated",
    chat: "💬 Chat",
    mcap: "MCap",
    vol: "Vol",
    graduatedTag: "Graduated",
    curve: "On curve",
  },
  ko: {
    discover: "발견",
    hot: "인기",
    track: "추적",
    launch: "Launch Token",
    profile: "프로필",
    admin: "관리",
    connected: "연결됨",
    disconnected: "오프라인",
    wallet: "지갑 연결",
    movers: "🔥 급등",
    fresh: "✨ 신규",
    almost: "⏳ 졸업 임박",
    graduated: "🎓 졸업",
    chat: "💬 채팅",
    mcap: "시총",
    vol: "거래량",
    graduatedTag: "졸업",
    curve: "커브",
  },
};

export function t(locale: Locale, key: string): string {
  return dict[locale]?.[key] ?? dict.zh[key] ?? key;
}
