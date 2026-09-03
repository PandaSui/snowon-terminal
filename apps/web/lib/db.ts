import { createDb } from "@terminal/db";

/** Next.js API 共用一个连接(真正的池化在 createDb 的 globalThis 单例里) */
export const db = createDb(process.env.DATABASE_URL!);
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
