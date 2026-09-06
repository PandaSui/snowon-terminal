"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { TRACKER_EVENT } from "@/lib/favorites";
import {
  TRACKED_CHANGED_EVENT,
  TRACK_LIMIT,
  addTrackedWallets,
  loadTrackedWallets,
  patchTrackedWallet,
  removeTrackedWallet,
  shortAddr,
  type TrackedWallet,
} from "@/lib/trackedWallets";
import { TRACK_SOUND_EVENT, isTrackSoundOn, playTrackBuyChime, setTrackSound, unlockTrackSound } from "@/lib/trackSound";
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

interface WalletTrade {
  trader?: string;
  txHash: string;
  logIndex?: number;
  tokenAddress: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  logoUri: string | null;
  isBuy: boolean;
  ethAmount: string;
  priceEth: string;
  mcapEth?: string | null;
  phase: string;
  blockTimestamp: string;
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
    const sync = () => setWallets(loadTrackedWallets());
    sync();
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener(TRACKED_CHANGED_EVENT, sync);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener(TRACKED_CHANGED_EVENT, sync);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose]);

  // 搜索框识别到钱包地址时:预填并入列选中
  useEffect(() => {
    if (!presetAddress) return;
    setWallets(loadTrackedWallets());
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

  function add() {
    const address = input.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return;
    if (wallets.length >= TRACK_LIMIT && !wallets.some((w) => w.address === address)) return;
    addTrackedWallets([{ address }]);
    setWallets(loadTrackedWallets());
    setInput("");
    setSelected(address);
  }

  function remove(address: string) {
    removeTrackedWallet(address);
    setWallets(loadTrackedWallets());
    if (selected === address) setSelected(null);
  }

  function patchWallet(address: string, patch: Partial<TrackedWallet>) {
    patchTrackedWallet(address, patch);
    setWallets(loadTrackedWallets());
  }

  const selectedWallet = wallets.find((w) => w.address === selected) ?? null;

  return (
    <div
      ref={ref}
      style={{
        position: "fixed", left: 10, bottom: 52, zIndex: 50,
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

interface BuyToast {
  id: string;
  label: string;
  token: string;
  tokenAddress: string;
  logoUri: string | null;
  amountEth: number;
  mcapEth: number;
}

function tradeKey(t: WalletTrade) {
  return `${t.txHash}:${t.logIndex ?? 0}`;
}

function watchingWallets(): TrackedWallet[] {
  return loadTrackedWallets()
    .filter((w) => w.watching !== false)
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    .slice(0, 80);
}

function walletLabel(wallets: TrackedWallet[], trader?: string) {
  const addr = (trader ?? "").toLowerCase();
  const w = wallets.find((x) => x.address === addr);
  return w?.note || w?.label || (addr ? shortAddr(addr) : "—");
}

function fmtUsd(eth: number, price?: number) {
  if (!price || !Number.isFinite(eth)) return "-";
  const v = eth * price;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function useTrackedBuyFeed() {
  const [buys, setBuys] = useState<WalletTrade[]>([]);
  const [fresh, setFresh] = useState<WalletTrade[]>([]);
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const seen = useRef(new Set<string>());
  const primed = useRef(false);

  useEffect(() => {
    const reset = () => {
      primed.current = false;
      seen.current = new Set();
    };
    window.addEventListener(TRACKED_CHANGED_EVENT, reset);
    return () => window.removeEventListener(TRACKED_CHANGED_EVENT, reset);
  }, []);

  useEffect(() => {
    let stop = false;
    async function tick() {
      const list = watchingWallets();
      setWallets(list);
      if (list.length === 0) {
        setBuys([]);
        return;
      }
      try {
        const q = list.map((w) => w.address).join(",");
        const res = await fetch(apiUrl(`/api/wallet-activity?addresses=${q}&buys=1`));
        const body = await readJson<WalletTrade[] | { error?: string }>(res);
        if (!Array.isArray(body) || stop) return;
        const rows = body.filter((t) => t.isBuy);
        if (!primed.current) {
          for (const t of rows) seen.current.add(tradeKey(t));
          primed.current = true;
          setBuys(rows);
          setFresh([]);
          return;
        }
        const news = rows.filter((t) => !seen.current.has(tradeKey(t)));
        for (const t of rows) seen.current.add(tradeKey(t));
        setBuys(rows);
        if (news.length > 0) setFresh(news);
      } catch { /* ignore */ }
    }
    void tick();
    const id = setInterval(() => void tick(), 8_000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (fresh.length === 0) return;
    playTrackBuyChime();
    const t = setTimeout(() => setFresh([]), 7000);
    return () => clearTimeout(t);
  }, [fresh]);

  return { buys, fresh, wallets };
}

function TrackerAlerts({ toast, ethUsd, onClose }: { toast: BuyToast | null; ethUsd?: number; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div
      className="tracker-toast"
      style={{
        position: "fixed", inset: 0, zIndex: 80, display: "flex",
        alignItems: "center", justifyContent: "center", pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto", minWidth: 280, maxWidth: 380,
          padding: "14px 16px", borderRadius: 12,
          background: "#12161e", border: "1px solid #0ecb81",
          boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <TokenLogo src={toast.logoUri} alt={toast.token} size={28} />
          <div>
            <div style={{ fontSize: 12, color: "#848e9c" }}>{toast.label} 买入</div>
            <Link href={`/token/${toast.tokenAddress}`} style={{ fontSize: 16, fontWeight: 800, color: "#0ecb81", textDecoration: "none" }}>
              ${toast.token}
            </Link>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: 0, color: "#5e6673", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#848e9c" }}>额度</span>
          <span style={{ fontWeight: 800, color: "#eaecef" }}>
            {toast.amountEth.toFixed(4)} ETH
            <span style={{ marginLeft: 6, color: "#5e6673", fontWeight: 500 }}>{fmtUsd(toast.amountEth, ethUsd)}</span>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
          <span style={{ color: "#848e9c" }}>买入市值</span>
          <span style={{ fontWeight: 800, color: "#f0b90b" }}>{fmtUsd(toast.mcapEth, ethUsd)}</span>
        </div>
      </div>
    </div>
  );
}

function EthPopup({ eth, onClose }: { eth: EthPrice | undefined; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ethUp = (eth?.change24hPct ?? 0) >= 0;
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div
      ref={ref}
      style={{
        position: "fixed", left: 140, bottom: 52, zIndex: 50, width: 240,
        background: "#0d1117", border: "1px solid #2b3139", borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)", padding: 14,
      }}
    >
      <div style={{ fontSize: 12, color: "#5e6673", fontWeight: 700 }}>ETH 行情</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
        {eth && Number.isFinite(eth.price)
          ? `$${eth.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
          : "…"}
      </div>
      {eth && Number.isFinite(eth.change24hPct) && (
        <div style={{ marginTop: 4, fontWeight: 700, color: ethUp ? "#0ecb81" : "#f6465d" }}>
          {ethUp ? "▲" : "▼"} {Math.abs(eth.change24hPct).toFixed(2)}% 24h
        </div>
      )}
    </div>
  );
}

/* ── 底部栏:全站固定,功能均为收放弹窗 ── */

export function BottomBar() {
  // ?tracker=1 可直接带着打开的钱包追踪弹窗进入(分享链接/调试)
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [presetAddress, setPresetAddress] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [dismissedToast, setDismissedToast] = useState<string | null>(null);
  const { buys, fresh, wallets } = useTrackedBuyFeed();
  const flashIds = new Set(fresh.map(tradeKey));

  // 初始恒为 false 保证 SSR/水合一致,mount 后再读 URL 参数
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("tracker")) setTrackerOpen(true);
    setSoundOn(isTrackSoundOn());
    const onSound = () => setSoundOn(isTrackSoundOn());
    window.addEventListener(TRACK_SOUND_EVENT, onSound);
    const unlock = () => unlockTrackSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      window.removeEventListener(TRACK_SOUND_EVENT, onSound);
      window.removeEventListener("pointerdown", unlock);
    };
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
    const sync = () => setWalletsCount(loadTrackedWallets().filter((w) => w.watching !== false).length);
    sync();
    window.addEventListener(TRACKED_CHANGED_EVENT, sync);
    const timer = setInterval(sync, 3000);
    return () => {
      window.removeEventListener(TRACKED_CHANGED_EVENT, sync);
      clearInterval(timer);
    };
  }, []);

  const [ethOpen, setEthOpen] = useState(false);
  const ethUp = (eth?.change24hPct ?? 0) >= 0;
  const hit = fresh[0];
  const toast: BuyToast | null = hit && tradeKey(hit) !== dismissedToast
    ? {
      id: tradeKey(hit),
      label: walletLabel(wallets, hit.trader),
      token: hit.tokenSymbol ?? shortAddr(hit.tokenAddress),
      tokenAddress: hit.tokenAddress,
      logoUri: hit.logoUri,
      amountEth: Number(hit.ethAmount) / 1e18,
      mcapEth: Number(hit.mcapEth ?? 0),
    }
    : null;

  const popBtn = (on: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    background: on ? "#1c1f26" : "transparent",
    border: `1px solid ${on ? "#f0b90b" : "#2b3139"}`,
    borderRadius: 6, padding: "4px 10px", cursor: "pointer",
    color: on ? "#f0b90b" : "#848e9c", fontSize: 12, fontWeight: 600,
    flexShrink: 0,
  });

  return (
    <>
      <TrackerAlerts toast={toast} ethUsd={eth?.price} onClose={() => setDismissedToast(toast?.id ?? null)} />
      {trackerOpen && <WalletTrackerPopup onClose={() => setTrackerOpen(false)} presetAddress={presetAddress} />}
      {ethOpen && <EthPopup eth={eth} onClose={() => setEthOpen(false)} />}
      <footer
        className="site-bottom-bar"
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 45,
          minHeight: 44, display: "flex", alignItems: "center", gap: 8,
          padding: "0 10px", borderTop: "1px solid #1e2329",
          background: "#0d1117", fontSize: 12,
        }}
      >
        <button
          onClick={() => { setTrackerOpen((v) => !v); setEthOpen(false); }}
          style={popBtn(trackerOpen)}
        >
          👁 钱包追踪
          {walletsCount > 0 && (
            <span style={{ background: "#f0b90b", color: "#000", borderRadius: 8, padding: "0 6px", fontSize: 10, fontWeight: 800 }}>
              {walletsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => { setEthOpen((v) => !v); setTrackerOpen(false); }}
          style={popBtn(ethOpen)}
        >
          ETH
          <span style={{ fontWeight: 800, color: "#eaecef", fontVariantNumeric: "tabular-nums" }}>
            {eth && Number.isFinite(eth.price)
              ? `$${eth.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
              : "…"}
          </span>
          {eth && Number.isFinite(eth.change24hPct) && (
            <span style={{ fontWeight: 700, color: ethUp ? "#0ecb81" : "#f6465d", fontVariantNumeric: "tabular-nums" }}>
              {ethUp ? "▲" : "▼"}{Math.abs(eth.change24hPct).toFixed(1)}%
            </span>
          )}
        </button>

        <button
          type="button"
          title={soundOn ? "关闭买入提示音" : "开启买入提示音"}
          onClick={() => setTrackSound(!soundOn)}
          style={popBtn(soundOn)}
        >
          {soundOn ? "🔊" : "🔇"}
          <span className="desktop-only">提示音</span>
        </button>

        <div className="track-buy-tape" title="追踪地址买入的代币">
          {buys.length === 0 ? (
            <span style={{ color: "#3d4450", fontSize: 11, padding: "0 6px" }}>
              {walletsCount > 0 ? "追踪地址暂无买入" : "追踪地址买入的代币会显示在这里"}
            </span>
          ) : buys.map((t) => {
            const key = tradeKey(t);
            const ethAmt = Number(t.ethAmount) / 1e18;
            const flash = flashIds.has(key);
            return (
              <Link
                key={key}
                href={`/token/${t.tokenAddress}`}
                className={`track-buy-chip${flash ? " flash" : ""}`}
              >
                <TokenLogo src={t.logoUri} alt={t.tokenSymbol ?? "?"} size={18} />
                <span style={{ color: "#0ecb81", fontWeight: 800 }}>买入</span>
                <span style={{ fontWeight: 800 }}>${t.tokenSymbol ?? shortAddr(t.tokenAddress)}</span>
                <span style={{ color: "#848e9c", fontVariantNumeric: "tabular-nums" }}>
                  {Number.isFinite(ethAmt) ? `${ethAmt.toFixed(4)} ETH` : ""}
                </span>
                <span style={{ color: "#5e6673" }}>{walletLabel(wallets, t.trader)}</span>
                <span style={{ color: "#3d4450" }}>{timeAgo(t.blockTimestamp)}</span>
              </Link>
            );
          })}
        </div>
      </footer>
    </>
  );
}
