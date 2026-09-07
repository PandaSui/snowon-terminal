"use client";

import { apiUrl } from "@/lib/apiBase";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { readJson } from "@/lib/http";
import { useT } from "@/lib/locale";
import { fmtAmount, fmtPnl, fmtPrice, useQuoteUnit } from "@/lib/quoteUnit";
import { QuoteUnitToggle } from "./QuoteUnitToggle";

interface Position {
  tokenAddress: string;
  balanceWhole: string;
  costBasisEth: string;
  realizedPnlEth: string;
  valueEth: string | null;
}

const CARD_W = 720;
const CARD_H = 420;
/** 自定义分享背景在 localStorage 的键(dataURL,持久保存) */
const BG_KEY = "snowon:share-bg";

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtTok(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // blob: 本地图不能设 crossOrigin,否则画布被污染/加载失败
    if (!src.startsWith("blob:") && !src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 上传图 → 压缩(最长边 1600px,JPEG 0.85)→ dataURL。压完才能放进 localStorage 长期保存。 */
async function fileToDataUrl(file: File): Promise<string> {
  const objUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objUrl);
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const cx = c.getContext("2d");
    if (!cx) throw new Error("canvas");
    cx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

async function drawCard(opts: {
  bg: HTMLImageElement | null;
  symbol: string;
  hold: string;
  buyPrice: string;
  amount: string;
  pnl: string;
  pct: string;
  addr: string;
  positive: boolean;
  buyPriceLabel: string;
  investLabel: string;
  profitAmtLabel: string;
  holdLabel: string;
  slogan: string;
}): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");

  if (opts.bg) {
    const scale = Math.max(CARD_W / opts.bg.width, CARD_H / opts.bg.height);
    const w = opts.bg.width * scale;
    const h = opts.bg.height * scale;
    ctx.drawImage(opts.bg, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
    const veil = ctx.createLinearGradient(0, 0, CARD_W * 0.72, CARD_H);
    veil.addColorStop(0, "rgba(8,10,16,0.22)");
    veil.addColorStop(0.55, "rgba(8,10,16,0.48)");
    veil.addColorStop(1, "rgba(8,10,16,0.78)");
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  } else {
    const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    g.addColorStop(0, "#0b1220");
    g.addColorStop(1, "#1a1030");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }

  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = "#f0b90b";
  ctx.font = "800 22px system-ui, sans-serif";
  ctx.fillText("SnowOn Terminal", 36, 48);

  // 右上角网址:snowon 品牌黄高亮 + .fun 白色
  ctx.font = "800 18px system-ui, sans-serif";
  const wA = ctx.measureText("snowon").width;
  const wB = ctx.measureText(".fun").width;
  ctx.fillStyle = "#f0b90b";
  ctx.fillText("snowon", CARD_W - 36 - wA - wB, 48);
  ctx.fillStyle = "#eaecef";
  ctx.fillText(".fun", CARD_W - 36 - wB, 48);

  ctx.fillStyle = "#eaecef";
  ctx.font = "800 42px system-ui, sans-serif";
  ctx.fillText(opts.symbol, 36, 108);

  ctx.fillStyle = opts.positive ? "#0ecb81" : "#f6465d";
  ctx.font = "italic 800 56px system-ui, sans-serif";
  ctx.fillText(opts.pct, 36, 178);

  ctx.fillStyle = "#eaecef";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.fillText(`${opts.holdLabel}  ${opts.hold}`, 36, 228);
  ctx.fillStyle = "#d0d3d8";
  ctx.fillText(`${opts.buyPriceLabel}  ${opts.buyPrice}`, 36, 260);
  ctx.fillText(`${opts.investLabel}  ${opts.amount}`, 36, 292);
  ctx.fillStyle = opts.positive ? "#0ecb81" : "#f6465d";
  ctx.fillText(`${opts.profitAmtLabel}  ${opts.pnl}`, 36, 324);

  ctx.fillStyle = "#f0b90b";
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.fillText(opts.slogan, 36, CARD_H - 48);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#c5c9d1";
  ctx.font = "500 16px ui-monospace, monospace";
  ctx.fillText(opts.addr, CARD_W - 36 - ctx.measureText(opts.addr).width, CARD_H - 48);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/png");
  });
}

const shareBtn: React.CSSProperties = {
  padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  borderRadius: 6, border: "1px solid #2b3139", background: "transparent", color: "#eaecef",
};

/** 我的 PNL 卡:链上余额 + 组合仓位检测,自定义背景图分享 */
export function PnlShareCard({ tokenAddress, symbol }: { tokenAddress: string; symbol: string }) {
  const tr = useT();
  const { authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const token = tokenAddress.toLowerCase();

  const walletAddrs = useMemo(() => {
    const out: string[] = [];
    for (const w of wallets ?? []) {
      const a = w.address?.toLowerCase();
      if (a && /^0x[0-9a-f]{40}$/.test(a) && !out.includes(a)) out.push(a);
    }
    const u = user?.wallet?.address?.toLowerCase();
    if (u && /^0x[0-9a-f]{40}$/.test(u) && !out.includes(u)) out.push(u);
    return out;
  }, [wallets, user?.wallet?.address]);

  const address = walletAddrs[0] ?? null;
  const [unit] = useQuoteUnit();
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price?: number }>(res);
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const ethUsd = eth?.price && eth.price > 0 ? eth.price : undefined;
  const [open, setOpen] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onchainWhole, setOnchainWhole] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: pack } = useQuery({
    queryKey: ["portfolio-share", walletAddrs.join(","), token],
    enabled: walletAddrs.length > 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      const lists = await Promise.all(
        walletAddrs.map(async (a) => {
          const res = await fetch(apiUrl(`/api/portfolio?address=${a}&includeClosed=1`));
          const body = await readJson<Position[]>(res);
          return { addr: a, rows: Array.isArray(body) ? body : [] };
        }),
      );
      for (const { addr, rows } of lists) {
        const hit = rows.find((p) => p.tokenAddress?.toLowerCase() === token);
        if (hit) return { addr, pos: hit };
      }
      return { addr: walletAddrs[0], pos: null as Position | null };
    },
  });

  const pos = pack?.pos ?? null;
  const cardAddr = pack?.addr ?? address ?? "";

  useEffect(() => {
    const list = wallets ?? [];
    if (list.length === 0 || !token) return;
    let stop = false;
    void (async () => {
      for (const w of list) {
        try {
          const provider = await w.getEthereumProvider();
          const balHex = (await provider.request({
            method: "eth_call",
            params: [
              { to: token, data: `0x70a08231${w.address.slice(2).toLowerCase().padStart(64, "0")}` },
              "latest",
            ],
          })) as string;
          const wei = BigInt(balHex || "0x0");
          if (stop) return;
          if (wei > 0n) {
            setOnchainWhole(Number(formatEther(wei)));
            return;
          }
        } catch {
          /* next wallet */
        }
      }
      if (!stop) setOnchainWhole(0);
    })();
    return () => { stop = true; };
  }, [wallets, token]);

  const dbBal = Number(pos?.balanceWhole ?? 0);
  const holdN = Math.max(dbBal, onchainWhole);
  const hasPos = holdN > 0 || Number(pos?.realizedPnlEth ?? 0) !== 0 || Number(pos?.costBasisEth ?? 0) > 0;
  const value = Number(pos?.valueEth ?? 0);
  const cost = Number(pos?.costBasisEth ?? 0);
  const unrealized = value - cost;
  const realized = Number(pos?.realizedPnlEth ?? 0);
  const total = pos ? unrealized + realized : 0;
  const pct = cost > 0 ? (unrealized / cost) * 100 : 0;
  const buyPrice = holdN > 0 && cost > 0 ? cost / holdN : 0;
  const positive = total >= 0;
  const stats = {
    hold: fmtTok(holdN),
    buyPrice: buyPrice > 0 ? fmtPrice(buyPrice, unit, ethUsd) : "—",
    amount: cost > 0 ? fmtAmount(cost, unit, ethUsd) : "—",
    pnl: pos ? fmtPnl(total, unit, ethUsd) : "—",
    pct: cost > 0 ? `${positive ? "+" : ""}${pct.toFixed(1)}%` : (holdN > 0 ? fmtTok(holdN) : "—"),
    addr: cardAddr ? shortAddr(cardAddr) : "",
    positive,
  };

  useEffect(() => () => {
    // dataURL 不用释放;blob: 才需要
    setBgUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return prev;
    });
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // 挂载时读回上次上传的背景(持久化)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BG_KEY);
      if (saved) setBgUrl(saved);
    } catch {
      /* localStorage 不可用 */
    }
  }, []);

  const setBgFile = useCallback((file: File | undefined | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    void (async () => {
      const dataUrl = await fileToDataUrl(file).catch(() => null);
      if (!dataUrl) return;
      try {
        localStorage.setItem(BG_KEY, dataUrl);
      } catch {
        // 超配额也在本次会话内生效,只是不持久化
      }
      setBgUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return dataUrl;
      });
    })();
  }, []);

  async function renderBlob(): Promise<Blob> {
    const bg = bgUrl ? await loadImage(bgUrl) : null;
    return drawCard({
      bg,
      symbol,
      hold: stats.hold,
      buyPrice: stats.buyPrice,
      amount: stats.amount,
      pnl: stats.pnl,
      pct: stats.pct,
      addr: stats.addr,
      positive: stats.positive,
      buyPriceLabel: tr("buyPriceLabel"),
      investLabel: tr("investLabel"),
      profitAmtLabel: tr("profitAmtLabel"),
      holdLabel: tr("holdLabel"),
      slogan: tr("slogan"),
    });
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const blob = await renderBlob();
        if (cancelled) return;
        setPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch {
        /* ignore */
      }
      if (!cancelled) setBusy(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bgUrl, stats.pnl, stats.pct, stats.hold, stats.buyPrice, stats.amount, unit, ethUsd, tr, symbol]);

  async function download() {
    const blob = await renderBlob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `snowon-${symbol}-pnl.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyImage() {
    const blob = await renderBlob();
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
      await navigator.clipboard.writeText(
        tr("shareCaption", {
          symbol,
          buy: stats.buyPrice,
          pnl: stats.pnl,
          pct: stats.pct,
          slogan: tr("slogan"),
        }),
      );
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 6, padding: "8px 12px",
          borderRadius: 8, fontSize: 12, width: "100%", boxSizing: "border-box", minWidth: 0,
          overflow: "hidden",
          border: `1px solid ${hasPos ? (positive ? "#0ecb8144" : "#f6465d44") : "#2b3139"}`,
          background: hasPos ? (positive ? "rgba(14,203,129,0.06)" : "rgba(246,70,93,0.06)") : "#0d1117",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ color: "#848e9c", whiteSpace: "nowrap", flexShrink: 0 }}>{tr("myPnl")}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <QuoteUnitToggle size={13} />
            <button
              type="button"
              onClick={() => (authenticated ? setOpen(true) : login())}
              style={{
                padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                borderRadius: 6, border: 0, background: "#f0b90b", color: "#000", whiteSpace: "nowrap",
              }}
            >
              {tr("shareCard")}
            </button>
          </span>
        </div>
        {!authenticated ? (
          <span style={{ color: "#5e6673" }}>{tr("shareLogin")}</span>
        ) : hasPos ? (
          <div
            style={{
              display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, flexWrap: "wrap",
              fontWeight: 800, color: positive ? "#0ecb81" : "#f6465d", fontVariantNumeric: "tabular-nums",
            }}
          >
            {pos ? (
              <>
                <span style={{ whiteSpace: "nowrap" }}>{stats.pnl}</span>
                <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>({stats.pct})</span>
                <span style={{ color: "#848e9c", fontWeight: 600, whiteSpace: "nowrap" }}>{stats.hold}</span>
              </>
            ) : (
              <span style={{ whiteSpace: "nowrap" }}>{tr("holdLabel")} {stats.hold}</span>
            )}
          </div>
        ) : (
          <span style={{ color: "#5e6673" }}>{tr("shareNoPos")}</span>
        )}
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.62)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 520, maxWidth: "100%", background: "#0d1117", border: "1px solid #2b3139",
              borderRadius: 12, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            }}
          >
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #1e2329", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{tr("sharePnl")}</span>
              <span style={{ fontSize: 11, color: "#5e6673", fontWeight: 400 }}>{tr("customBg")}</span>
              <span style={{ marginLeft: "auto" }}><QuoteUnitToggle size={14} /></span>
            </div>
            <div style={{ padding: 14 }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  setBgFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  setBgFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => !preview && fileRef.current?.click()}
                style={{
                  borderRadius: 8, overflow: "hidden", cursor: "pointer",
                  border: `1px dashed ${dragOver ? "#f0b90b" : "#2b3139"}`,
                  background: dragOver ? "rgba(240,185,11,0.08)" : "#10141b",
                }}
              >
                {preview ? (
                  <img src={preview} alt="PNL card" style={{ width: "100%", display: "block" }} />
                ) : (
                  <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#5e6673", fontSize: 12, padding: 16, textAlign: "center" }}>
                    {busy ? tr("generating") : tr("dropBg")}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={() => fileRef.current?.click()} style={shareBtn}>
                  {bgUrl ? tr("changeBg") : tr("uploadBg")}
                </button>
                <button type="button" onClick={() => void download()} style={shareBtn}>{tr("downloadPng")}</button>
                <button type="button" onClick={() => void copyImage()} style={{ ...shareBtn, background: "#f0b90b", color: "#000", border: 0 }}>
                  {tr("copyCard")}
                </button>
                <button type="button" onClick={() => setOpen(false)} style={{ ...shareBtn, marginLeft: "auto" }}>{tr("close")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
