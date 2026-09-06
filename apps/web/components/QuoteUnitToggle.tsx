"use client";

import { useQuoteUnit, type QuoteUnit } from "@/lib/quoteUnit";

function EthIcon({ size, active }: { size: number; active: boolean }) {
  const c = active ? "#627EEA" : "#5e6673";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <g fill={c}>
        <polygon points="16,3 16,14.2 26.5,16.4" opacity="0.7" />
        <polygon points="16,3 5.5,16.4 16,14.2" />
        <polygon points="16,17.5 16,25.2 26.5,17.8" opacity="0.7" />
        <polygon points="16,17.5 5.5,17.8 16,25.2" />
        <polygon points="16,26.4 16,29 26.2,19.2" opacity="0.55" />
        <polygon points="16,26.4 5.8,19.2 16,29" opacity="0.8" />
      </g>
    </svg>
  );
}

function UsdIcon({ size, active }: { size: number; active: boolean }) {
  const c = active ? "#0ecb81" : "#5e6673";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="13" fill="none" stroke={c} strokeWidth="2.2" />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fill={c}
        fontSize="16"
        fontWeight="800"
        fontFamily="system-ui, sans-serif"
      >
        $
      </text>
    </svg>
  );
}

/** ETH 钻石 / 美元 $ logo 切换计价 */
export function QuoteUnitToggle({ size = 16 }: { size?: number }) {
  const [unit, setUnit] = useQuoteUnit();
  const btn = (u: QuoteUnit): React.CSSProperties => ({
    width: size + 10,
    height: size + 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    cursor: "pointer",
    border: `1px solid ${unit === u ? "#2b3139" : "transparent"}`,
    borderRadius: 6,
    background: unit === u ? "#1c1f26" : "transparent",
  });
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 1 }} title="切换 ETH / 美元计价">
      <button type="button" onClick={() => setUnit("eth")} style={btn("eth")} title="ETH 计价">
        <EthIcon size={size} active={unit === "eth"} />
      </button>
      <button type="button" onClick={() => setUnit("usd")} style={btn("usd")} title="美元计价">
        <UsdIcon size={size} active={unit === "usd"} />
      </button>
    </span>
  );
}
