import type { PublicClient } from "viem";
import { eq, and, isNull } from "drizzle-orm";
import type { Db } from "@terminal/db";
import { wallets } from "@terminal/db";

/**
 * 资金来源回填:为每个新钱包找"第一笔入账原生币"的来源。
 * 用 trace_filter(若 RPC 支持)或扫转账;拿不到则标记 null,由离线任务补。
 *
 * 优先级:RPC debug/trace 命名空间 → 跳过(慢链上 EOA 第一笔通常是 CEX 提币)。
 * 同一地址每进程只查一次,且不阻塞成交入库。
 */
const checked = new Set<string>();

export async function backfillFirstFunder(
  db: Db,
  client: PublicClient,
  chainId: number,
  address: string,
): Promise<void> {
  const addr = address.toLowerCase();
  const key = `${chainId}:${addr}`;
  if (checked.has(key)) return;
  checked.add(key);
  if (checked.size > 200_000) {
    checked.clear();
    checked.add(key);
  }

  try {
    const [existing] = await db
      .select({ firstFunder: wallets.firstFunder })
      .from(wallets)
      .where(and(eq(wallets.chainId, chainId), eq(wallets.address, addr)))
      .limit(1);
    if (existing?.firstFunder) return;

    // trace_filter: 找 to == address 的第一笔 value > 0 调用(非标准 RPC,绕过类型)
    const rawRequest = client.request as (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    const traces = (await rawRequest({
      method: "trace_filter",
      params: [{ toAddress: [addr], fromBlock: "0x0" }],
    })) as Array<{ transactionHash: string; action: { from: string; value: string }; blockNumber: number }>;

    const first = traces
      .filter((t) => BigInt(t.action.value ?? "0x0") > 0n)
      .sort((a, b) => a.blockNumber - b.blockNumber)[0];

    if (!first) return;
    const block = await client.getBlock({ blockNumber: BigInt(first.blockNumber) });
    await db
      .update(wallets)
      .set({
        firstFunder: first.action.from.toLowerCase(),
        firstFundTx: first.transactionHash,
        firstFundAt: new Date(Number(block.timestamp) * 1000),
      })
      .where(and(eq(wallets.chainId, chainId), eq(wallets.address, addr), isNull(wallets.firstFunder)));
  } catch {
    // RPC 不支持 trace_filter:留给离线回填任务
  }
}
