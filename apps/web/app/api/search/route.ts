import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

/**
 * 全局搜索:三路识别。
 *  - 0x + 40hex:查代币合约(命中→可跳转代币页),同时提示可作为钱包地址追踪
 *  - 其他:按代币名/符号模糊匹配
 */
export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (!q) return NextResponse.json({ kind: "empty", tokens: [] });

    if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
      const res = await db.execute(sql`
        SELECT t.address, t.name, t.symbol, t.logo_uri AS "logoUri", t.graduated
        FROM tokens t
        WHERE t.chain_id = ${CHAIN_ID} AND lower(t.address) = ${q.toLowerCase()}
        LIMIT 1
      `);
      const rows = res as unknown as Record<string, unknown>[];
      return NextResponse.json({ kind: "address", tokens: rows, isToken: rows.length > 0, address: q.toLowerCase() });
    }

    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const res = await db.execute(sql`
      SELECT t.address, t.name, t.symbol, t.logo_uri AS "logoUri", t.graduated
      FROM tokens t
      WHERE t.chain_id = ${CHAIN_ID}
        AND (t.name ILIKE ${like} OR t.symbol ILIKE ${like})
      ORDER BY t.created_at DESC
      LIMIT 8
    `);
    return NextResponse.json({ kind: "text", tokens: res as unknown as Record<string, unknown>[] });
  } catch (e) {
    return apiError(e);
  }
}
