import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { authNonces } from "./schema.js";
import * as schema from "./schema.js";

type Db = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

const SESSION_TTL_SEC = 6 * 3600; // 会话 6 小时
function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
}
const b64url = (b: Buffer) => b.toString("base64url");

/** 签发会话令牌:HMAC-SHA256(payload={addr,exp})。地址已是验签得到的可信地址。 */
export function signSession(addr: string, ttlSec = SESSION_TTL_SEC): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ addr: addr.toLowerCase(), exp: Math.floor(Date.now() / 1000) + ttlSec })),
  );
  const sig = b64url(createHmac("sha256", secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

/** 校验会话令牌,合法且未过期则返回地址(小写),否则 null。 */
export function verifySession(token: string | undefined | null): string | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expect = b64url(createHmac("sha256", secret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { addr, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { addr: string; exp: number };
    if (typeof addr !== "string" || typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) return null;
    return addr.toLowerCase();
  } catch {
    return null;
  }
}

/** 发一个一次性 nonce(存 DB,5 分钟有效);顺手清过期。 */
export async function issueNonce(db: Db): Promise<string> {
  const nonce = randomBytes(24).toString("hex");
  await db.delete(authNonces).where(lt(authNonces.expiresAt, new Date()));
  await db.insert(authNonces).values({ nonce, expiresAt: new Date(Date.now() + 5 * 60_000) });
  return nonce;
}

/** 消费 nonce(存在且未过期→删除并返回 true;一次性,防重放)。 */
export async function consumeNonce(db: Db, nonce: string): Promise<boolean> {
  const rows = await db
    .delete(authNonces)
    .where(and(eq(authNonces.nonce, nonce), gt(authNonces.expiresAt, new Date())))
    .returning();
  return rows.length > 0;
}
