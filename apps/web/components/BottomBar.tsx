"use client";

import { apiUrl } from "@/lib/apiBase";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { TRACKER_EVENT } from "@/lib/favorites";
import { TokenLogo } from "./TokenLogo";

/* ── ETH 实时价格 ── */

interface EthPrice {
  price: number;
  change24hPct: number;
}

function useEthPrice() {
  return useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      const body = await readJson<EthPrice | { error?: string }>(res);
      if (!res.ok || !("price" in body) || !Number.isFinite(body.price)) throw new Error("price unavailable");
      return body;
    },
    refetchInterval: 15_000,
    retry: 1,
  });
}

/* ── 钱包追踪(本地存储,追踪列表跟着浏览器走) ── */

interface TrackedWallet {
  address: string;
  label: string;
  /** 备注(自由文本) */
  note?: string;
  /** 关注开关:关闭后仍保留在列表,但不计入角标、不参与提醒 */
  watching?: boolean;
}

interface WalletTrade {
  txHash: string;
  tokenAddress: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  logoUri: string | null;
  isBuy: boolean;
  ethAmount: string;
  priceEth: string;
  phase: string;
  blockTimestamp: string;
}

const LS_KEY = "trackedWallets";

function loadWallets(): TrackedWallet[] {
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as TrackedWallet[];
    return list.map((w) => ({ ...w, watching: w.watching ?? true }));
  } catch {
    return [];
  }
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

function WalletTrackerPopup({ onClose, presetAddress }: { onClose: () => void; presetAddress?: string | null }) {
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWallets(loadWallets());
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  // 搜索框识别到钱包地址时:预填并入列选中
  useEffect(() => {
    if (!presetAddress) return;
    setWallets(loadWallets());
    setSelected(presetAddress);
  }, [presetAddress]);

  const { data: activity, isFetching } = useQuery({
    queryKey: ["wallet-activity", selected],
    enabled: !!selected,
    refetchInterval: 10_000,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/wallet-activity?address=${selected}`));
      const body = await readJson<WalletTrade[] | { error?: string }>(res);
      if (!res.ok || !Array.isArray(body)) throw new Error("load failed");
      return body;
    },
  });

  function save(next: TrackedWallet[]) {
    setWallets(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  function add() {
    const address = input.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return;
    if (wallets.some((w) => w.address === address)) return;
    const next = [...wallets, { address, label: shortAddr(address) }];
    save(next);
    setInput("");
    setSelected(address);
  }

  function remove(address: string) {
    save(wallets.filter((w) => w.address !== address));
    if (selected === address) setSelected(null);
  }

  function patchWallet(address: string, patch: Partial<TrackedWallet>) {
    save(wallets.map((w) => (w.address === address ? { ...w, ...patch } : w)));
  }

  const selectedWallet = wallets.find((w) => w.address === selected) ?? null;

  return (
    <div
      ref={ref}
      style={{
        position: "fixed", left: 10, bottom: 46, zIndex: 50,
        width: 420, maxHeight: "70vh", display: "flex", flexDirection: "column",
        background: "#0d1117", border: "1px solid #2b3139", borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)", overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1e2329", fontWeight: 700, fontSize: 13 }}>
        👁 钱包追踪
        <span style={{ marginLeft: 8, fontSize: 11, color: "#5e6673", fontWeight: 400 }}>
          追踪聪明钱/可疑地址的实时成交
        </span>
      </div>

      {/* 添加地址 */}
      <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid #1e2329" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="输入钱包地址 0x…"
          style={{
            flex: 1, minWidth: 0, padding: "7px 10px", fontSize: 12,
            background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
            color: "#fff", outline: "none", fontFamily: "monospace",
          }}
        />
        <button onClick={add} style={{ padding: "0 12px", border: 0, borderRadius: 6, background: "#f0b90b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
          + 追踪
        </button>
      </div>

      {/* 追踪列表 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", borderBottom: "1px solid #1e2329" }}>
        {wallets.length === 0 && <span style={{ fontSize: 12, color: "#5e6673" }}>还没有追踪任何地址</span>}
        {wallets.map((w) => (
          <span
            key={w.address}
            onClick={() => setSelected(w.address === selected ? null : w.address)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
              fontSize: 11, fontFamily: "monospace", padding: "3px 8px", borderRadius: 12,
              border: `1px solid ${w.address === selected ? "#f0b90b" : "#2b3139"}`,
              background: w.address === selected ? "#1c1f26" : "transparent",
              color: w.address === selected ? "#f0b90b" : "#848e9c",
              opacity: w.watching === false ? 0.45 : 1,
            }}
            title={w.note || w.address}
          >
            {w.watching !== false && (
              <span style={{ width: 5, height: 5, borderRadius: 3, background: "#0ecb81" }} title="关注中" />
            )}
            {w.label}
            {w.note && <span style={{ color: "#5e6673", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.note}</span>}
            <b
              onClick={(e) => { e.stopPropagation(); remove(w.address); }}
              style={{ cursor: "pointer", color: "#5e6673", fontWeight: 400 }}
              title="移除"
            >
              ✕
            </b>
          </span>
        ))}
      </div>

      {/* 选中地址:别名 / 备注 / 关注开关 */}
      {selectedWallet && (
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid #1e2329", alignItems: "center" }}>
          <input
            value={selectedWallet.label}
            onChange={(e) => patchWallet(selectedWallet.address, { label: e.target.value })}
            placeholder="别名"
            style={{
              width: 90, padding: "5px 8px", fontSize: 11,
              background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
              color: "#f0b90b", outline: "none",
            }}
          />
          <input
            value={selectedWallet.note ?? ""}
            onChange={(e) => patchWallet(selectedWallet.address, { note: e.target.value })}
            placeholder="备注(如:聪明钱/项目方/庄家)"
            style={{
              flex: 1, minWidth: 0, padding: "5px 8px", fontSize: 11,
              background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
              color: "#eaecef", outline: "none",
            }}
          />
          <button
            onClick={() => patchWallet(selectedWallet.address, { watching: selectedWallet.watching === false })}
            title={selectedWallet.watching === false ? "点击关注" : "点击取消关注"}
            style={{
              padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              border: `1px solid ${selectedWallet.watching === false ? "#2b3139" : "#0ecb81"}`,
              borderRadius: 6,
              background: selectedWallet.watching === false ? "transparent" : "rgba(14,203,129,0.12)",
              color: selectedWallet.watching === false ? "#5e6673" : "#0ecb81",
            }}
          >
            {selectedWallet.watching === false ? "已取关" : "关注中"}
          </button>
        </div>
      )}

      {/* 选中地址的动态 */}
      <div className="col-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 12px", minHeight: 120 }}>
        {!selected && <div style={{ fontSize: 12, color: "#5e6673", textAlign: "center", marginTop: 20 }}>点选一个地址查看它的最近成交</div>}
        {selected && isFetching && !activity && <div style={{ fontSize: 12, color: "#5e6673", textAlign: "center", marginTop: 20 }}>加载中…</div>}
        {selected && activity && activity.length === 0 && (
          <div style={{ fontSize: 12, color: "#5e6673", textAlign: "center", marginTop: 20 }}>该地址暂无成交记录</div>
        )}
        {activity?.map((tr) => (
          <div key={tr.txHash} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #161b22", fontSize: 12 }}>
            <TokenLogo src={tr.logoUri} alt={tr.tokenSymbol ?? "?"} size={22} />
            <span style={{ fontWeight: 600 }}>{tr.tokenSymbol ?? shortAddr(tr.tokenAddress)}</span>
            <span style={{ color: tr.isBuy ? "#0ecb81" : "#f6465d", fontWeight: 700 }}>
              {tr.isBuy ? "买入" : "卖出"}
            </span>
            <span style={{ color: "#848e9c" }}>{(Number(tr.ethAmount) / 1e18).toFixed(4)} ETH</span>
            <span style={{ marginLeft: "auto", color: "#5e6673", fontSize: 11 }}>{timeAgo(tr.blockTimestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 底部栏 ── */

export function BottomBar() {
  // ?tracker=1 可直接带着打开的钱包追踪弹窗进入(分享链接/调试)
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [presetAddress, setPresetAddress] = useState<string | null>(null);

  // 初始恒为 false 保证 SSR/水合一致,mount 后再读 URL 参数
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("tracker")) setTrackerOpen(true);
  }, []);

  // 搜索框识别到钱包地址 → 打开追踪面板并选中
  useEffect(() => {
    const onTrack = (e: Event) => {
      setPresetAddress((e as CustomEvent<string>).detail);
      setTrackerOpen(true);
    };
    window.addEventListener(TRACKER_EVENT, onTrack);
    return () => window.removeEventListener(TRACKER_EVENT, onTrack);
  }, []);
  const { data: eth } = useEthPrice();
  const [walletsCount, setWalletsCount] = useState(0);

  useEffect(() => {
    const sync = () => setWalletsCount(loadWallets().filter((w) => w.watching !== false).length);
    sync();
    const timer = setInterval(sync, 3000);
    return () => clearInterval(timer);
  }, []);

  const ethUp = (eth?.change24hPct ?? 0) >= 0;

  return (
    <>
      {trackerOpen && <WalletTrackerPopup onClose={() => setTrackerOpen(false)} presetAddress={presetAddress} />}
      <footer
        style={{
          flexShrink: 0, height: 36, display: "flex", alignItems: "center", gap: 16,
          padding: "0 12px", border: "1px solid #1e2329", borderRadius: 8,
          background: "#0d1117", fontSize: 12,
        }}
      >
        {/* 钱包追踪弹窗入口 */}
        <button
          onClick={() => setTrackerOpen((v) => !v)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: trackerOpen ? "#1c1f26" : "transparent",
            border: `1px solid ${trackerOpen ? "#f0b90b" : "#2b3139"}`,
            borderRadius: 6, padding: "4px 10px", cursor: "pointer",
            color: trackerOpen ? "#f0b90b" : "#848e9c", fontSize: 12, fontWeight: 600,
          }}
        >
          👁 钱包追踪
          {walletsCount > 0 && (
            <span style={{ background: "#f0b90b", color: "#000", borderRadius: 8, padding: "0 6px", fontSize: 10, fontWeight: 800 }}>
              {walletsCount}
            </span>
          )}
        </button>

        {/* ETH 实时价格 */}
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ color: "#5e6673" }}>ETH</span>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#eaecef", fontVariantNumeric: "tabular-nums" }}>
            {eth && Number.isFinite(eth.price)
              ? `$${eth.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : "…"}
          </span>
          {eth && Number.isFinite(eth.change24hPct) && (
            <span style={{ fontWeight: 700, color: ethUp ? "#0ecb81" : "#f6465d", fontVariantNumeric: "tabular-nums" }}>
              {ethUp ? "▲" : "▼"} {Math.abs(eth.change24hPct).toFixed(2)}%
            </span>
          )}
        </span>

        <span className="desktop-only" style={{ marginLeft: "auto", color: "#3d4450", fontSize: 11 }}>
          SnowOn Terminal · Robinhood Chain (4663)
        </span>
      </footer>
    </>
  );
}
