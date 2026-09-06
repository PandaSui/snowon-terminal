import path from "node:path";
import { createRequire } from "node:module";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzleLite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export * from "./settings.js";

export type Db = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/**
 * createRequire / require.resolve 必须懒执行:在模块顶层,打包器(Next.js/
 * webpack)会把 import.meta.url 换成数字模块 ID,createRequire(number) 会抛
 * "path must be string"。只有 pglite 本地开发路径才需要它们,按需创建即可。
 */
function nodeRequire(): NodeRequire {
  return createRequire(import.meta.url);
}
/** 仓库根目录下的本地数据目录(PGlite 落盘位置) */
function localDataDir(): string {
  const pkgDir = path.dirname(nodeRequire().resolve("@terminal/db/package.json"));
  return path.resolve(pkgDir, "../../.data/pglite");
}

function migrationsFolder(): string {
  const pkgDir = path.dirname(nodeRequire().resolve("@terminal/db/package.json"));
  return path.join(pkgDir, "migrations");
}

let liteInstance: PgliteDatabase<typeof schema> | null = null;
let liteReady: Promise<unknown> | null = null;

type PgCache = {
  __terminalPgSql?: ReturnType<typeof postgres>;
  __terminalPgDb?: PostgresJsDatabase<typeof schema>;
};
const g = globalThis as typeof globalThis & PgCache;

/**
 * 创建数据库连接。
 *  - DATABASE_URL=postgres://... → 真实 Postgres(生产)
 *  - DATABASE_URL 未设置或 = "pglite" → 内嵌 PGlite(本地零安装开发),
 *    首次启动自动应用 packages/db/migrations 下的迁移。
 *
 * Next.js 会按路由拆包,必须挂 globalThis,否则每个 API 文件各开一个连接池,
 * 把内嵌 Postgres 的 max_connections 打满后表现为 ECONNRESET / 空 500。
 */
export function createDb(databaseUrl?: string): Db {
  if (databaseUrl && databaseUrl !== "pglite") {
    if (!g.__terminalPgDb) {
      g.__terminalPgSql = postgres(databaseUrl, {
        max: 8,
        idle_timeout: 20,
        connect_timeout: 10,
        max_lifetime: 60 * 30,
      });
      g.__terminalPgDb = drizzlePg(g.__terminalPgSql, { schema });
    }
    return g.__terminalPgDb;
  }
  // PGlite 单进程单实例(WASM 实例重复打开同一数据目录会锁冲突)
  if (liteInstance) return liteInstance;
  const { PGlite } = nodeRequire()("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const client = new PGlite(localDataDir());
  const db = drizzleLite(client, { schema });
  liteReady = client.waitReady.then(() => migrateLite(db, { migrationsFolder: migrationsFolder() }));
  liteInstance = db;
  return db;
}

/** PGlite 模式下等待迁移完成(postgres 模式立即 resolve) */
export async function dbReady(db: Db): Promise<void> {
  if (liteReady) await liteReady;
}
