import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@terminal/db";
import { bundleScores, trades } from "@terminal/db";

/**
 * 捆绑/老鼠仓评分(0-100,越高越可疑)。四个信号加权:
 *  - 启动窗口买入占比(前 5 个区块)
 *  - 早期买家资金来源相同(firstFunder 聚类)占比
 *  - creator 自买占比
 *  - Top10 持仓占比(由 positions 表算)
 * 注:antiBundle 代币启动块禁买,天然压低第一个信号——评分输入包含该标志的由调用方处理。
 */
export async function computeBundleScore(db: Db, chainId: number, token: string, createdAtBlock: bigint) {
  const windowEnd = createdAtBlock + 5n;

  const [totals] = await db
    .select({
      totalEth: sql<string>`COALESCE(SUM(eth_amount::numeric), 0)`,
      earlyEth: sql<string>`COALESCE(SUM(CASE WHEN block_number <= ${windowEnd.toString()} THEN eth_amount::numeric ELSE 0 END), 0)`,
    })
    .from(trades)
    .where(and(eq(trades.chainId, chainId), eq(trades.tokenAddress, token), eq(trades.isBuy, true)));

  const totalEth = Number(totals.totalEth);
  const earlyEth = Number(totals.earlyEth);
  if (totalEth === 0) return;

  const launchBlockBuyShare = earlyEth / totalEth;

  // 资金来源聚类:早期买家(前 5 块)按 firstFunder 分组的最大簇占比
  const funderRows = (await db.execute(sql`
    SELECT w.first_funder, SUM(t.eth_amount::numeric) AS eth
    FROM trades t
    JOIN wallets w ON w.chain_id = t.chain_id AND w.address = t.trader
    WHERE t.chain_id = ${chainId} AND t.token_address = ${token}
      AND t.is_buy AND t.block_number <= ${windowEnd.toString()}
    GROUP BY w.first_funder
    ORDER BY eth DESC
    LIMIT 1
  `)) as unknown as Array<{ eth: string }>;
  const topFunderEth = funderRows.length ? Number(funderRows[0].eth) : 0;
  const sameFunderShare = earlyEth > 0 ? topFunderEth / earlyEth : 0;

  // creator 自买(创建交易的 creator 在启动窗口内的买入)
  // creator 地址从 tokens 表取,这里简化为查询参数外的联表
  const creatorRows = (await db.execute(sql`
    SELECT COALESCE(SUM(t.eth_amount::numeric), 0) AS eth
    FROM trades t
    JOIN tokens tk ON tk.chain_id = t.chain_id AND tk.address = t.token_address
    WHERE t.chain_id = ${chainId} AND t.token_address = ${token}
      AND t.is_buy AND t.trader = tk.creator
  `)) as unknown as Array<{ eth: string }>;
  const creatorBuyShare = totalEth > 0 ? Number(creatorRows[0].eth) / totalEth : 0;

  // Top10 持仓占比
  const holderRows = (await db.execute(sql`
    SELECT SUM(balance::numeric) AS top10 FROM (
      SELECT balance FROM positions
      WHERE chain_id = ${chainId} AND token_address = ${token} AND balance::numeric > 0
      ORDER BY balance::numeric DESC LIMIT 10
    ) t
  `)) as unknown as Array<{ top10: string | null }>;
  const totalHeldRows = (await db.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN balance::numeric > 0 THEN balance::numeric ELSE 0 END), 0) AS total
    FROM positions
    WHERE chain_id = ${chainId} AND token_address = ${token}
  `)) as unknown as Array<{ total: string }>;
  const top10 = Number(holderRows[0].top10 ?? 0);
  const totalHeld = Number(totalHeldRows[0].total);
  const top10HolderShare = totalHeld > 0 ? top10 / totalHeld : 0;

  // 份额本应 0-1,写 numeric(6,4)。既有 PNL 问题会让 positions 出现负 balance,拉低
  // totalHeld,使 top10HolderShare 远超 1 → 写入溢出(22003)。分母已改为只算正持仓,
  // 这里再统一 clamp 到 [0,1] 兜底,score 也用 clamp 后的值,避免虚高。
  const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
  const lbShare = clamp01(launchBlockBuyShare);
  const sfShare = clamp01(sameFunderShare);
  const cbShare = clamp01(creatorBuyShare);
  const t10Share = clamp01(top10HolderShare);

  const score = Math.min(
    100,
    Math.round(100 * (0.35 * lbShare + 0.3 * sfShare + 0.15 * cbShare + 0.2 * t10Share)),
  );

  const cols = {
    score,
    launchBlockBuyShare: lbShare.toFixed(4),
    sameFunderShare: sfShare.toFixed(4),
    creatorBuyShare: cbShare.toFixed(4),
    top10HolderShare: t10Share.toFixed(4),
    computedAt: new Date(),
  };
  await db
    .insert(bundleScores)
    .values({ chainId, tokenAddress: token, ...cols })
    .onConflictDoUpdate({
      target: [bundleScores.chainId, bundleScores.tokenAddress],
      set: cols,
    });
}

/** 距创建满 N 个区块后触发评分(由 worker 定时调用) */
export async function rescoreRecentTokens(db: Db, chainId: number) {
  // 新币(2h)每次都算;其余 7 天内代币若 30 分钟内已评分则跳过
  const rows = (await db.execute(sql`
    SELECT t.address, t.created_at_block
    FROM tokens t
    LEFT JOIN bundle_scores b
      ON b.chain_id = t.chain_id AND b.token_address = t.address
    WHERE t.chain_id = ${chainId}
      AND t.created_at > NOW() - INTERVAL '7 days'
      AND (
        t.created_at > NOW() - INTERVAL '2 hours'
        OR b.computed_at IS NULL
        OR b.computed_at < NOW() - INTERVAL '30 minutes'
      )
  `)) as unknown as Array<{ address: string; created_at_block: string }>;
  const CONC = 4;
  for (let i = 0; i < rows.length; i += CONC) {
    await Promise.all(
      rows.slice(i, i + CONC).map((r) => computeBundleScore(db, chainId, r.address, BigInt(r.created_at_block))),
    );
  }
}
