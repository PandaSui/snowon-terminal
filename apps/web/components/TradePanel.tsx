"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { parseEther, parseUnits, formatEther, type Address } from "viem";

const GAS_PRESETS = [
  { key: "standard", label: "标准", mult: 1 },
  { key: "fast", label: "快速", mult: 1.2 },
  { key: "turbo", label: "极速", mult: 1.5 },
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
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];
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
      const res = await fetch(`/api/portfolio?address=${wallet.address}`);
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
    void refreshBals();
  }, [refreshBals]);

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
        const r = await fetch(`/api/quote?token=${token}&side=${side}&amount=${amountIn}`);
        const q = (await r.json()) as { amountOut?: string; error?: string };
        if (cancelled) return;
        if (q.error || !q.amountOut) {
          setQuoteOut(null);
          setQuoteErr(q.error ?? "报价失败");
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
  }, [amount, side, token]);

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
    if (tokenBal <= 0n) return;
    setSide("sell");
    setAmount(trimAmt((tokenBal * BigInt(pct)) / 100n));
  }

  async function execute(nextSide: Side, amountIn: bigint) {
    if (!wallet) {
      login();
      return;
    }
    if (amountIn <= 0n) {
      setStatus("❌ 数量为 0");
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSide(nextSide);
    setAmount(trimAmt(amountIn));
    setStatus("报价中…");
    try {
      const quoteRes = await fetch(`/api/quote?token=${token}&side=${nextSide}&amount=${amountIn}`);
      const quote = (await quoteRes.json()) as { amountOut?: string; error?: string };
      if (quote.error || !quote.amountOut) throw new Error(quote.error ?? "quote failed");
      const minOut = (BigInt(quote.amountOut) * BigInt(10_000 - slippageBps)) / 10_000n;

      setStatus("构造交易…");
      const txRes = await fetch("/api/build-tx", {
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
      const txs: Array<{ to: Address; data: `0x${string}`; value: string; chainId: number }> = await txRes.json();
      if (!Array.isArray(txs)) throw new Error((txs as { error?: string }).error ?? "build failed");

      const provider = await wallet.getEthereumProvider();
      const walletChain = Number(String(wallet.chainId).split(":").pop());
      if (walletChain !== chainId) {
        setStatus("切换网络…");
        await wallet.switchChain(chainId);
      }
      for (const [i, tx] of txs.entries()) {
        setStatus(txs.length > 1 ? `签名 ${i + 1}/${txs.length}(approve/swap)…` : "签名发送中…");
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: wallet.address, to: tx.to, data: tx.data, value: `0x${BigInt(tx.value).toString(16)}` }],
        })) as string;
        setStatus(txs.length > 1 ? `等待确认 ${i + 1}/${txs.length}…` : "等待确认…");
        await waitReceipt(provider, hash);
      }
      setStatus("✅ 已发送");
      void refreshBals();
    } catch (e) {
      setStatus(`❌ ${(e as Error).message.slice(0, 120)}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submit() {
    try {
      void execute(side, parseEther(amount || "0"));
    } catch {
      setStatus("❌ 数量无效");
    }
  }

  function quickSell(pct: number) {
    if (tokenBal <= 0n) {
      setStatus("❌ 没有可卖持仓");
      return;
    }
    const amt = (tokenBal * BigInt(Math.round(pct))) / 100n;
    void execute("sell", amt);
  }

  function quickBuy(eth: number) {
    try {
      void execute("buy", parseEther(String(eth)));
    } catch {
      setStatus("❌ ETH 数量无效");
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
              {s === "buy" ? "买入" : "卖出"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5e6673", marginBottom: 6 }}>
          <span>{side === "buy" ? "支付 ETH" : "卖出代币"}</span>
          <span>
            {side === "buy"
              ? `余额 ${trimAmt(ethBal, 4)} ETH`
              : `持仓 ${fmtTokens(tokenBal)}`}
          </span>
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={side === "buy" ? "ETH 数量" : "代币数量"}
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
              <>大约得到 <b style={{ color: "#0ecb81" }}>{fmtTokens(quoteOut)}</b> 枚代币</>
            ) : (
              <>大约得到 <b style={{ color: "#0ecb81" }}>{trimAmt(quoteOut, 5)} ETH</b></>
            )
          ) : (
            <span style={{ color: "#5e6673" }}>{side === "buy" ? "输入 ETH 后显示买入枚数" : "输入数量后显示换回 ETH"}</span>
          )}
        </div>

        <div style={{ fontSize: 11, color: "#848e9c", marginBottom: 12, lineHeight: 1.6 }}>
          {graduated ? "毕业后走 SnowSwapRouter(V4)" : "曲线直购"}
          {antiBundle && !graduated && <span style={{ color: "#f0b90b" }}> · ⚠ antiBundle:仅 EOA 可买</span>}
        </div>

        {authenticated ? (
          <button
            onClick={submit}
            disabled={busy}
            style={{
              width: "100%", padding: 13, border: 0, borderRadius: 8, fontSize: 14,
              background: side === "buy" ? "#0ecb81" : "#f6465d",
              color: "#000", fontWeight: 800, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "处理中…" : side === "buy" ? "买入" : "卖出"}
          </button>
        ) : (
          <button onClick={login} style={{ width: "100%", padding: 13, border: 0, borderRadius: 8, background: "#f0b90b", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            登录后交易
          </button>
        )}
        {status && <div style={{ marginTop: 8, fontSize: 12, color: "#848e9c" }}>{status}</div>}
      </div>

      {/* 快捷买卖:点即成交 */}
      <div style={{ padding: "0 14px 12px", borderTop: "1px solid #1e2329" }}>
        <div style={{ display: "flex", alignItems: "center", margin: "10px 0 6px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#848e9c" }}>快捷买卖 · 点按即下单</span>
          <button
            type="button"
            onClick={() => setEditQuick((v) => !v)}
            style={{
              marginLeft: "auto", background: "none", border: "1px solid #2b3139", borderRadius: 4,
              color: editQuick ? "#f0b90b" : "#5e6673", fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "2px 8px",
            }}
          >
            {editQuick ? "完成" : "自定义"}
          </button>
        </div>

        <div style={{ fontSize: 10, color: "#5e6673", marginBottom: 4 }}>一键买入 (ETH)</div>
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

        <div style={{ fontSize: 10, color: "#5e6673", marginBottom: 4 }}>一键卖出 (持仓%)</div>
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
                卖 {p}%
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
          ⚙ 交易设置
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 400 }}>
            滑点 {(slippageBps / 100).toFixed(1)}% · Gas {GAS_PRESETS.find((g) => g.key === gasKey)?.label}
          </span>
          <span style={{ transform: showSettings ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
        </button>

        {showSettings && (
          <div style={{ padding: "4px 14px 14px", borderTop: "1px solid #1e2329" }}>
            <div style={{ fontSize: 11, color: "#5e6673", margin: "10px 0 6px" }}>滑点容差</div>
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
                placeholder="自定义%"
                style={{
                  width: 70, padding: "6px 8px", fontSize: 12, textAlign: "center",
                  background: "#0b0e11", border: `1px solid ${customSlippage ? "#f0b90b" : "#2b3139"}`,
                  borderRadius: 6, color: "#fff", outline: "none",
                }}
              />
            </div>

            <div style={{ fontSize: 11, color: "#5e6673", margin: "12px 0 6px" }}>Gas 档位</div>
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
                  {g.label}
                  <span style={{ display: "block", fontSize: 10, fontWeight: 400 }}>×{g.mult}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#3d4450", marginTop: 8 }}>
              Gas 档位为偏好设置(本地保存),当前链默认 gas 策略已适用大多数情况
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
