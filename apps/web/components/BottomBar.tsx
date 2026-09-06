"use client";

import { apiUrl } from "@/lib/apiBase";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { TRACKER_EVENT } from "@/lib/favorites";
import {
  TRACK_LIMIT,
  shortAddr,
  useTrackedWallets,
  type TrackedWallet,
} from "@/lib/trackedWallets";
import { TRACK_SOUND_EVENT, isTrackSoundOn, playTrackBuyChime, setTrackSound, unlockTrackSound } from "@/lib/trackSound";
import { TokenLogo } from "./TokenLogo";
import { EmojiAvatar } from "./EmojiAvatar";
import { useT, useLocale, formatTimeAgo } from "@/lib/locale";

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

function WalletTrackerPopup({ onClose, presetAddress }: { onClose: () => void; presetAddress?: string | null }) {
  const tr = useT();
  const [locale] = useLocale();
  const tracked = useTrackedWallets();
  const wallets = tracked.list;
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  useEffect(() => {
    if (!presetAddress) return;
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
    if (!tracked.owner) {
      tracked.login();
      return;
    }
    const address = input.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return;
    if (wallets.length >= TRACK_LIMIT && !wallets.some((w) => w.address === address)) return;
    void tracked.add([{ address }]);
    setInput("");
    setSelected(address);
  }

  function remove(address: string) {
    void tracked.remove(address);
    if (selected === address) setSelected(null);
  }

  function patchWallet(address: string, patch: Partial<TrackedWallet>) {
    void tracked.patch(address, patch);
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
        👁 {tr("walletTrack")}
        <span style={{ marginLeft: 8, fontSize: 11, color: "#5e6673", fontWeight: 400 }}>
          {tr("trackSmart")}
        </span>
      </div>

      {/* 添加地址 */}
      <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid #1e2329" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={tr("inputWallet")}
          style={{
            flex: 1, minWidth: 0, padding: "7px 10px", fontSize: 12,
            background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
            color: "#fff", outline: "none", fontFamily: "monospace",
          }}
        />
        <button onClick={add} style={{ padding: "0 12px", border: 0, borderRadius: 6, background: "#f0b90b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
          {tr("plusTrack")}
        </button>
      </div>

      {/* 追踪列表 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", borderBottom: "1px solid #1e2329" }}>
        {wallets.length === 0 && (
          <span style={{ fontSize: 12, color: "#5e6673" }}>
            {tracked.owner ? tr("noTrackList") : tr("connectToTrack")}
          </span>
        )}
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
              <span style={{ width: 5, height: 5, borderRadius: 3, background: "#0ecb81" }} title={tr("watching")} />
            )}
            <EmojiAvatar seed={w.address} size={16} />
            {w.label}
            {w.note && <span style={{ color: "#5e6673", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.note}</span>}
            <b
              onClick={(e) => { e.stopPropagation(); remove(w.address); }}
              style={{ cursor: "pointer", color: "#5e6673", fontWeight: 400 }}
              title={tr("remove")}
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
            placeholder={tr("alias")}
            style={{
              width: 90, padding: "5px 8px", fontSize: 11,
              background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
              color: "#f0b90b", outline: "none",
            }}
          />
          <input
            value={selectedWallet.note ?? ""}
            onChange={(e) => patchWallet(selectedWallet.address, { note: e.target.value })}
            placeholder={tr("noteSmart")}
            style={{
              flex: 1, minWidth: 0, padding: "5px 8px", fontSize: 11,
              background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
              color: "#eaecef", outline: "none",
            }}
          />
          <button
            onClick={() => patchWallet(selectedWallet.address, { watching: selectedWallet.watching === false })}
            title={selectedWallet.watching === false ? tr("clickFollow") : tr("clickUnfollow")}
            style={{
              padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              border: `1px solid ${selectedWallet.watching === false ? "#2b3139" : "#0ecb81"}`,
              borderRadius: 6,
              background: selectedWallet.watching === false ? "transparent" : "rgba(14,203,129,0.12)",
              color: selectedWallet.watching === false ? "#5e6673" : "#0ecb81",
            }}
          >
            {selectedWallet.watching === false ? tr("unfollowed") : tr("following")}
          </button>
        </div>
      )}

      {/* 选中地址的动态 */}
      <div className="col-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 12px", minHeight: 120 }}>
        {!selected && <div style={{ fontSize: 12, color: "#5e6673", textAlign: "center", marginTop: 20 }}>{tr("pickAddr")}</div>}
        {selected && isFetching && !activity && <div style={{ fontSize: 12, color: "#5e6673", textAlign: "center", marginTop: 20 }}>{tr("loading")}</div>}
        {selected && activity && activity.length === 0 && (
          <div style={{ fontSize: 12, color: "#5e6673", textAlign: "center", marginTop: 20 }}>{tr("noTradesAddr")}</div>
        )}
        {activity?.map((row) => (
          <div key={row.txHash} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #161b22", fontSize: 12 }}>
            <TokenLogo src={row.logoUri} alt={row.tokenSymbol ?? "?"} size={22} />
            <span style={{ fontWeight: 600 }}>{row.tokenSymbol ?? shortAddr(row.tokenAddress)}</span>
            <span style={{ color: row.isBuy ? "#0ecb81" : "#f6465d", fontWeight: 700 }}>
              {row.isBuy ? tr("buy") : tr("sell")}
            </span>
            <span style={{ color: "#848e9c" }}>{(Number(row.ethAmount) / 1e18).toFixed(4)} ETH</span>
            <span style={{ marginLeft: "auto", color: "#5e6673", fontSize: 11 }}>{formatTimeAgo(row.blockTimestamp, locale)}</span>
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

function watchingOf(list: TrackedWallet[]): TrackedWallet[] {
  return list
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
  const tracked = useTrackedWallets();
  const [buys, setBuys] = useState<WalletTrade[]>([]);
  const [fresh, setFresh] = useState<WalletTrade[]>([]);
  const seen = useRef(new Set<string>());
  const primed = useRef(false);
  const watchKey = tracked.list.filter((w) => w.watching !== false).map((w) => w.address).join(",");

  useEffect(() => {
    primed.current = false;
    seen.current = new Set();
  }, [watchKey]);

  useEffect(() => {
    let stop = false;
    async function tick() {
      const list = watchingOf(tracked.list);
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
  }, [watchKey, tracked.list]);

  useEffect(() => {
    if (fresh.length === 0) return;
    playTrackBuyChime();
    const t = setTimeout(() => setFresh([]), 7000);
    return () => clearTimeout(t);
  }, [fresh]);

  return { buys, fresh, wallets: watchingOf(tracked.list) };
}

function TrackerAlerts({ toast, ethUsd, onClose }: { toast: BuyToast | null; ethUsd?: number; onClose: () => void }) {
  const tr = useT();
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
            <div style={{ fontSize: 12, color: "#848e9c" }}>{toast.label} {tr("bought")}</div>
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
          <span style={{ color: "#848e9c" }}>{tr("amount")}</span>
          <span style={{ fontWeight: 800, color: "#eaecef" }}>
            {toast.amountEth.toFixed(4)} ETH
            <span style={{ marginLeft: 6, color: "#5e6673", fontWeight: 500 }}>{fmtUsd(toast.amountEth, ethUsd)}</span>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
          <span style={{ color: "#848e9c" }}>{tr("buyMcap")}</span>
          <span style={{ fontWeight: 800, color: "#f0b90b" }}>{fmtUsd(toast.mcapEth, ethUsd)}</span>
        </div>
      </div>
    </div>
  );
}

function EthPopup({ eth, onClose }: { eth: EthPrice | undefined; onClose: () => void }) {
  const tr = useT();
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
      <div style={{ fontSize: 12, color: "#5e6673", fontWeight: 700 }}>{tr("ethTicker")}</div>
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
  const tr = useT();
  const [locale] = useLocale();
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
  const tracked = useTrackedWallets();
  const walletsCount = tracked.list.filter((w) => w.watching !== false).length;

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
          👁 {tr("walletTrack")}
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
          title={soundOn ? tr("soundOn") : tr("soundOff")}
          onClick={() => setTrackSound(!soundOn)}
          style={popBtn(soundOn)}
        >
          {soundOn ? "🔊" : "🔇"}
          <span className="desktop-only">{tr("sound")}</span>
        </button>

        <div className="track-buy-tape" title={tr("tapeTitle")}>
          {buys.length === 0 ? (
            <span style={{ color: "#3d4450", fontSize: 11, padding: "0 6px" }}>
              {tracked.owner ? (walletsCount > 0 ? tr("noBuys") : tr("tapeHint")) : tr("tapeConnect")}
            </span>
          ) : buys.map((trade) => {
            const key = tradeKey(trade);
            const ethAmt = Number(trade.ethAmount) / 1e18;
            const flash = flashIds.has(key);
            return (
              <Link
                key={key}
                href={`/token/${trade.tokenAddress}`}
                className={`track-buy-chip${flash ? " flash" : ""}`}
              >
                <TokenLogo src={trade.logoUri} alt={trade.tokenSymbol ?? "?"} size={18} />
                <span style={{ color: "#0ecb81", fontWeight: 800 }}>{tr("bought")}</span>
                <span style={{ fontWeight: 800 }}>${trade.tokenSymbol ?? shortAddr(trade.tokenAddress)}</span>
                <span style={{ color: "#848e9c", fontVariantNumeric: "tabular-nums" }}>
                  {Number.isFinite(ethAmt) ? `${ethAmt.toFixed(4)} ETH` : ""}
                </span>
                <span style={{ color: "#5e6673", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {trade.trader ? <EmojiAvatar seed={trade.trader} size={14} /> : null}
                  {walletLabel(wallets, trade.trader)}
                </span>
                <span style={{ color: "#3d4450" }}>{formatTimeAgo(trade.blockTimestamp, locale)}</span>
              </Link>
            );
          })}
        </div>
      </footer>
    </>
  );
}
