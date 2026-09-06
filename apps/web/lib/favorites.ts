"use client";

/** 收藏代币:localStorage + 自定义事件同步(卡片星标 ↔ 顶部收藏栏) */

const LS_KEY = "favoriteTokens";
export const FAVORITES_EVENT = "favorites-changed";

export function getFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function isFavorite(address: string): boolean {
  return getFavorites().includes(address.toLowerCase());
}

export function toggleFavorite(address: string): string[] {
  const addr = address.toLowerCase();
  const cur = getFavorites();
  const next = cur.includes(addr) ? cur.filter((a) => a !== addr) : [...cur, addr];
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(FAVORITES_EVENT));
  return next;
}

/* 钱包追踪的跨组件联动:搜索框识别到钱包地址 → 入列并打开追踪面板 */
export const TRACKER_EVENT = "open-wallet-tracker";

export function openWalletTracker(address: string) {
  const addr = address.toLowerCase();
  window.dispatchEvent(new CustomEvent(TRACKER_EVENT, { detail: addr }));
}
