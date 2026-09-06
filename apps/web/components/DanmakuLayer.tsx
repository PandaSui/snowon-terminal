"use client";

import { apiUrl } from "@/lib/apiBase";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";

interface DanmakuItem {
  id: string;
  username: string;
  content: string;
  top: number;
  duration: number;
  buyUsd: number;
}

const DURATION_S = 10;

type Tier = {
  fontSize: number;
  color: string;
  weight: number;
  cls: string;
};

/** 按累计买入美金分档:字号/颜色;$500 橙+炫光,$1000+ 彩虹闪光 */
function tierOf(buyUsd: number): Tier {
  if (buyUsd >= 1000) return { fontSize: 22, color: "", weight: 900, cls: "danmaku-whale" };
  if (buyUsd >= 500) return { fontSize: 19, color: "#ff8a00", weight: 800, cls: "danmaku-orange" };
  if (buyUsd >= 200) return { fontSize: 17, color: "#f0b90b", weight: 800, cls: "" };
  if (buyUsd >= 50) return { fontSize: 16, color: "#00c3ff", weight: 700, cls: "" };
  if (buyUsd >= 10) return { fontSize: 15, color: "#eaecef", weight: 650, cls: "" };
  return { fontSize: 13, color: "#b7bcc5", weight: 600, cls: "" };
}

/**
 * K 线图弹幕层:监听代币房间的 {t:"danmaku"} 广播。
 * 颜色/字号按发送者在该币累计买入额(USD);满 1000U 彩虹闪光。留存 10s。
 */
export function DanmakuLayer({ chainId, tokenAddress }: { chainId: number; tokenAddress: string }) {
  const [items, setItems] = useState<DanmakuItem[]>([]);
  const room = `${chainId}:${tokenAddress.toLowerCase()}`;
  const { data: eth } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/eth-price"));
      return readJson<{ price: number }>(res);
    },
    staleTime: 15_000,
  });
  const ethUsd = eth?.price && eth.price > 0 ? eth.price : 0;
  const ethUsdRef = useRef(ethUsd);
  ethUsdRef.current = ethUsd;

  useEffect(() => {
    let dead = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (dead) return;
      const url = process.env.NEXT_PUBLIC_WS_URL;
      if (!url) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry = 0;
        ws!.send(JSON.stringify({ t: "join", room }));
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.t !== "danmaku" || !data.content) return;
          const buyEth = Number(data.buyEth ?? 0);
          const px = ethUsdRef.current;
          const buyUsd = Number.isFinite(buyEth) && buyEth > 0 && px > 0
            ? buyEth * px
            : Number(data.buyUsd ?? 0);
          const item: DanmakuItem = {
            id: String(data.id ?? crypto.randomUUID()),
            username: data.username ?? "anon",
            content: String(data.content).slice(0, 60),
            top: 8 + Math.random() * 55,
            duration: DURATION_S,
            buyUsd: Number.isFinite(buyUsd) ? buyUsd : 0,
          };
          setItems((prev) => (prev.some((x) => x.id === item.id) ? prev : [...prev.slice(-19), item]));
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (dead) return;
        const wait = Math.min(1000 * 2 ** retry++, 15_000);
        timer = setTimeout(connect, wait);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [room]);

  if (items.length === 0) return null;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }}>
      {items.map((d) => {
        const t = tierOf(d.buyUsd);
        return (
          <span
            key={d.id}
            className={`danmaku-item${t.cls ? ` ${t.cls}` : ""}`}
            style={{
              top: `${d.top}%`,
              left: "100%",
              animationDuration: t.cls ? undefined : `${d.duration}s`,
              fontSize: t.fontSize,
              fontWeight: t.weight,
              color: t.cls ? undefined : t.color,
              textShadow: t.cls ? undefined : "0 1px 3px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.45)",
            }}
            onAnimationEnd={(e) => {
              if (e.animationName.includes("danmaku-fly") || e.animationName === "danmaku-fly") {
                setItems((prev) => prev.filter((x) => x.id !== d.id));
              }
            }}
          >
            {t.cls ? `✦ ${d.content} ✦` : d.content}
          </span>
        );
      })}
    </div>
  );
}
