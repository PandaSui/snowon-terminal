import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";
import { and, desc, eq, isNull } from "drizzle-orm";
import { PrivyClient } from "@privy-io/server-auth";
import { createDb } from "@terminal/db";
import { chatMessages, chatUsers } from "@terminal/db";
import { holdingShareBps } from "./holdings.js";

// Privy JWT 服务端校验:配了 PRIVY_APP_ID + PRIVY_APP_SECRET 才启用;
// 未配置=本地开发模式,信任客户端传来的 userId(骨架行为,上线前必须配置)
const privy =
  process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET
    ? new PrivyClient(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET)
    : null;
if (!privy) console.warn("[chat] PRIVY_APP_SECRET 未配置:auth 为开发模式,信任客户端 userId");

/**
 * 聊天服务:WebSocket + Postgres 持久化 + Redis 扇出(多实例水平扩展)。
 * 房间: room = "{chainId}:{tokenAddress}" 或 "{chainId}:global"。
 *
 * 协议(JSON):
 *  C→S { t:"join", room }                 加入房间,返回最近 50 条 + 活跃叮住消息
 *  C→S { t:"msg", room, content, clientMsgId, replyTo? }
 *  C→S { t:"pin", room, content, payTxHash? }  付费叮住:20U/2分钟,最多 5 条轮换
 *  C→S { t:"danmaku", room, content, payTxHash? } 付费弹幕:5U/条,炫彩字体飘过 K 线(即播即弃)
 *  C→S { t:"auth", token }                Privy JWT → 绑定用户(服务端校验)
 *  S→C { t:"msg", ...ChatMessage }        房间广播
 *  S→C { t:"history", room, messages }
 *  S→C { t:"pins", room, pins }           叮住消息全量(加入/变更/过期时推送)
 *  S→C { t:"error", message }
 *
 * 审核:消息先落库再广播;删除走 deletedAt 软删,广播 { t:"delete", id }。
 * emoji 即 UTF-8 文本,无需特殊处理;图片表情走 content 里的 :code: 自定义表情协议(前端渲染)。
 */

interface ClientCtx {
  ws: WebSocket;
  userId?: string;
  rooms: Set<string>;
}

interface WireMessage {
  t: "msg";
  id: string;
  room: string;
  userId: string;
  username: string;
  content: string;
  replyTo?: number;
  holdingShareBps?: number | null;
  createdAt: string;
}

const db = createDb(process.env.DATABASE_URL!);
const redis = new Redis(process.env.REDIS_URL!, { retryStrategy: (n) => Math.min(n * 500, 10_000) });
const sub = new Redis(process.env.REDIS_URL!, { retryStrategy: (n) => Math.min(n * 500, 10_000) });
// ioredis 未挂 error 监听会把进程打崩(Redis 未启动/重启时);错误只记日志,靠 retryStrategy 自愈
for (const r of [redis, sub]) r.on("error", (e) => console.error("[redis]", e.message));

const wss = new WebSocketServer({ port: Number(process.env.CHAT_WS_PORT ?? 8080) });
const clients = new Set<ClientCtx>();
const rooms = new Map<string, Set<ClientCtx>>(); // room → clients
const INSTANCE_ID = crypto.randomUUID();

const MAX_CONTENT = 500;
const RATE_LIMIT_MS = 1000; // 每用户每秒 1 条(简单令牌桶)
const lastSent = new Map<string, number>();

// ── 付费叮住消息 ──
// 20U/次,展示 2 分钟,每房间最多 5 条,超出挤掉最早过期的一条。
// 存 Redis sorted set(score=过期时间戳),多实例共享;过期由清扫器移除并广播。
// 支付校验:PIN_REQUIRE_PAYMENT=1 时要求带 payTxHash(链上验付 TODO,当前仅记录);
// 默认 dev 模式不强制验付,前端按钮照常走完整流程。
const PIN_TTL_MS = 120_000;
const PIN_MAX = 5;
const PIN_MAX_CONTENT = 140;

interface Pin {
  id: string;
  userId: string;
  username: string;
  content: string;
  expiresAt: number; // epoch ms
  payTxHash?: string;
}

function pinsKey(room: string) {
  return `pins:${room}`;
}

/** 清掉过期 pin 并返回当前活跃列表;有清除动作时返回 changed=true */
async function activePins(room: string): Promise<{ pins: Pin[]; changed: boolean }> {
  const removed = await redis.zremrangebyscore(pinsKey(room), "-inf", Date.now());
  const raw = await redis.zrange(pinsKey(room), 0, -1);
  return { pins: raw.map((r) => JSON.parse(r) as Pin), changed: removed > 0 };
}

async function pushPins(room: string) {
  const { pins } = await activePins(room);
  emit(room, { t: "pins", room, pins });
}

// 过期清扫:只扫有订阅者的房间,有变化才广播
setInterval(() => {
  for (const room of rooms.keys()) {
    void activePins(room).then(({ changed }) => { if (changed) void pushPins(room); }).catch(() => {});
  }
}, 5_000);

function roomChannel(room: string) {
  return `chat:${room}`;
}

function broadcastLocal(room: string, payload: unknown) {
  const set = rooms.get(room);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const c of set) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

/** 本机先发,再 Redis 扇出。订阅端丢弃本实例发出的消息,避免重复。 */
function emit(room: string, payload: unknown) {
  broadcastLocal(room, payload);
  void redis.publish(roomChannel(room), JSON.stringify({ _from: INSTANCE_ID, payload })).catch((e) => {
    console.error("[redis] publish failed", e);
  });
}

function defaultUsername(userId: string): string {
  return userId.replace(/^did:privy:/, "").slice(0, 16) || "anon";
}

async function ensureUser(userId: string): Promise<void> {
  await db
    .insert(chatUsers)
    .values({ id: userId, username: defaultUsername(userId) })
    .onConflictDoNothing();
}

// Redis 扇出:其他实例的消息转发到本实例的房间成员
// price:* 房间只订阅不存库,加入即收实时价格 tick(K线实时推送用)
sub.psubscribe("chat:*", "price:*");
sub.on("pmessage", (_pattern, channel, message) => {
  const data = JSON.parse(message) as { _from?: string; payload?: unknown } & Record<string, unknown>;
  if (data._from === INSTANCE_ID) return;
  if (channel.startsWith("chat:")) {
    const room = channel.slice("chat:".length);
    broadcastLocal(room, data.payload ?? data);
  } else if (channel.startsWith("price:")) {
    const tick = data.payload ?? data;
    broadcastLocal(channel, { t: "price", room: channel, ...(tick as object) });
  }
});

async function sendHistory(ctx: ClientCtx, room: string) {
  const [chainId, roomAddr] = room.split(":");
  if (!roomAddr) {
    ctx.ws.send(JSON.stringify({ t: "error", message: "bad room" }));
    return;
  }
  const rows = await db
    .select({
      id: chatMessages.id,
      userId: chatMessages.userId,
      username: chatUsers.username,
      content: chatMessages.content,
      holdingShareBps: chatMessages.holdingShareBps,
      replyTo: chatMessages.replyTo,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .leftJoin(chatUsers, eq(chatUsers.id, chatMessages.userId))
    .where(and(eq(chatMessages.chainId, Number(chainId)), eq(chatMessages.room, roomAddr), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(50);
  const messages = rows.reverse().map((r) => ({
    id: r.id.toString(),
    userId: r.userId,
    username: r.username ?? "anon",
    content: r.content,
    holdingShareBps: r.holdingShareBps,
    replyTo: r.replyTo != null ? Number(r.replyTo) : undefined,
    createdAt: r.createdAt.toISOString(),
  }));
  ctx.ws.send(JSON.stringify({ t: "history", room, messages }));
}

async function handleMessage(ctx: ClientCtx, raw: string) {
  let msg: { t: string; room?: string; content?: string; clientMsgId?: string; replyTo?: number; userId?: string; token?: string; payTxHash?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return ctx.ws.send(JSON.stringify({ t: "error", message: "bad json" }));
  }

  if (msg.t === "auth") {
    if (privy) {
      // 生产模式:必须带 Privy access token,服务端验签后取 userId
      if (!msg.token) return ctx.ws.send(JSON.stringify({ t: "error", message: "auth token required" }));
      try {
        const claims = await privy.verifyAuthToken(msg.token);
        ctx.userId = claims.userId;
      } catch {
        return ctx.ws.send(JSON.stringify({ t: "error", message: "auth failed" }));
      }
    } else {
      ctx.userId = msg.userId;
    }
    if (ctx.userId) await ensureUser(ctx.userId);
    return;
  }

  if (msg.t === "join" && msg.room) {
    ctx.rooms.add(msg.room);
    if (!rooms.has(msg.room)) rooms.set(msg.room, new Set());
    rooms.get(msg.room)!.add(ctx);
    // price 房间无历史消息,跳过落库查询
    if (!msg.room.startsWith("price:")) {
      await sendHistory(ctx, msg.room);
      // 加入即下发当前活跃叮住消息
      const { pins } = await activePins(msg.room);
      ctx.ws.send(JSON.stringify({ t: "pins", room: msg.room, pins }));
    }
    return;
  }

  // 付费叮住:内容进顶部轮换栏,炫彩样式由前端渲染
  if (msg.t === "pin" && msg.room && msg.content) {
    if (!ctx.userId) return ctx.ws.send(JSON.stringify({ t: "error", message: "auth required" }));
    const content = msg.content.slice(0, PIN_MAX_CONTENT);
    if (!content.trim()) return;
    if (process.env.PIN_REQUIRE_PAYMENT === "1" && !msg.payTxHash) {
      return ctx.ws.send(JSON.stringify({ t: "error", message: "pin payment required (20U)" }));
    }
    const user = await db.select().from(chatUsers).where(eq(chatUsers.id, ctx.userId)).limit(1);
    const pin: Pin = {
      id: crypto.randomUUID(),
      userId: ctx.userId,
      username: user[0]?.username ?? "anon",
      content,
      expiresAt: Date.now() + PIN_TTL_MS,
      payTxHash: msg.payTxHash,
    };
    const key = pinsKey(msg.room);
    await redis.zadd(key, pin.expiresAt, JSON.stringify(pin));
    // 最多 5 条:挤掉最早过期的
    const count = await redis.zcard(key);
    if (count > PIN_MAX) await redis.zremrangebyrank(key, 0, count - PIN_MAX - 1);
    await pushPins(msg.room);
    return;
  }

  // 付费弹幕:5U/次,炫彩字体飘过 K 线图。不落库、不持久化,即播即弃。
  // DANMAKU_REQUIRE_PAYMENT=1 时要求带 payTxHash(链上验付 TODO);默认 dev 模式直通。
  if (msg.t === "danmaku" && msg.room && msg.content) {
    if (!ctx.userId) return ctx.ws.send(JSON.stringify({ t: "error", message: "auth required" }));
    const content = msg.content.slice(0, 60);
    if (!content.trim()) return;
    if (process.env.DANMAKU_REQUIRE_PAYMENT === "1" && !msg.payTxHash) {
      return ctx.ws.send(JSON.stringify({ t: "error", message: "danmaku payment required (5U)" }));
    }
    // 限流:每用户 3s 一条弹幕
    const now = Date.now();
    const key = `dmk:${ctx.userId}`;
    if (now - (lastSent.get(key) ?? 0) < 3000) {
      return ctx.ws.send(JSON.stringify({ t: "error", message: "danmaku rate limited (3s)" }));
    }
    lastSent.set(key, now);
    const user = await db.select().from(chatUsers).where(eq(chatUsers.id, ctx.userId)).limit(1);
    emit(msg.room, {
      t: "danmaku",
      room: msg.room,
      id: crypto.randomUUID(),
      username: user[0]?.username ?? "anon",
      content,
    });
    return;
  }

  if (msg.t === "msg" && msg.room && msg.content) {
    if (!ctx.userId) return ctx.ws.send(JSON.stringify({ t: "error", message: "auth required" }));
    const content = msg.content.slice(0, MAX_CONTENT);
    if (!content.trim()) return;

    // 限流
    const now = Date.now();
    if (now - (lastSent.get(ctx.userId) ?? 0) < RATE_LIMIT_MS) {
      return ctx.ws.send(JSON.stringify({ t: "error", message: "rate limited" }));
    }
    lastSent.set(ctx.userId, now);

    // 幂等:同 userId + clientMsgId 去重
    if (msg.clientMsgId) {
      const dup = await db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(and(eq(chatMessages.userId, ctx.userId), eq(chatMessages.clientMsgId, msg.clientMsgId)))
        .limit(1);
      if (dup.length) return;
    }

    const [chainId, roomAddr] = msg.room.split(":");
    const user = await db.select().from(chatUsers).where(eq(chatUsers.id, ctx.userId)).limit(1);
    const u = user[0];

    // 持仓徽章:用户开启展示且绑定钱包时,算该房间代币的持仓占比
    let share: number | null = null;
    if (u?.showHoldings && u.walletAddress && u.walletChainId === Number(chainId) && roomAddr !== "global") {
      share = await holdingShareBps(db, Number(chainId), u.walletAddress, roomAddr);
    }

    const [saved] = await db
      .insert(chatMessages)
      .values({
        chainId: Number(chainId),
        room: roomAddr,
        userId: ctx.userId,
        content,
        replyTo: msg.replyTo != null ? BigInt(msg.replyTo) : null,
        clientMsgId: msg.clientMsgId ?? null,
        holdingShareBps: share,
      })
      .returning();

    const wire: WireMessage = {
      t: "msg",
      id: saved.id.toString(),
      room: msg.room,
      userId: ctx.userId,
      username: u?.username ?? "anon",
      content: saved.content,
      replyTo: msg.replyTo,
      holdingShareBps: share,
      createdAt: saved.createdAt.toISOString(),
    };
    emit(msg.room, wire);
  }
}

wss.on("connection", (ws) => {
  const ctx: ClientCtx = { ws, rooms: new Set() };
  clients.add(ctx);
  ws.on("message", (data) => handleMessage(ctx, data.toString()).catch(console.error));
  ws.on("close", () => {
    clients.delete(ctx);
    for (const room of ctx.rooms) rooms.get(room)?.delete(ctx);
  });
});

console.log(`chat ws listening on :${process.env.CHAT_WS_PORT ?? 8080}`);

// ── 审核入口(供内部 admin API 调用)──
export async function softDelete(messageId: bigint) {
  await db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, messageId));
  const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).limit(1);
  if (m) emit(`${m.chainId}:${m.room}`, { t: "delete", id: messageId.toString() });
}
