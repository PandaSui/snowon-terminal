import { type Address, type Hex } from "viem";
import { poolIdOf } from "../snowon/adapter.js";

/**
 * Fast Launch:SNOW 配对、SnowConfigHook 池、无绑定曲线——一发射就是 V4 池
 * (等价于 SnowOn/Pons 的"已毕业"状态)。池参数是全平台固定常量,不需要每个 token
 * 去查 factory,poolId 纯本地计算即可。这里只提供索引所需的 env/DB 配置解析和
 * poolId 计算;终端内买卖 Fast Launch 币需要单独的 adapter(暂未做)。
 */

export interface FastEnv {
  wrapper: Address; // SnowLaunchWrapper(发射入口,emit Launched)
  hook: Address; // SnowConfigHook(池 hook,也是 poolId 的一部分)
  poolManager: Address;
  deployBlock: bigint;
}

export const DEFAULT_FAST_WRAPPER = "0x049a3af1535953e47a6e9b66b6c1d15899029a7c" as Address;
export const DEFAULT_FAST_HOOK = "0x7aad32eefe9007acef8b0f1950750de772edeacc" as Address;
export const DEFAULT_FAST_DEPLOY_BLOCK = 65_433_000n;

/** SNOW 代币(Fast Launch 的固定报价资产);与 @terminal/db settings.SNOW_TOKEN 一致。 */
export const FAST_QUOTE = "0xb851cebcbcf1dc5f07d9f0a8276cae8d953b3713" as Address;
/** Fast Launch 池:SNOW 配对,SnowConfigHook,fee/spacing 全平台固定。 */
export const FAST_POOL_FEE = 2500;
export const FAST_POOL_SPACING = 25;
/**
 * ETH/SNOW 裸参考池(hooks=0x0):所有 SNOW 计价资产共用同一个,用来把 Fast Launch
 * 池的 SNOW 腿换算成 ETH。链上核实:所有 SNOW 计价的 SnowOn 曲线合约都返回
 * quoteEthFee=2500 / quoteEthSpacing=50。Fast Launch 没有曲线合约,故在此写死。
 */
export const SNOW_ETH_POOL_FEE = 2500;
export const SNOW_ETH_POOL_SPACING = 50;

const ADDR_OK = /^0x[0-9a-fA-F]{40}$/;

export function loadFastEnv(chainId: number, poolManagerHint?: Address): FastEnv | null {
  const wrapper = (process.env[`FAST_WRAPPER_${chainId}`] ?? DEFAULT_FAST_WRAPPER) as string;
  const hook = (process.env[`FAST_HOOK_${chainId}`] ?? DEFAULT_FAST_HOOK) as string;
  const poolManager = (process.env[`SNOWON_POOL_MANAGER_${chainId}`] ?? poolManagerHint ?? "") as string;
  if (!ADDR_OK.test(wrapper) || !ADDR_OK.test(poolManager)) return null;
  return {
    wrapper: wrapper.toLowerCase() as Address,
    hook: (ADDR_OK.test(hook) ? hook : DEFAULT_FAST_HOOK).toLowerCase() as Address,
    poolManager: poolManager.toLowerCase() as Address,
    deployBlock: BigInt(process.env[`FAST_DEPLOY_BLOCK_${chainId}`] ?? DEFAULT_FAST_DEPLOY_BLOCK.toString()),
  };
}

/** DB 覆盖 env:管理面板保存的 Fast 地址优先;再回退已知主网默认值。0 起始块视为未填。 */
export function mergeFastConfig(
  chainId: number,
  poolManager: Address,
  dbRow?: { fastWrapper?: string | null; fastHook?: string | null; fastDeployBlock?: bigint | number | string | null },
): FastEnv | null {
  const env = loadFastEnv(chainId, poolManager);
  const wrapper = (dbRow?.fastWrapper && ADDR_OK.test(dbRow.fastWrapper)
    ? dbRow.fastWrapper
    : env?.wrapper ?? DEFAULT_FAST_WRAPPER) as string;
  if (!ADDR_OK.test(wrapper)) return null;
  const hook = (dbRow?.fastHook && ADDR_OK.test(dbRow.fastHook)
    ? dbRow.fastHook
    : env?.hook ?? DEFAULT_FAST_HOOK) as string;
  const deployRaw = dbRow?.fastDeployBlock;
  let deployBlock = env?.deployBlock ?? DEFAULT_FAST_DEPLOY_BLOCK;
  if (deployRaw != null && String(deployRaw) !== "") {
    const n = BigInt(String(deployRaw).split(".")[0] || "0");
    if (n > 0n) deployBlock = n;
  }
  const pm = (ADDR_OK.test(poolManager) ? poolManager : env?.poolManager) as string | undefined;
  if (!pm || !ADDR_OK.test(pm)) return null;
  return {
    wrapper: wrapper.toLowerCase() as Address,
    hook: hook.toLowerCase() as Address,
    poolManager: pm.toLowerCase() as Address,
    deployBlock,
  };
}

/** Fast Launch 池 id — SNOW 配对、SnowConfigHook、fee 2500/spacing 25。纯计算,无链上调用。 */
export function poolIdOfFastToken(token: Address, hook: Address): Hex {
  const t = token.toLowerCase() as Address;
  const tokenIsC0 = BigInt(t) < BigInt(FAST_QUOTE);
  return poolIdOf({
    currency0: tokenIsC0 ? t : FAST_QUOTE,
    currency1: tokenIsC0 ? FAST_QUOTE : t,
    fee: FAST_POOL_FEE,
    tickSpacing: FAST_POOL_SPACING,
    hooks: hook,
  });
}
