"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { subscribe } from "@/lib/realtime";
import { readJson } from "@/lib/http";
import { CHART_RESOLUTIONS, RES_LOOKBACK, RES_SECONDS, type ChartResolution } from "@/lib/chartResolutions";

/**
 * K 线图(lightweight-charts)。数据源 = /api/udf/history。
 * 周期按钮放在画布上方独立工具栏,避免被 canvas 挡住无法切换。
 */

const TZ_OFFSET = 8 * 3600;

interface Bar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface UdfHistory {
  s: "ok" | "no_data" | "error";
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
  errmsg?: string;
}

export function TradingChart({
  chainId,
  tokenAddress,
  resolution: resProp,
  onResolutionChange,
}: {
  chainId: number;
  tokenAddress: string;
  resolution?: ChartResolution | string;
  onResolutionChange?: (r: ChartResolution) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const volRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const [internalRes, setInternalRes] = useState<ChartResolution>("5");
  const [empty, setEmpty] = useState(false);
  const resolution = (resProp ?? internalRes) as ChartResolution;

  function setResolution(r: ChartResolution) {
    onResolutionChange?.(r);
    if (resProp == null) setInternalRes(r);
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#0b0e11" },
        textColor: "#848e9c",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1c2127" },
        horzLines: { color: "#1c2127" },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#2b3139" },
      rightPriceScale: { borderColor: "#2b3139" },
      crosshair: { mode: 0 },
      // 滚轮交给页面滚动,不在 K 线里吞掉
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
      borderVisible: false,
      priceFormat: { type: "price", precision: 10, minMove: 1e-10 },
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    seriesRef.current = candles;
    volRef.current = volume;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
    };
  }, []);

  const lastBarRef = useRef<Bar | null>(null);

  useEffect(() => {
    let cancelled = false;
    const symbol = `${chainId}:${tokenAddress}`;
    const res = RES_SECONDS[resolution] ?? 300;
    lastBarRef.current = null;

    async function load() {
      const to = Math.floor(Date.now() / 1000);
      const lookback = RES_LOOKBACK[resolution] ?? 14 * 86400;
      const from = Math.max(0, to - lookback);
      try {
        const r = await fetch(`/api/udf/history?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`);
        const d = await readJson<UdfHistory>(r);
        if (cancelled || !seriesRef.current) return;
        if (d.s !== "ok" || !d.t?.length) {
          setEmpty(true);
          seriesRef.current.setData([]);
          volRef.current?.setData([]);
          lastBarRef.current = null;
          return;
        }
        setEmpty(false);
        seriesRef.current.setData(
          d.t.map((t, i) => ({
            time: (t + TZ_OFFSET) as UTCTimestamp,
            open: d.o![i],
            high: d.h![i],
            low: d.l![i],
            close: d.c![i],
          })),
        );
        volRef.current?.setData(
          d.t.map((t, i) => ({
            time: (t + TZ_OFFSET) as UTCTimestamp,
            value: d.v![i],
            color: d.c![i] >= d.o![i] ? "rgba(14,203,129,0.4)" : "rgba(246,70,93,0.4)",
          })),
        );
        const n = d.t.length - 1;
        lastBarRef.current = {
          time: (d.t[n] + TZ_OFFSET) as UTCTimestamp,
          open: d.o![n],
          high: d.h![n],
          low: d.l![n],
          close: d.c![n],
        };
        requestAnimationFrame(() => chartRef.current?.timeScale().fitContent());
      } catch {
        if (!cancelled) setEmpty(true);
      }
    }

    const off = subscribe(`price:${symbol.toLowerCase()}`, (tick) => {
      if (!seriesRef.current) return;
      const price = Number(tick.priceEth);
      const ts = Math.floor(new Date(String(tick.ts)).getTime() / 1000);
      if (!Number.isFinite(price) || !Number.isFinite(ts)) return;
      const bucket = (Math.floor(ts / res) * res + TZ_OFFSET) as UTCTimestamp;
      const last = lastBarRef.current;
      const bar: Bar =
        last && last.time === bucket
          ? { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }
          : { time: bucket, open: price, high: price, low: price, close: price };
      lastBarRef.current = bar;
      seriesRef.current.update(bar);
      setEmpty(false);
    });

    void load();
    const hasWs = Boolean(process.env.NEXT_PUBLIC_WS_URL);
    const timer = setInterval(() => void load(), hasWs ? 30_000 : 8_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      off();
    };
  }, [chainId, tokenAddress, resolution]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "#0d1117",
        border: "1px solid #1e2329",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 4,
          padding: "8px 10px",
          borderBottom: "1px solid #1e2329",
          flexShrink: 0,
          background: "#0d1117",
          position: "relative",
          zIndex: 3,
        }}
      >
        {CHART_RESOLUTIONS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setResolution(r.value)}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 700,
              border: "1px solid #2b3139",
              borderRadius: 4,
              cursor: "pointer",
              background: resolution === r.value ? "#f0b90b" : "#1c2127",
              color: resolution === r.value ? "#0b0e11" : "#848e9c",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div style={{ position: "relative", width: "100%", flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        {empty && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#848e9c",
              fontSize: 14,
              pointerEvents: "none",
            }}
          >
            暂无成交 — 第一笔交易后出图
          </div>
        )}
      </div>
    </div>
  );
}
