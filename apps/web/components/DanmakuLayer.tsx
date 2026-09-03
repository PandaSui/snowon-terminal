"use client";

import { useEffect, useState } from "react";

interface DanmakuItem {
  id: string;
  username: string;
  content: string;
  top: number; // 百分比
  duration: number; // 秒
}

/**
 * K 线图弹幕层:监听代币房间的 {t:"danmaku"} 广播,
 * 炫彩闪烁字体从右往左飘过图表。付费 5U/条(服务端 DANMAKU_REQUIRE_PAYMENT 开关)。
 */
export function DanmakuLayer({ chainId, tokenAddress }: { chainId: number; tokenAddress: string }) {
  const [items, setItems] = useState<DanmakuItem[]>([]);
  const room = `${chainId}:${tokenAddress.toLowerCase()}`;

  useEffect(() => {
    // 每次 effect 独立的 dead 标志:StrictMode 双挂载时旧闭包的 ws.onclose 不会误触发重连
    let dead = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (dead) return;
      ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);
      ws.onopen = () => {
        retry = 0;
        ws!.send(JSON.stringify({ t: "join", room }));
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.t !== "danmaku" || !data.content) return;
          const item: DanmakuItem = {
            id: String(data.id ?? crypto.randomUUID()),
            username: data.username ?? "anon",
            content: String(data.content).slice(0, 60),
            top: 8 + Math.random() * 55, // 避开顶部周期按钮和底部时间轴
            duration: 7 + Math.random() * 4,
          };
          // 按 id 去重,最多同屏 20 条
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
      {items.map((d) => (
        <span
          key={d.id}
          className="danmaku-item pin-flash"
          style={{ top: `${d.top}%`, left: "100%", animationDuration: `${d.duration}s` }}
          onAnimationEnd={() => setItems((prev) => prev.filter((x) => x.id !== d.id))}
        >
          {d.content}
        </span>
      ))}
    </div>
  );
}
