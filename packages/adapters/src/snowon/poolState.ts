import { type Address, type Hex, type PublicClient, encodeAbiParameters, keccak256 } from "viem";
import { poolManagerAbi } from "./abis.js";

/**
 * UniV4 StateLibrary.POOLS_SLOT —— pools 映射在 PoolManager 存储中的槽号。
 * mapping(bytes32 => Pool.State) pools 位于 slot 6,
 * Pool.State.slot0 是结构体第 0 个槽,所以:
 *   slot0Slot = keccak256(abi.encode(poolId, 6))
 */
const POOLS_SLOT = 6n;
const MASK_160 = (1n << 160n) - 1n;

/**
 * 读取池子 slot0.sqrtPriceX96。
 *
 * 背景:该链(Robinhood Chain, chainId 4663)上的 PoolManager 是标准 V4 实现,
 * 合约本身只有 extsload 裸存储读取;getSlot0 是外围 StateView 合约的函数,
 * 链上直接对 PM 调 getSlot0 会 revert。因此先走 extsload 解包 slot0
 * (位布局:[0:160) sqrtPriceX96, [160:184) tick, [184:208) protocolFee,
 * [208:232) lpFee),失败再退回 getSlot0 以兼容非标准 PM。
 *
 * 返回 null 表示池子未初始化或读取失败。
 */
export async function readPoolSqrtP(
  client: PublicClient,
  poolManager: Address,
  poolId: Hex,
): Promise<bigint | null> {
  try {
    const slot = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, POOLS_SLOT]),
    );
    const word = await client.readContract({
      address: poolManager,
      abi: poolManagerAbi,
      functionName: "extsload",
      args: [slot],
    });
    const sqrtP = BigInt(word) & MASK_160;
    return sqrtP > 0n ? sqrtP : null;
  } catch {
    /* PM 不支持 extsload,退回 getSlot0 */
  }
  try {
    const [sqrtP] = await client.readContract({
      address: poolManager,
      abi: poolManagerAbi,
      functionName: "getSlot0",
      args: [poolId],
    });
    return sqrtP > 0n ? sqrtP : null;
  } catch {
    return null;
  }
}

/**
 * 读取池子流动性。Pool.State 布局:slot0(1 槽)→ feeGrowthGlobal0X128(1 槽)
 * → feeGrowthGlobal1X128(1 槽)→ liquidity(uint128,第 3 槽)。
 * 先 extsload 读裸槽,失败再退回 getLiquidity。
 */
export async function readPoolLiquidity(
  client: PublicClient,
  poolManager: Address,
  poolId: Hex,
): Promise<bigint> {
  try {
    const slot = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, POOLS_SLOT]),
    );
    const word = await client.readContract({
      address: poolManager,
      abi: poolManagerAbi,
      functionName: "extsload",
      args: [(`0x${(BigInt(slot) + 3n).toString(16).padStart(64, "0")}`) as Hex],
    });
    return BigInt(word) & ((1n << 128n) - 1n);
  } catch {
    /* fall through */
  }
  try {
    return await client.readContract({
      address: poolManager,
      abi: poolManagerAbi,
      functionName: "getLiquidity",
      args: [poolId],
    });
  } catch {
    return 0n;
  }
}
