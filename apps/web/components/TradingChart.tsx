"use client";

import { apiUrl } from "@/lib/apiBase";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { subscribe } from "@/lib/realtime";
import { readJson } from "@/lib/http";
import { useQuoteUnit } from "@/lib/quoteUnit";
import { CHART_RESOLUTIONS, RES_LOOKBACK, RES_SECONDS, type ChartResolution } from "@/lib/chartResolutions";
import { useT } from "@/lib/locale";

/**
 * K 线图(lightweight-charts)。数据源 = /api/udf/history。
 * 周期按钮放在画布上方独立工具栏,避免被 canvas 挡住无法切换。
 */

const TZ_OFFSET = 8 * 3600;

/** 右键菜单可开关的均线 */
const MA_PERIODS = [5, 10, 30] as const;
const MA_COLORS: Record<number, string> = { 5: "#f0b90b", 10: "#00c3ff", 30: "#b15bff" };

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "");
    return v as T;
  } catch {
    return fallback;
  }
}

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
  const tr = useT();
  const resolution = (resProp ?? internalRes) as ChartResolution;

  /* 计价单位:跟随全局 ETH/USD 切换;USD 时用 ETH 汇率换算 */
  const [unit, setUnit] = useQuoteUnit();
  const { data: ethPrice } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      const body = await readJson<{ price?: number }>(res);
      if (!res.ok || !Number.isFinite(body.price)) throw new Error("price unavailable");
      return body;
    },
    refetchInterval: 15_000,
    retry: 1,
    enabled: unit === "usd",
  });
  const ethUsd = unit === "usd" && ethPrice?.price && ethPrice.price > 0 ? ethPrice.price : 0;
  const mult = ethUsd || 1;
  const multRef = useRef(mult);
  multRef.current = mult;
  /** USD 模式下等汇率就位再出图,避免先画出 ETH 价的错误刻度 */
  const rateReady = unit === "eth" || ethUsd > 0;

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
      // 滚轮在 K 线上 = 缩放时间轴(页面滚动用按住拖拽);双指 pinch 同效
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
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
      maSeriesRef.current.clear();
    };
  }, []);

  const lastBarRef = useRef<Bar | null>(null);
  /** 每个(代币/周期/单位)只 fit 一次;之后轮询刷新不再重置用户缩放 */
  const fittedRef = useRef(false);
  /** 当前已加载的 K 线(已按单位换算),供均线计算 */
  const barsRef = useRef<Bar[]>([]);
  const maSeriesRef = useRef<Map<number, ReturnType<IChartApi["addSeries"]>>>(new Map());

  /* 指标开关(右键菜单),本地持久化 */
  const [mas, setMas] = useState<number[]>([]);
  const [showVol, setShowVol] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const masRef = useRef(mas);
  masRef.current = mas;

  useEffect(() => {
    const saved = loadJson<number[]>("chart.mas", []);
    setMas(saved.filter((n): n is number => (MA_PERIODS as readonly number[]).includes(n)));
    setShowVol(localStorage.getItem("chart.vol") !== "0");
  }, []);

  /** 按 barsRef 重算各周期均线;关闭的周期移除序列 */
  function refreshMas() {
    const chart = chartRef.current;
    if (!chart) return;
    const bars = barsRef.current;
    for (const p of MA_PERIODS) {
      const enabled = masRef.current.includes(p);
      let s = maSeriesRef.current.get(p);
      if (!enabled) {
        if (s) {
          chart.removeSeries(s as never);
          maSeriesRef.current.delete(p);
        }
        continue;
      }
      if (!s) {
        s = chart.addSeries(LineSeries, {
          color: MA_COLORS[p],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        maSeriesRef.current.set(p, s);
      }
      const data: Array<{ time: UTCTimestamp; value: number }> = [];
      let sum = 0;
      for (let i = 0; i < bars.length; i++) {
        sum += bars[i].close;
        if (i >= p) sum -= bars[i - p].close;
        if (i >= p - 1) data.push({ time: bars[i].time, value: sum / p });
      }
      s.setData(data);
    }
  }

  /** 重置:恢复时间轴与价格轴到自适应全览 */
  function resetChart() {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale("right").applyOptions({ autoScale: true });
    chart.priceScale("vol").applyOptions({ autoScale: true });
    chart.timeScale().resetTimeScale();
    chart.timeScale().fitContent();
  }

  // 指标开关变化时即时应用
  useEffect(() => {
    refreshMas();
  }, [mas]);
  useEffect(() => {
    volRef.current?.applyOptions({ visible: showVol });
  }, [showVol]);

  useEffect(() => {
    if (!rateReady) return;
    let cancelled = false;
    const symbol = `${chainId}:${tokenAddress}`;
    const res = RES_SECONDS[resolution] ?? 300;
    lastBarRef.current = null;
    fittedRef.current = false;

    async function load() {
      const to = Math.floor(Date.now() / 1000);
      const lookback = RES_LOOKBACK[resolution] ?? 14 * 86400;
      const from = Math.max(0, to - lookback);
      try {
        const r = await fetch(apiUrl(`/api/udf/history?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`));
        const d = await readJson<UdfHistory>(r);
        if (cancelled || !seriesRef.current) return;
        if (d.s !== "ok" || !d.t?.length) {
          setEmpty(true);
          seriesRef.current.setData([]);
          volRef.current?.setData([]);
          barsRef.current = [];
          lastBarRef.current = null;
          refreshMas();
          return;
        }
        setEmpty(false);
        const m = multRef.current;
        const bars: Bar[] = d.t.map((t, i) => ({
          time: (t + TZ_OFFSET) as UTCTimestamp,
          open: d.o![i] * m,
          high: d.h![i] * m,
          low: d.l![i] * m,
          close: d.c![i] * m,
        }));
        barsRef.current = bars;
        seriesRef.current.setData(bars);
        volRef.current?.setData(
          d.t.map((t, i) => ({
            time: (t + TZ_OFFSET) as UTCTimestamp,
            value: d.v![i] * m,
            color: d.c![i] >= d.o![i] ? "rgba(14,203,129,0.4)" : "rgba(246,70,93,0.4)",
          })),
        );
        volRef.current?.applyOptions({ visible: showVol });
        refreshMas();
        const n = d.t.length - 1;
        lastBarRef.current = {
          time: (d.t[n] + TZ_OFFSET) as UTCTimestamp,
          open: d.o![n] * m,
          high: d.h![n] * m,
          low: d.l![n] * m,
          close: d.c![n] * m,
        };
        if (!fittedRef.current) {
          fittedRef.current = true;
          requestAnimationFrame(() => chartRef.current?.timeScale().fitContent());
        }
      } catch {
        if (!cancelled) setEmpty(true);
      }
    }

    const off = subscribe(`price:${symbol.toLowerCase()}`, (tick) => {
      if (!seriesRef.current) return;
      const price = Number(tick.priceEth) * multRef.current;
      const ts = Math.floor(new Date(String(tick.ts)).getTime() / 1000);
      if (!Number.isFinite(price) || !Number.isFinite(ts)) return;
      const bucket = (Math.floor(ts / res) * res + TZ_OFFSET) as UTCTimestamp;
      const last = lastBarRef.current;
      // 新 bar 开盘价衔接上一根收盘价,与历史接口的补线逻辑一致,避免实时跳动出跳空
      const bar: Bar =
        last && last.time === bucket
          ? { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }
          : last
            ? { time: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price }
            : { time: bucket, open: price, high: price, low: price, close: price };
      lastBarRef.current = bar;
      const bars = barsRef.current;
      if (bars.length && bars[bars.length - 1].time === bar.time) bars[bars.length - 1] = bar;
      else bars.push(bar);
      seriesRef.current.update(bar);
      refreshMas();
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
    // rateReady 仅表达"汇率是否就位",数值本身的变化(15s 刷新)不触发重载
  }, [chainId, tokenAddress, resolution, unit, rateReady]);

  // USD 模式下价格数量级变大,降低精度避免一堆尾零
  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat:
        unit === "usd"
          ? { type: "price", precision: 8, minMove: 1e-8 }
          : { type: "price", precision: 10, minMove: 1e-10 },
    });
  }, [unit]);

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
        <button
          type="button"
          onClick={() => setUnit(unit === "usd" ? "eth" : "usd")}
          title={tr("switchQuote")}
          style={{
            marginLeft: "auto",
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 700,
            border: "1px solid #2b3139",
            borderRadius: 4,
            cursor: "pointer",
            background: "#1c2127",
            color: "#f0b90b",
          }}
        >
          {unit === "usd" ? "$ USD" : "Ξ ETH"}
        </button>
        <span style={{ fontSize: 10, color: "#3d4450", whiteSpace: "nowrap" }} title={tr("scrollZoomTip")}>
          {tr("scrollZoom")}
        </span>
      </div>
      <div style={{ position: "relative", width: "100%", flex: 1, minHeight: 0 }}>
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%" }}
          onContextMenu={(e) => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: Math.min(e.clientX - r.left, r.width - 170), y: Math.min(e.clientY - r.top, r.height - 190) });
          }}
          onClick={() => setMenu(null)}
        />
        {menu && (
          <div
            style={{
              position: "absolute", left: menu.x, top: menu.y, zIndex: 30, minWidth: 150,
              background: "#161b22", border: "1px solid #2b3139", borderRadius: 8, padding: 4,
              boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div style={{ fontSize: 10, color: "#5e6673", padding: "4px 10px 2px", fontWeight: 700 }}>{tr("indicators")}</div>
            {MA_PERIODS.map((p) => {
              const on = mas.includes(p);
              return (
                <MenuItem
                  key={p}
                  onClick={() => {
                    const next = on ? mas.filter((n) => n !== p) : [...mas, p];
                    setMas(next);
                    localStorage.setItem("chart.mas", JSON.stringify(next));
                  }}
                >
                  <span style={{ color: MA_COLORS[p], width: 14, display: "inline-block" }}>{on ? "✓" : ""}</span>
                  {tr("maLine", { p })}
                </MenuItem>
              );
            })}
            <MenuItem
              onClick={() => {
                const next = !showVol;
                setShowVol(next);
                localStorage.setItem("chart.vol", next ? "1" : "0");
              }}
            >
              <span style={{ color: "#848e9c", width: 14, display: "inline-block" }}>{showVol ? "✓" : ""}</span>
              {tr("volumeVol")}
            </MenuItem>
            <div style={{ borderTop: "1px solid #2b3139", margin: "4px 0" }} />
            <MenuItem
              onClick={() => {
                resetChart();
                setMenu(null);
              }}
            >
              <span style={{ width: 14, display: "inline-block" }}>⟲</span>
              {tr("resetChart")}
            </MenuItem>
          </div>
        )}
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
            {tr("noChartTrades")}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", width: "100%", padding: "6px 10px",
        fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left",
        background: hover ? "#1c2127" : "transparent", border: 0, borderRadius: 5, color: "#eaecef",
      }}
    >
      {children}
    </button>
  );
}
