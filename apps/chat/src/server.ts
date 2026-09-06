import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createDb } from "@terminal/db";
import { chatMessages, chatUsers, getAppSettings, verifySession, type AppSettings } from "@terminal/db";
import { verifySnowPayment, snowToWei } from "./pay.js";
import { holdingShareBps, totalBoughtEth } from "./holdings.js";

// 鉴权:客户端签名登录换取会话令牌,连接时带来,服务端 verifySession 得到可信钱包地址。

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
  wallet?: string;
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
const PIN_MAX_CONTENT = 140;

// 付费叮住的价格/时长/上限/收款地址由管理面板配置(app_settings),缓存 30s。
let _settingsCache: { at: number; v: AppSettings } | null = null;
async function settings(): Promise<AppSettings> {
  if (_settingsCache && Date.now() - _settingsCache.at < 30_000) return _settingsCache.v;
  const v = await getAppSettings(db);
  _settingsCache = { at: Date.now(), v };
  return v;
}

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
  let msg: { t: string; room?: string; content?: string; clientMsgId?: string; replyTo?: number; userId?: string; token?: string; payTxHash?: string; wallet?: string; payer?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return ctx.ws.send(JSON.stringify({ t: "error", message: "bad json" }));
  }

  if (msg.t === "auth") {
    // 会话令牌(签名登录)→ ctx.userId = 验签得到的钱包地址;无效则保持匿名(仅可读)
    ctx.userId = verifySession(msg.token) ?? undefined;
    if (ctx.userId) {
      await ensureUser(ctx.userId);
      ctx.wallet = ctx.userId;
      await db.update(chatUsers).set({ walletAddress: ctx.userId }).where(eq(chatUsers.id, ctx.userId)).catch(() => {});
    }
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

    const s = await settings();
    // ── 付费校验:必须带一笔有效的 SNOW 付款交易 ──
    if (!msg.payTxHash) {
      return ctx.ws.send(JSON.stringify({ t: "error", message: `叮住需付费 ${s.pinPriceSnow} SNOW` }));
    }
    // 防重放:同一 txHash 只能用一次(原子占位,验证失败再释放)
    const txId = msg.payTxHash.toLowerCase();
    if ((await redis.sadd("pin:usedtx", txId)) === 0) {
      return ctx.ws.send(JSON.stringify({ t: "error", message: "该付款交易已被使用过" }));
    }
    const check = await verifySnowPayment({
      txHash: msg.payTxHash,
      payee: s.pinPayee,
      priceWei: snowToWei(s.pinPriceSnow),
      payer: msg.payer, // 前端传的钱包地址(userId 是 Privy id,非链上地址)
    });
    if (!check.ok) {
      await redis.srem("pin:usedtx", txId);
      return ctx.ws.send(JSON.stringify({ t: "error", message: "付款校验失败:" + (check.reason ?? "") }));
    }

    const user = await db.select().from(chatUsers).where(eq(chatUsers.id, ctx.userId)).limit(1);
    const pin: Pin = {
      id: crypto.randomUUID(),
      userId: ctx.userId,
      username: user[0]?.username ?? "anon",
      content,
      expiresAt: Date.now() + s.pinDurationSec * 1000,
      payTxHash: msg.payTxHash,
    };
    const key = pinsKey(msg.room);
    await redis.zadd(key, pin.expiresAt, JSON.stringify(pin));
    // 上限:挤掉最早过期的
    const count = await redis.zcard(key);
    if (count > s.pinMax) await redis.zremrangebyrank(key, 0, count - s.pinMax - 1);
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
    const [chainIdStr, token] = msg.room.split(":");
    const chainId = Number(chainIdStr);
    const walletHint = typeof msg.wallet === "string" ? msg.wallet.toLowerCase() : "";
    const wallet = ctx.wallet
      ?? user[0]?.walletAddress?.toLowerCase()
      ?? (/^0x[0-9a-f]{40}$/.test(walletHint) ? walletHint : "");
    let buyEth = 0;
    if (wallet && token && token !== "global" && Number.isFinite(chainId)) {
      buyEth = await totalBoughtEth(db, chainId, wallet, token).catch(() => 0);
    }
    emit(msg.room, {
      t: "danmaku",
      room: msg.room,
      id: crypto.randomUUID(),
      username: user[0]?.username ?? "anon",
      content,
      buyEth,
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
