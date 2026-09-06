"use client";

import { apiUrl } from "@/lib/apiBase";
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { useT } from "@/lib/locale";

interface Position {
  tokenAddress: string;
  balanceWhole: string;
  costBasisEth: string;
  realizedPnlEth: string;
  valueEth: string | null;
}

const CARD_W = 720;
const CARD_H = 420;

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function drawCard(opts: {
  bg: HTMLImageElement | null;
  symbol: string;
  buyPrice: string;
  amount: string;
  pnl: string;
  pct: string;
  addr: string;
  positive: boolean;
  buyPriceLabel: string;
  investLabel: string;
  profitAmtLabel: string;
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
  } else {
    const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    g.addColorStop(0, "#0b1220");
    g.addColorStop(1, "#1a1030");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  ctx.fillStyle = "rgba(8,10,16,0.58)";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.fillStyle = "#f0b90b";
  ctx.font = "800 22px system-ui, sans-serif";
  ctx.fillText("SnowOn Terminal", 36, 48);

  ctx.fillStyle = "#eaecef";
  ctx.font = "800 42px system-ui, sans-serif";
  ctx.fillText(`$${opts.symbol}`, 36, 108);

  ctx.fillStyle = opts.positive ? "#0ecb81" : "#f6465d";
  ctx.font = "italic 800 56px system-ui, sans-serif";
  ctx.fillText(opts.pct, 36, 178);

  ctx.fillStyle = "#b7bcc5";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.fillText(`${opts.buyPriceLabel}  ${opts.buyPrice}`, 36, 240);
  ctx.fillText(`${opts.investLabel}  ${opts.amount}`, 36, 272);
  ctx.fillStyle = opts.positive ? "#0ecb81" : "#f6465d";
  ctx.fillText(`${opts.profitAmtLabel}  ${opts.pnl}`, 36, 304);

  ctx.fillStyle = "#f0b90b";
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.fillText(opts.slogan, 36, CARD_H - 48);

  ctx.fillStyle = "#848e9c";
  ctx.font = "500 16px ui-monospace, monospace";
  ctx.fillText(opts.addr, CARD_W - 36 - ctx.measureText(opts.addr).width, CARD_H - 48);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/png");
  });
}

/** 我的 PNL 卡:自定义背景图,卡片含买入价/金额/盈利/%/标语/截断地址 */
export function PnlShareCard({ tokenAddress, symbol }: { tokenAddress: string; symbol: string }) {
  const tr = useT();
  const { authenticated, user } = usePrivy();
  const address = user?.wallet?.address?.toLowerCase();
  const [open, setOpen] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: positions } = useQuery({
    queryKey: ["portfolio", address],
    enabled: !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/portfolio?address=${address}`));
      const body = await readJson<Position[]>(res);
      return Array.isArray(body) ? body : [];
    },
  });

  const pos = positions?.find((p) => p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
  const value = Number(pos?.valueEth ?? 0);
  const cost = Number(pos?.costBasisEth ?? 0);
  const bal = Number(pos?.balanceWhole ?? 0);
  const unrealized = value - cost;
  const realized = Number(pos?.realizedPnlEth ?? 0);
  const total = unrealized + realized;
  const pct = cost > 0 ? (unrealized / cost) * 100 : 0;
  const buyPrice = bal > 0 ? cost / bal : 0;
  const positive = total >= 0;
  const stats = {
    buyPrice: `${buyPrice.toPrecision(4)} ETH`,
    amount: `${cost.toFixed(4)} ETH`,
    pnl: `${positive ? "+" : ""}${total.toFixed(4)} ETH`,
    pct: `${positive ? "+" : ""}${pct.toFixed(1)}%`,
    addr: address ? shortAddr(address) : "",
    positive,
  };

  useEffect(() => () => { if (bgUrl) URL.revokeObjectURL(bgUrl); }, [bgUrl]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function renderBlob(): Promise<Blob> {
    const bg = bgUrl ? await loadImage(bgUrl) : null;
    return drawCard({
      bg,
      symbol,
      ...stats,
      buyPriceLabel: tr("buyPriceLabel"),
      investLabel: tr("investLabel"),
      profitAmtLabel: tr("profitAmtLabel"),
      slogan: tr("slogan"),
    });
  }

  useEffect(() => {
    if (!open || !pos) return;
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
      } catch { /* ignore */ }
      if (!cancelled) setBusy(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bgUrl, pos?.tokenAddress, stats.pnl, stats.pct, tr]);

  if (!authenticated || !address || !pos) return null;

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
          display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
          borderRadius: 8, fontSize: 12,
          border: `1px solid ${positive ? "#0ecb8144" : "#f6465d44"}`,
          background: positive ? "rgba(14,203,129,0.06)" : "rgba(246,70,93,0.06)",
        }}
      >
        <span style={{ color: "#848e9c" }}>{tr("myPnl")}</span>
        <span style={{ fontWeight: 800, color: positive ? "#0ecb81" : "#f6465d", fontVariantNumeric: "tabular-nums" }}>
          {stats.pnl} ({stats.pct})
        </span>
        <button
          onClick={() => setOpen(true)}
          style={{
            marginLeft: "auto", padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
            borderRadius: 6, border: "1px solid #2b3139", background: "transparent", color: "#848e9c",
          }}
        >
          {tr("shareCard")}
        </button>
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
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #1e2329", fontWeight: 700, fontSize: 13 }}>
              {tr("sharePnl")}
              <span style={{ marginLeft: 8, fontSize: 11, color: "#5e6673", fontWeight: 400 }}>{tr("customBg")}</span>
            </div>
            <div style={{ padding: 14 }}>
              {preview ? (
                <img src={preview} alt="PNL card" style={{ width: "100%", borderRadius: 8, display: "block" }} />
              ) : (
                <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#5e6673", fontSize: 12 }}>
                  {busy ? tr("generating") : tr("preview")}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBgUrl((prev) => {
                      if (prev) URL.revokeObjectURL(prev);
                      return URL.createObjectURL(file);
                    });
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  style={shareBtn}
                >
                  {tr("uploadBg")}
                </button>
                <button onClick={() => void download()} style={shareBtn}>{tr("downloadPng")}</button>
                <button onClick={() => void copyImage()} style={{ ...shareBtn, background: "#f0b90b", color: "#000", border: 0 }}>
                  {tr("copyCard")}
                </button>
                <button onClick={() => setOpen(false)} style={{ ...shareBtn, marginLeft: "auto" }}>{tr("close")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const shareBtn: React.CSSProperties = {
  padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  borderRadius: 6, border: "1px solid #2b3139", background: "transparent", color: "#eaecef",
};
