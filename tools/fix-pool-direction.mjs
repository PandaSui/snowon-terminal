/**
 * 一次性修复:pool 阶段交易方向判反(2026-09-03)。
 *
 * 本链 PoolManager 的 Swap amount0/amount1 是调用方视角,旧代码按池子视角
 * 判定,导致 phase='pool' 的 buy/sell 全部写反,positions 也随之算反。
 *
 * 本脚本:
 *   1. 翻转 trades 中 pool 阶段买/卖(含 kind)
 *   2. 按时间顺序重放全部买/卖,重建 positions(加权平均成本,逻辑同 indexer/pnl.ts)
 *
 * 用法: node tools/fix-pool-direction.mjs
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/terminal", {
  max: 1,
});

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 4663);

const flipped = await sql`
  UPDATE trades
  SET is_buy = NOT is_buy,
      kind = CASE kind WHEN 'buy' THEN 'sell' WHEN 'sell' THEN 'buy' ELSE kind END
  WHERE chain_id = ${CHAIN_ID} AND phase = 'pool' AND kind IN ('buy', 'sell')
`;
console.log(`flipped pool trades: ${flipped.count}`);

// ── 重放重建 positions ──
const rows = await sql`
  SELECT wallet_trader AS trader, token_address, is_buy, eth_amount::text AS eth, token_amount::text AS tok,
         block_timestamp, first_ts
  FROM (
    SELECT trader AS wallet_trader, token_address, is_buy, eth_amount, token_amount,
           block_timestamp, min(block_timestamp) OVER () AS first_ts
    FROM trades
    WHERE chain_id = ${CHAIN_ID} AND kind IN ('buy', 'sell')
    ORDER BY block_timestamp ASC, log_index ASC
  ) s
`;

/** key = wallet:token */
const pos = new Map();

for (const r of rows) {
  const key = `${r.trader}:${r.token_address}`;
  let p = pos.get(key);
  if (!p) {
    p = {
      chainId: CHAIN_ID,
      wallet: r.trader,
      token: r.token_address,
      balance: 0n,
      cost: 0n,
      realized: 0n,
      totalBought: 0n,
      totalSold: 0n,
      buyCount: 0,
      sellCount: 0,
      firstBuyAt: null,
      lastTradeAt: r.block_timestamp,
    };
    pos.set(key, p);
  }
  const tok = BigInt(r.tok);
  const eth = BigInt(r.eth);
  p.lastTradeAt = r.block_timestamp;
  if (r.is_buy) {
    p.balance += tok;
    p.cost += eth;
    p.totalBought += eth;
    p.buyCount += 1;
    if (!p.firstBuyAt) p.firstBuyAt = r.block_timestamp;
  } else {
    // 卖出:按比例结转成本;持仓为 0(转入获得)时成本按 0,eth 全计 realized
    if (p.balance > 0n && tok > 0n) {
      const sold = tok > p.balance ? p.balance : tok;
      const carry = (p.cost * sold) / p.balance;
      p.realized += eth - carry;
      p.cost -= carry;
      p.balance -= sold;
      if (p.cost < 0n) p.cost = 0n;
    } else {
      p.realized += eth;
    }
    p.totalSold += eth;
    p.sellCount += 1;
  }
}

await sql.begin(async (tx) => {
  await tx`DELETE FROM positions WHERE chain_id = ${CHAIN_ID}`;
  const batch = [...pos.values()].map((p) => ({
    chain_id: p.chainId,
    wallet: p.wallet,
    token_address: p.token,
    balance: p.balance.toString(),
    cost_basis_eth: p.cost.toString(),
    realized_pnl_eth: p.realized.toString(),
    total_bought_eth: p.totalBought.toString(),
    total_sold_eth: p.totalSold.toString(),
    buy_count: p.buyCount,
    sell_count: p.sellCount,
    first_buy_at: p.firstBuyAt,
    last_trade_at: p.lastTradeAt,
  }));
  for (let i = 0; i < batch.length; i += 500) {
    await tx`INSERT INTO positions ${tx(batch.slice(i, i + 500))}`;
  }
});
console.log(`rebuilt positions: ${pos.size}`);

// 抽查 PANDA 前几大持仓
const top = await sql`
  SELECT wallet, (balance::numeric / 1e18)::text AS bal
  FROM positions
  WHERE chain_id = ${CHAIN_ID} AND token_address = '0x4c67b87b83437c698a8a3a3777f20d81c58d8888'
  ORDER BY balance::numeric DESC LIMIT 8
`;
console.log("PANDA top holders after rebuild:", top);

await sql.end();
