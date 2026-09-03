import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@terminal/db";
import { positions, wallets } from "@terminal/db";

/**
 * PNL 滚动更新(加权平均成本法):
 *  买入: balance += amount; costBasis += ethIn
 *  卖出: realized += ethOut − costBasis × (sold/balanceBefore); costBasis 按比例结转
 */
export async function applyTradeToPosition(
  db: Db,
  args: {
    chainId: number;
    wallet: string;
    token: string;
    isBuy: boolean;
    tokenAmount: bigint;
    ethAmount: bigint;
    blockTimestamp: Date;
  },
) {
  const { chainId, wallet, token, isBuy, tokenAmount, ethAmount } = args;
  const ts = args.blockTimestamp.toISOString();

  // 持仓与钱包写入彼此独立,不必包事务(少一轮 BEGIN/COMMIT)
  await db.execute(sql`
    INSERT INTO positions (chain_id, wallet, token_address, balance, cost_basis_eth,
      realized_pnl_eth, total_bought_eth, total_sold_eth, buy_count, sell_count,
      first_buy_at, last_trade_at)
    VALUES (${chainId}, ${wallet}, ${token},
      ${isBuy ? tokenAmount.toString() : "0"},
      ${isBuy ? ethAmount.toString() : "0"},
      '0',
      ${isBuy ? ethAmount.toString() : "0"},
      ${isBuy ? "0" : ethAmount.toString()},
      ${isBuy ? 1 : 0}, ${isBuy ? 0 : 1},
      ${isBuy ? ts : null}, ${ts})
    ON CONFLICT (chain_id, wallet, token_address) DO UPDATE SET
      balance = positions.balance::numeric
        ${sql.raw(isBuy ? "+" : "-")} ${tokenAmount.toString()},
      cost_basis_eth = ${sql.raw(
        isBuy
          ? `COALESCE(positions.cost_basis_eth::numeric, 0) + ${ethAmount.toString()}`
          // 卖出:按卖出比例结转成本;持仓为 0(买入未被索引/转入获得)时成本按 0 处理
          : `GREATEST(COALESCE(positions.cost_basis_eth::numeric, 0) -
              COALESCE(positions.cost_basis_eth::numeric * ${tokenAmount.toString()} /
               NULLIF(positions.balance::numeric, 0), 0), 0)`,
      )},
      realized_pnl_eth = ${sql.raw(
        isBuy
          ? `positions.realized_pnl_eth`
          : `COALESCE(positions.realized_pnl_eth::numeric, 0) + ${ethAmount.toString()} -
              COALESCE(positions.cost_basis_eth::numeric * ${tokenAmount.toString()} /
               NULLIF(positions.balance::numeric, 0), 0)`,
      )},
      total_bought_eth = COALESCE(positions.total_bought_eth::numeric, 0) + ${isBuy ? ethAmount.toString() : "0"},
      total_sold_eth = COALESCE(positions.total_sold_eth::numeric, 0) + ${isBuy ? "0" : ethAmount.toString()},
      buy_count = positions.buy_count + ${isBuy ? 1 : 0},
      sell_count = positions.sell_count + ${isBuy ? 0 : 1},
      first_buy_at = COALESCE(positions.first_buy_at, ${isBuy ? ts : null}),
      last_trade_at = ${ts}
  `);

  await db
    .insert(wallets)
    .values({
      chainId,
      address: wallet.toLowerCase(),
      firstSeenAt: args.blockTimestamp,
      lastSeenAt: args.blockTimestamp,
    })
    .onConflictDoUpdate({
      target: [wallets.chainId, wallets.address],
      set: { lastSeenAt: args.blockTimestamp },
    });
}

/** 未实现 PNL = balance × 现价 − costBasis(查询时算,不落库) */
export async function unrealizedPnl(db: Db, chainId: number, wallet: string, token: string, priceEth: bigint) {
  const [row] = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.chainId, chainId),
        eq(positions.wallet, wallet.toLowerCase()),
        eq(positions.tokenAddress, token.toLowerCase()),
      ),
    )
    .limit(1);
  if (!row) return 0n;
  const balance = BigInt(row.balance);
  const cost = BigInt(row.costBasisEth);
  return (balance * priceEth) / 10n ** 18n - cost;
}
