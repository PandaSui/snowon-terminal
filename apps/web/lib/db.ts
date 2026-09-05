import { createDb, type Db } from "@terminal/db";

/**
 * 懒加载的 DB 句柄。createDb() 推迟到第一次真正查询时才执行,好处:
 *  - `next build` 收集 /api 路由页面数据时不会连库、也不会拉 pglite
 *    (DATABASE_URL 未设时),否则构建期就崩;
 *  - 只跑前端的部署(Vercel)从不调用这些 /api 路由 → 永不碰数据库。
 * 后端(EC2)有 DATABASE_URL,首次查询时正常建 postgres 连接。
 */
let _db: Db | null = null;
export const db = new Proxy({} as Db, {
  get(_t, prop) {
    if (!_db) _db = createDb(process.env.DATABASE_URL);
    const v = (_db as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(_db) : v;
  },
});

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
