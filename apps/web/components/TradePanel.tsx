"use client";

import { apiUrl } from "@/lib/apiBase";
import { readJson } from "@/lib/http";
import { useT } from "@/lib/locale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { parseEther, parseUnits, formatEther, type Address } from "viem";

const GAS_PRESETS = [
  { key: "standard", label: "gasStd", mult: 1 },
  { key: "fast", label: "gasFast", mult: 1.2 },
  { key: "turbo", label: "gasTurbo", mult: 1.5 },
] as const;

const DEFAULT_SELL_PCTS = [10, 25, 50, 100];
const DEFAULT_BUY_ETH = [0.01, 0.05, 0.1, 0.5];
const FILL_PCTS = [10, 25, 50, 100];

type Side = "buy" | "sell";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "");
    return Array.isArray(v) && v.length ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function trimAmt(v: bigint, dp = 6): string {
  const s = formatEther(v);
  const [a, b = ""] = s.split(".");
  const frac = b.slice(0, dp).replace(/0+$/, "");
  return frac ? `${a}.${frac}` : a;
}

function fmtTokens(wei: bigint): string {
  const n = Number(formatEther(wei));
  if (!Number.isFinite(n)) return formatEther(wei);
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

/**
 * 买卖面板:百分比填入、买入预估代币数、一键快捷买 ETH / 卖仓位%。
 */
export function TradePanel({
  chainId,
  token,
  antiBundle,
  graduated,
}: {
  chainId: number;
  token: Address;
  antiBundle: boolean;
  graduated: boolean;
}) {
  const tr = useT();
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const wallet = useMemo(() => {
    const list = wallets ?? [];
    const addr = user?.wallet?.address?.toLowerCase();
    if (addr) {
      const hit = list.find((w) => w.address.toLowerCase() === addr);
      if (hit) return hit;
    }
    return list[0];
  }, [wallets, user?.wallet?.address]);
  const tradeReady = ready && walletsReady;
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(500);
  const [gasKey, setGasKey] = useState<string>("standard");
  const [showSettings, setShowSettings] = useState(false);
  const [customSlippage, setCustomSlippage] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [ethBal, setEthBal] = useState(0n);
  const [tokenBal, setTokenBal] = useState(0n);
  const [quoteOut, setQuoteOut] = useState<bigint | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [sellPcts, setSellPcts] = useState<number[]>(DEFAULT_SELL_PCTS);
  const [buyEths, setBuyEths] = useState<number[]>(DEFAULT_BUY_ETH);
  const [editQuick, setEditQuick] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const s = Number(localStorage.getItem("trade.slippageBps"));
    if (Number.isFinite(s) && s > 0) setSlippageBps(s);
    const g = localStorage.getItem("trade.gasKey");
    if (g) setGasKey(g);
    setSellPcts(loadJson("trade.quickSellPcts", DEFAULT_SELL_PCTS).filter((n) => n > 0 && n <= 100));
    setBuyEths(loadJson("trade.quickBuyEth", DEFAULT_BUY_ETH).filter((n) => n > 0));
  }, []);

  const refreshBals = useCallback(async () => {
    if (!wallet) return;
    try {
      const provider = await wallet.getEthereumProvider();
      const raw = (await provider.request({
        method: "eth_getBalance",
        params: [wallet.address, "latest"],
      })) as string;
      setEthBal(BigInt(raw));

      // 代币余额以链上 balanceOf 为准:DB positions 只累计 indexer 追踪到的成交,
      // 会漏掉转入/索引前买入,导致可卖持仓被低估
      try {
        const balHex = (await provider.request({
          method: "eth_call",
          params: [
            { to: token, data: `0x70a08231${wallet.address.slice(2).toLowerCase().padStart(64, "0")}` },
            "latest",
          ],
        })) as string;
        setTokenBal(BigInt(balHex));
        return;
      } catch {
        /* 链上读失败时退回 API */
      }
      const res = await fetch(apiUrl(`/api/portfolio?address=${wallet.address}`));
      const rows = (await res.json()) as Array<{ tokenAddress: string; balanceWhole: string }>;
      const row = Array.isArray(rows)
        ? rows.find((r) => r.tokenAddress?.toLowerCase() === token.toLowerCase())
        : null;
      setTokenBal(row?.balanceWhole ? parseUnits(row.balanceWhole.split(".")[0] ? row.balanceWhole : "0", 18) : 0n);
    } catch {
      /* 余额读失败不挡交易 */
    }
  }, [wallet, token]);

  useEffect(() => {
    if (!wallet) return;
    void refreshBals();
  }, [refreshBals, wallet]);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const amountIn = parseEther(amount || "0");
        if (amountIn <= 0n) {
          if (!cancelled) {
            setQuoteOut(null);
            setQuoteErr("");
          }
          return;
        }
        const r = await fetch(apiUrl(`/api/quote?token=${token}&side=${side}&amount=${amountIn}`));
        const q = (await r.json()) as { amountOut?: string; error?: string };
        if (cancelled) return;
        if (q.error || !q.amountOut) {
          setQuoteOut(null);
          setQuoteErr(q.error ?? tr("quoteFailed"));
          return;
        }
        setQuoteOut(BigInt(q.amountOut));
        setQuoteErr("");
      } catch {
        if (!cancelled) {
          setQuoteOut(null);
          setQuoteErr("");
        }
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [amount, side, token, tr]);

  function pickSlippage(bps: number) {
    setSlippageBps(bps);
    setCustomSlippage("");
    localStorage.setItem("trade.slippageBps", String(bps));
  }

  function applyCustomSlippage(v: string) {
    setCustomSlippage(v);
    const pct = Number(v);
    if (Number.isFinite(pct) && pct > 0 && pct <= 50) {
      const bps = Math.round(pct * 100);
      setSlippageBps(bps);
      localStorage.setItem("trade.slippageBps", String(bps));
    }
  }

  function pickGas(key: string) {
    setGasKey(key);
    localStorage.setItem("trade.gasKey", key);
  }

  function fillBuyPct(pct: number) {
    if (ethBal <= 0n) return;
    setSide("buy");
    setAmount(trimAmt((ethBal * BigInt(pct)) / 100n));
  }

  function fillSellPct(pct: number) {
    if (tokenBal <= 0n) {
      setStatus(tr("noSellPos"));
      return;
    }
    setSide("sell");
    setAmount(trimAmt((tokenBal * BigInt(pct)) / 100n));
  }

  async function execute(nextSide: Side, amountIn: bigint) {
    if (!tradeReady) {
      setStatus(tr("connecting"));
      return;
    }
    if (!wallet) {
      setStatus(tr("connectWallet"));
      login();
      return;
    }
    if (amountIn <= 0n) {
      setStatus(tr("amtZero"));
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSide(nextSide);
    setAmount(trimAmt(amountIn));
    setStatus(tr("quoting"));
    try {
      const quoteRes = await fetch(apiUrl(`/api/quote?token=${token}&side=${nextSide}&amount=${amountIn}`));
      const quote = await readJson<{ amountOut?: string; error?: string }>(quoteRes);
      if (!quoteRes.ok || quote.error || !quote.amountOut) throw new Error(quote.error ?? tr("quoteFailed"));
      const minOut = (BigInt(quote.amountOut) * BigInt(10_000 - slippageBps)) / 10_000n;

      setStatus(tr("buildingTx"));
      const txRes = await fetch(apiUrl("/api/build-tx"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          side: nextSide,
          amount: amountIn.toString(),
          minOut: minOut.toString(),
          recipient: wallet.address,
        }),
      });
      const txs = await readJson<Array<{ to: Address; data: `0x${string}`; value: string; chainId: number }> | { error?: string }>(txRes);
      if (!txRes.ok || !Array.isArray(txs)) throw new Error((txs as { error?: string }).error ?? "build failed");

      setStatus(tr("switchNet"));
      const walletChain = Number(String(wallet.chainId).split(":").pop());
      if (walletChain !== chainId) await wallet.switchChain(chainId);
      // switchChain 后必须重新取 provider,否则签名弹窗出不来或打到旧链
      const provider = await wallet.getEthereumProvider();
      for (const [i, tx] of txs.entries()) {
        setStatus(txs.length > 1 ? tr("signingN", { i: i + 1, n: txs.length }) : tr("signing"));
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: wallet.address,
            to: tx.to,
            data: tx.data,
            value: `0x${BigInt(tx.value).toString(16)}`,
          }],
        })) as string;
        setStatus(txs.length > 1 ? tr("waitingN", { i: i + 1, n: txs.length }) : tr("waiting"));
        await waitReceipt(provider, hash);
      }
      setStatus(tr("sent"));
      void refreshBals();
    } catch (e) {
      setStatus(`❌ ${(e as Error).message.slice(0, 160)}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submit() {
    try {
      void execute(side, parseEther(amount || "0"));
    } catch {
      setStatus(tr("amtBad"));
    }
  }

  function quickSell(pct: number) {
    if (tokenBal <= 0n) {
      setStatus(tr("noSellPos"));
      return;
    }
    const amt = (tokenBal * BigInt(Math.round(pct))) / 100n;
    void execute("sell", amt);
  }

  function quickBuy(eth: number) {
    try {
      void execute("buy", parseEther(String(eth)));
    } catch {
      setStatus(tr("ethBad"));
    }
  }

  function saveSellPcts(next: number[]) {
    const clean = next.filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
    setSellPcts(clean.length ? clean : DEFAULT_SELL_PCTS);
    localStorage.setItem("trade.quickSellPcts", JSON.stringify(clean.length ? clean : DEFAULT_SELL_PCTS));
  }

  function saveBuyEths(next: number[]) {
    const clean = next.filter((n) => Number.isFinite(n) && n > 0);
    setBuyEths(clean.length ? clean : DEFAULT_BUY_ETH);
    localStorage.setItem("trade.quickBuyEth", JSON.stringify(clean.length ? clean : DEFAULT_BUY_ETH));
  }

  const isPreset = [100, 500, 1000].includes(slippageBps) && !customSlippage;

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", boxSizing: "border-box",
        border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117",
      }}
    >
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              style={{
                flex: 1, padding: "10px 0", border: 0, borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13,
                background: side === s ? (s === "buy" ? "#0ecb81" : "#f6465d") : "#1e2329",
                color: side === s ? "#000" : "#eaecef",
              }}
            >
              {s === "buy" ? tr("buy") : tr("sell")}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5e6673", marginBottom: 6 }}>
          <span>{side === "buy" ? tr("payEth") : tr("sellToken")}</span>
          <span>
            {side === "buy"
              ? tr("balEth", { n: trimAmt(ethBal, 4) })
              : tr("posTok", { n: fmtTokens(tokenBal) })}
          </span>
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={side === "buy" ? tr("ethAmt") : tr("tokenAmt")}
          style={{
            width: "100%", boxSizing: "border-box", padding: 12, marginBottom: 8, fontSize: 14,
            background: "#161b22", border: "1px solid #2b3139", borderRadius: 8, color: "#fff", outline: "none",
          }}
        />

        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {FILL_PCTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => (side === "buy" ? fillBuyPct(p) : fillSellPct(p))}
              style={{
                flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 800, cursor: "pointer",
                border: "1px solid #2b3139", borderRadius: 6, background: "#1c2127", color: "#848e9c",
              }}
            >
              {p}%
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: "#848e9c", marginBottom: 10, minHeight: 18 }}>
          {quoteErr ? (
            <span style={{ color: "#f6465d" }}>{quoteErr}</span>
          ) : quoteOut != null ? (
            side === "buy" ? (
              <>{tr("approxTok")} <b style={{ color: "#0ecb81" }}>{fmtTokens(quoteOut)}</b> {tr("tokensUnit")}</>
            ) : (
              <>{tr("approxTok")} <b style={{ color: "#0ecb81" }}>{trimAmt(quoteOut, 5)} ETH</b></>
            )
          ) : (
            <span style={{ color: "#5e6673" }}>{side === "buy" ? tr("enterEth") : tr("enterAmt")}</span>
          )}
        </div>

        <div style={{ fontSize: 11, color: "#848e9c", marginBottom: 12, lineHeight: 1.6 }}>
          {graduated ? tr("afterGrad") : tr("onCurveBuy")}
          {" · "}
          <span title={tr("taxExcluded")}>
            {tr("feeLine")}
          </span>
          {antiBundle && !graduated && <span style={{ color: "#f0b90b" }}> · {tr("eoaOnly")}</span>}
        </div>

        {!authenticated || !wallet ? (
          <button
            type="button"
            onClick={login}
            disabled={authenticated && !tradeReady}
            style={{ width: "100%", padding: 13, border: 0, borderRadius: 8, background: "#f0b90b", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
          >
            {authenticated && !tradeReady ? tr("connecting") : tr("loginToTrade")}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            style={{
              width: "100%", padding: 13, border: 0, borderRadius: 8, fontSize: 14,
              background: side === "buy" ? "#0ecb81" : "#f6465d",
              color: "#000", fontWeight: 800, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? tr("processing") : side === "buy" ? tr("buy") : tr("sell")}
          </button>
        )}
        {status && <div style={{ marginTop: 8, fontSize: 12, color: "#f0b90b" }}>{status}</div>}
      </div>

      {/* 快捷买卖:点即成交 */}
      <div style={{ padding: "0 14px 12px", borderTop: "1px solid #1e2329" }}>
        <div style={{ display: "flex", alignItems: "center", margin: "10px 0 6px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#848e9c" }}>{tr("quickTrade")}</span>
          <button
            type="button"
            onClick={() => setEditQuick((v) => !v)}
            style={{
              marginLeft: "auto", background: "none", border: "1px solid #2b3139", borderRadius: 4,
              color: editQuick ? "#f0b90b" : "#5e6673", fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "2px 8px",
            }}
          >
            {editQuick ? tr("done") : tr("custom")}
          </button>
        </div>

        <div style={{ fontSize: 10, color: "#5e6673", marginBottom: 4 }}>{tr("oneTapBuy")}</div>
        {editQuick ? (
          <QuickEditor values={buyEths} suffix="ETH" onChange={saveBuyEths} />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {buyEths.map((eth) => (
              <button
                key={eth}
                type="button"
                disabled={busy}
                onClick={() => quickBuy(eth)}
                style={{
                  flex: "1 1 22%", minWidth: 56, padding: "8px 0", fontSize: 12, fontWeight: 800, cursor: busy ? "wait" : "pointer",
                  border: 0, borderRadius: 6, background: "#0ecb81", color: "#000",
                }}
              >
                {eth} ETH
              </button>
            ))}
          </div>
        )}

        <div style={{ fontSize: 10, color: "#5e6673", marginBottom: 4 }}>{tr("oneTapSell")}</div>
        {editQuick ? (
          <QuickEditor values={sellPcts} suffix="%" onChange={saveSellPcts} />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sellPcts.map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => quickSell(p)}
                style={{
                  flex: "1 1 22%", minWidth: 56, padding: "8px 0", fontSize: 12, fontWeight: 800, cursor: busy ? "wait" : "pointer",
                  border: 0, borderRadius: 6, background: "#f6465d", color: "#000",
                }}
              >
                {tr("sellPct", { n: p })}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid #1e2329" }}>
        <button
          onClick={() => setShowSettings((v) => !v)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
            background: "transparent", border: 0, cursor: "pointer", color: "#848e9c", fontSize: 12, fontWeight: 700,
          }}
        >
          {tr("settings")}
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 400 }}>
            {tr("slippage")} {(slippageBps / 100).toFixed(1)}% · {tr("gas")} {tr(GAS_PRESETS.find((g) => g.key === gasKey)?.label ?? "gasStd")}
          </span>
          <span style={{ transform: showSettings ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
        </button>

        {showSettings && (
          <div style={{ padding: "4px 14px 14px", borderTop: "1px solid #1e2329" }}>
            <div style={{ fontSize: 11, color: "#5e6673", margin: "10px 0 6px" }}>{tr("slipTol")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[100, 500, 1000].map((bps) => (
                <button
                  key={bps}
                  onClick={() => pickSlippage(bps)}
                  style={{
                    flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    borderRadius: 6, border: `1px solid ${isPreset && slippageBps === bps ? "#f0b90b" : "#2b3139"}`,
                    background: isPreset && slippageBps === bps ? "#1c1f26" : "transparent",
                    color: isPreset && slippageBps === bps ? "#f0b90b" : "#848e9c",
                  }}
                >
                  {bps / 100}%
                </button>
              ))}
              <input
                value={customSlippage}
                onChange={(e) => applyCustomSlippage(e.target.value)}
                placeholder={tr("customPct")}
                style={{
                  width: 70, padding: "6px 8px", fontSize: 12, textAlign: "center",
                  background: "#0b0e11", border: `1px solid ${customSlippage ? "#f0b90b" : "#2b3139"}`,
                  borderRadius: 6, color: "#fff", outline: "none",
                }}
              />
            </div>

            <div style={{ fontSize: 11, color: "#5e6673", margin: "12px 0 6px" }}>{tr("gasTier")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {GAS_PRESETS.map((g) => (
                <button
                  key={g.key}
                  onClick={() => pickGas(g.key)}
                  style={{
                    flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    borderRadius: 6, border: `1px solid ${gasKey === g.key ? "#f0b90b" : "#2b3139"}`,
                    background: gasKey === g.key ? "#1c1f26" : "transparent",
                    color: gasKey === g.key ? "#f0b90b" : "#848e9c",
                  }}
                >
                  {tr(g.label)}
                  <span style={{ display: "block", fontSize: 10, fontWeight: 400 }}>×{g.mult}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#3d4450", marginTop: 8 }}>
              {tr("gasNote")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickEditor({
  values,
  suffix,
  onChange,
}: {
  values: number[];
  suffix: string;
  onChange: (v: number[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {values.map((v, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 2, background: "#161b22", border: "1px solid #2b3139", borderRadius: 6, padding: "2px 4px" }}>
          <input
            value={String(v)}
            onChange={(e) => {
              const n = Number(e.target.value);
              const next = [...values];
              next[i] = n;
              onChange(next);
            }}
            style={{
              width: 52, padding: "4px 4px", fontSize: 12, background: "transparent", border: 0, color: "#fff", outline: "none",
            }}
          />
          <span style={{ fontSize: 10, color: "#5e6673" }}>{suffix}</span>
          <button
            type="button"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            style={{ background: "none", border: 0, color: "#f6465d", cursor: "pointer", fontWeight: 800 }}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, suffix === "%" ? 15 : 0.2])}
        style={{
          padding: "4px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer",
          border: "1px dashed #2b3139", borderRadius: 6, background: "transparent", color: "#848e9c",
        }}
      >
        +
      </button>
    </div>
  );
}

async function waitReceipt(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  hash: string,
) {
  for (let i = 0; i < 120; i++) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("transaction reverted");
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("timed out waiting for confirmation");
}

export function fmtEth(wei: bigint): string {
  return Number(formatEther(wei)).toFixed(6);
}
