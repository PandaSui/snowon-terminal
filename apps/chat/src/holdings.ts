import { sql } from "drizzle-orm";
import type { Db } from "@terminal/db";

/**
 * 持仓徽章:某钱包在该代币的持仓占流通盘比例(bps,万分比)。
 * 流通盘 ≈ positions 表 balance 总和(索引器覆盖全部买卖,毕业后转账
 * 未跟踪,存在偏差——精确值需要索引 token Transfer 事件,留作增强)。
 * 返回 null 表示无持仓或不展示。
 */
export async function holdingShareBps(
  db: Db,
  chainId: number,
  wallet: string,
  token: string,
): Promise<number | null> {
  const rows = (await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN wallet = ${wallet.toLowerCase()} THEN balance::numeric ELSE 0 END), 0) AS mine,
      COALESCE(SUM(balance::numeric), 0) AS total
    FROM positions
    WHERE chain_id = ${chainId} AND token_address = ${token.toLowerCase()}
  `)) as unknown as Array<{ mine: string; total: string }>;
  const { mine, total } = rows[0];
  const t = Number(total);
  if (t === 0) return null;
  return Math.round((Number(mine) / t) * 10_000);
}

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

/** 某钱包在该代币上累计买入的 ETH(whole,非 wei)。无记录返回 0。 */
export async function totalBoughtEth(
  db: Db,
  chainId: number,
  wallet: string,
  token: string,
): Promise<number> {
  const rows = asRows<{ eth: string }>(
    await db.execute(sql`
      SELECT coalesce(total_bought_eth::numeric / 1e18, 0)::text AS eth
      FROM positions
      WHERE chain_id = ${chainId}
        AND wallet = ${wallet.toLowerCase()}
        AND token_address = ${token.toLowerCase()}
      LIMIT 1
    `),
  );
  const n = Number(rows[0]?.eth ?? 0);
  return Number.isFinite(n) ? n : 0;
}
