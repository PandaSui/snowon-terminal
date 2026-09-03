"use client";

/**
 * 站内实时推送客户端(单例 WebSocket + 房间订阅 + 自动重连)。
 * 服务端 = apps/chat(同时承载聊天室与 price:* 价格扇出)。
 *
 *   const off = subscribe(`price:${chainId}:${addr}`, (tick) => { ... });
 *   off(); // 退订
 */

type Handler = (data: Record<string, unknown>) => void;

const subs = new Map<string, Set<Handler>>();
let ws: WebSocket | null = null;
let retry = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function ensure() {
  if (typeof window === "undefined") return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const url = process.env.NEXT_PUBLIC_WS_URL;
  if (!url) return;
  ws = new WebSocket(url);

  ws.onopen = () => {
    retry = 0;
    // 重连后恢复全部房间
    for (const room of subs.keys()) {
      ws!.send(JSON.stringify({ t: "join", room }));
    }
  };
  ws.onmessage = (e) => {
    let data: Record<string, unknown> & { room?: string };
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!data.room) return;
    const set = subs.get(data.room);
    if (set) for (const h of set) h(data);
  };
  ws.onclose = () => {
    ws = null;
    if (subs.size === 0) return;
    const wait = Math.min(1000 * 2 ** retry++, 15_000);
    reconnectTimer = setTimeout(ensure, wait);
  };
  ws.onerror = () => ws?.close();
}

/** 订阅房间消息,返回退订函数 */
export function subscribe(room: string, handler: Handler): () => void {
  if (!subs.has(room)) subs.set(room, new Set());
  subs.get(room)!.add(handler);
  ensure();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ t: "join", room }));
  }
  return () => {
    const set = subs.get(room);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) subs.delete(room);
  };
}
