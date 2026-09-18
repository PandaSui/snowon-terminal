import {
  type Address,
  type Hex,
  type PublicClient,
  encodeFunctionData,
  zeroAddress,
} from "viem";
import type { CurveState, GraduationStatus, LaunchpadAdapter, Quote, TxRequest } from "../types.js";
import { erc20Abi, snowSwapRouterAbi } from "../snowon/abis.js";
import { poolIdOf } from "../snowon/adapter.js";
import { readPoolSqrtP } from "../snowon/poolState.js";
import { poolPriceEth, sqrtPToRawPrice } from "../snowon/curveMath.js";
import {
  FAST_QUOTE,
  FAST_POOL_FEE,
  FAST_POOL_SPACING,
  SNOW_ETH_POOL_FEE,
  SNOW_ETH_POOL_SPACING,
  poolIdOfFastToken,
} from "./adapter.js";

const E18 = 10n ** 18n;
const MAX_UINT256 = (1n << 256n) - 1n;
const SQRTP_TTL_MS = 2_000;
/**
 * Fast 池 hook(SnowConfigHook)固定协议费,25 bps = 0.25%。
 * 注意与 SnowOnAdapter.quoteOnPool 里硬编码的 100(1%)不是同一个数:那是 SnowOn 毕业后
 * 图池用的 SnowLaunchHook(曲线毕业专用 hook)的费率,SnowConfigHook 是从它剥离曲线/毕业
 * 逻辑后的独立合约,协议费改成了固定 0.25%(每笔另收创作者 0-5% 版税,即下面的 buy/sellTaxBps)。
 * 只影响报价展示精度,不影响交易构造。
 */
const HOOK_PROTOCOL_BPS = 25;

interface PoolKeyStruct {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/**
 * 终端 DB 行提示:Fast Launch 币的 buy/sellTaxBps(来自 SnowLaunchWrapper.Launched 事件,
 * 链上没有独立的曲线/配置合约可查,只能从索引落库的 tokens 表回填)。不 hint 时按 0 处理,
 * 报价会偏乐观(展示级估算本就不含冲击,这里再少算一点税费,不影响交易构造的正确性)。
 */
export type FastTokenHint = {
  buyTaxBps?: number | null;
  sellTaxBps?: number | null;
};

/**
 * Fast Launch 适配器。SNOW 配对、SnowConfigHook 池、无绑定曲线——一发射即 V4 池,
 * 等价于 SnowOn/Pons 的"已毕业"状态,交易恒打 SnowSwapRouter.swapExactIn:
 *   买: 付 ETH → (ETH/SNOW 裸参考池) → SNOW → (Fast 池) → TOKEN,两跳
 *   卖: TOKEN → (Fast 池) → SNOW → (ETH/SNOW 裸参考池) → ETH,两跳
 * 池参数是全平台固定常量(见 ./adapter.ts 的 FAST_QUOTE/FAST_POOL_FEE/...),两个 PoolKey
 * 纯本地计算即可拼出,不需要任何链上查询——这是与 SnowOnAdapter 毕业后分支最大的不同:
 * SnowOn 每个 token 的 quote 资产/费率可能不同,必须先 await curveParams()/gradPoolKey();
 * Fast 全平台共享同一套 quote/fee/spacing,buildBuyTx/buildSellTx 里完全不用 await 链上数据。
 */
export class FastLaunchAdapter implements LaunchpadAdapter {
  readonly platformId = "fast";
  private readonly hints = new Map<string, FastTokenHint>();
  private readonly sqrtPCache = new Map<string, { at: number; v: bigint | null }>();

  constructor(
    public readonly chainId: number,
    private readonly client: PublicClient,
    private readonly hook: Address,
    private readonly poolManager: Address,
    private readonly swapRouter: Address,
  ) {}

  /** 用 tokens 表字段预热(buy/sellTaxBps),报价不用再猜测费率。 */
  hint(token: Address, h: FastTokenHint): void {
    this.hints.set(token.toLowerCase(), h);
  }

  // ────────────────────────── PoolKey(纯本地计算) ──────────────────────────

  /**
   * Fast 池 PoolKey:TOKEN/SNOW,SnowConfigHook,fee 2500/spacing 25。
   * currency0/1 排序逻辑与 ./adapter.ts 的 poolIdOfFastToken 逐字一致(同一个 BigInt 比较),
   * 保证这里拼出的 key 哈希出的 poolId 与 getGraduationStatus/索引器落库的 poolId 完全相同。
   */
  private fastPoolKeyOf(token: Address): PoolKeyStruct {
    const t = token.toLowerCase() as Address;
    const tokenIsC0 = BigInt(t) < BigInt(FAST_QUOTE);
    return {
      currency0: tokenIsC0 ? t : FAST_QUOTE,
      currency1: tokenIsC0 ? FAST_QUOTE : t,
      fee: FAST_POOL_FEE,
      tickSpacing: FAST_POOL_SPACING,
      hooks: this.hook,
    };
  }

  /** ETH/SNOW 裸参考池 PoolKey:hooks=0x0,ETH(地址 0x0)数值最小,恒为 currency0。 */
  private ethSnowKeyOf(): PoolKeyStruct {
    return {
      currency0: zeroAddress,
      currency1: FAST_QUOTE,
      fee: SNOW_ETH_POOL_FEE,
      tickSpacing: SNOW_ETH_POOL_SPACING,
      hooks: zeroAddress,
    };
  }

  private async sqrtPOf(poolId: Hex): Promise<bigint | null> {
    const hit = this.sqrtPCache.get(poolId);
    if (hit && Date.now() - hit.at < SQRTP_TTL_MS) return hit.v;
    const v = await readPoolSqrtP(this.client, this.poolManager, poolId);
    this.sqrtPCache.set(poolId, { at: Date.now(), v });
    return v;
  }

  // ────────────────────────── 只读 ──────────────────────────

  /** 恒已毕业:Fast Launch 一发射即 V4 池,没有"未毕业"状态。 */
  async getGraduationStatus(token: Address): Promise<GraduationStatus> {
    return { graduated: true, poolId: poolIdOfFastToken(token, this.hook), dexType: "univ4" };
  }

  /**
   * Fast 无绑定曲线,CurveState 里 sold/quoteReserve/graduationThreshold 这些曲线专属字段
   * 没有对应语义,给 0 占位;graduated 恒 true、progress 恒 1(参照 SnowOn:曲线合约本身
   * 毕业后 getCurveState 也只是继续吐"曲线的"最后状态,并不会报错或换语义)。priceQ 额外
   * 尝试读 Fast 池现价填一个有意义的值,读失败(几乎不会发生,池子发射时就已建好)则回退 0。
   */
  async getCurveState(token: Address): Promise<CurveState> {
    const t = token.toLowerCase() as Address;
    const hint = this.hints.get(t);
    let priceQ = 0n;
    try {
      const fastKey = this.fastPoolKeyOf(t);
      const sqrtP = await this.sqrtPOf(poolIdOf(fastKey));
      if (sqrtP) {
        const tokenIsC0 = fastKey.currency0.toLowerCase() === t;
        const { num, den } = sqrtPToRawPrice(sqrtP);
        priceQ = tokenIsC0 ? (num * E18) / den : (den * E18) / num;
      }
    } catch {
      /* 展示用字段,读取失败不影响毕业状态判断 */
    }
    return {
      sold: 0n,
      quoteReserve: 0n,
      priceQ,
      graduationThreshold: 0n,
      graduationProgress: 1,
      graduated: true,
      antiSnipe: false,
      antiBundle: false,
      buyTaxBps: hint?.buyTaxBps ?? 0,
      sellTaxBps: hint?.sellTaxBps ?? 0,
    };
  }

  // ────────────────────────── 报价 ──────────────────────────

  /**
   * 报价规则照搬 SnowOnAdapter.quoteOnPool:池子 spot 价(curve.poolPriceEth,一次性把
   * TOKEN/SNOW 与 ETH/SNOW 两条腿的汇率乘算进去)+ 路由费 + hook 税,展示级估算,不含冲击。
   * 与 SnowOnAdapter 唯一的实现差异:三次只读(Fast 池 sqrtP / ETH-SNOW 池 sqrtP / 路由 feeBps)
   * 互相独立无依赖,这里用 Promise.all 并发而非 SnowOnAdapter 里的顺序 await——纯性能优化,
   * 公式和结果完全一致。
   */
  private async quoteOnPool(token: Address, amountIn: bigint, isBuy: boolean): Promise<Quote> {
    const t = token.toLowerCase() as Address;
    const fastKey = this.fastPoolKeyOf(t);
    const tokenIsC0 = fastKey.currency0.toLowerCase() === t;
    const [sqrtP, ethSnowSqrtP, routerFeeBps] = await Promise.all([
      this.sqrtPOf(poolIdOf(fastKey)),
      this.sqrtPOf(poolIdOf(this.ethSnowKeyOf())),
      this.client.readContract({ address: this.swapRouter, abi: snowSwapRouterAbi, functionName: "feeBps" }),
    ]);
    if (!sqrtP) throw new Error("fast pool not initialized");
    if (!ethSnowSqrtP) throw new Error("ETH/SNOW pool not initialized");
    const priceEthPerToken = poolPriceEth(sqrtP, tokenIsC0, false, ethSnowSqrtP);
    const hint = this.hints.get(t);
    const taxBps = HOOK_PROTOCOL_BPS + (isBuy ? hint?.buyTaxBps ?? 0 : hint?.sellTaxBps ?? 0);
    const totalFeeBps = Number(routerFeeBps) + taxBps;
    if (isBuy) {
      const ethAfterFee = (amountIn * (10_000n - BigInt(totalFeeBps))) / 10_000n;
      const amountOut = priceEthPerToken > 0n ? (ethAfterFee * E18) / priceEthPerToken : 0n;
      return { amountIn, amountOut, effectivePriceEth: priceEthPerToken, priceImpactBps: 0, totalFeeBps };
    }
    const grossEth = (amountIn * priceEthPerToken) / E18;
    const amountOut = (grossEth * (10_000n - BigInt(totalFeeBps))) / 10_000n;
    return { amountIn, amountOut, effectivePriceEth: priceEthPerToken, priceImpactBps: 0, totalFeeBps };
  }

  async quoteBuy(token: Address, ethIn: bigint): Promise<Quote> {
    return this.quoteOnPool(token, ethIn, true);
  }

  async quoteSell(token: Address, tokenIn: bigint): Promise<Quote> {
    return this.quoteOnPool(token, tokenIn, false);
  }

  // ──────────────────────── 交易构造(与真实资金直接相关,逐参数对照 SnowOnAdapter) ────────────────────────

  /**
   * 买入:用户付 ETH,SnowSwapRouter.swapExactIn 两跳:
   *   pools = [ETH/SNOW 裸池 key, Fast 池 key]     — 与 SnowOnAdapter 非原生 quote 分支
   *                                                   `pools = [this.quoteEthKeyOf(p), gradKey]` 顺序一致
   *   inputCurrency = zeroAddress(ETH)              — 与 SnowOnAdapter 买入分支一致
   *   amountIn = ethIn                              — uint128,直接透传,不做换算
   *   minOut = minTokensOut                         — 调用方算好的滑点下限,直接透传
   *   recipient = recipient                         — 直接透传,不改成 msg.sender
   *   deadline = now + 20min                        — 与 SnowOnAdapter 完全相同的写法
   *   value = ethIn                                 — 原生 ETH 随交易一起发出,金额与 amountIn 相等
   */
  async buildBuyTx(token: Address, ethIn: bigint, minTokensOut: bigint, recipient: Address): Promise<TxRequest> {
    const pools = [this.ethSnowKeyOf(), this.fastPoolKeyOf(token)];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    return {
      to: this.swapRouter,
      data: encodeFunctionData({
        abi: snowSwapRouterAbi,
        functionName: "swapExactIn",
        args: [pools, zeroAddress, ethIn, minTokensOut, recipient, deadline],
      }),
      value: ethIn,
      chainId: this.chainId,
    };
  }

  /**
   * 卖出:先 approve TOKEN 给 router,再 SnowSwapRouter.swapExactIn 两跳:
   *   approve.spender = this.swapRouter, amount = MAX_UINT256  — 与 SnowOnAdapter 毕业后卖出分支
   *                                                                完全一致(不是精确额度 approve)
   *   pools = [Fast 池 key, ETH/SNOW 裸池 key]      — 与 SnowOnAdapter `pools = [gradKey, ethQKey]` 顺序一致
   *   inputCurrency = token(原始大小写,不转小写)   — 与 SnowOnAdapter 卖出分支一致
   *   amountIn = tokenIn, minOut = minEthOut         — 直接透传
   *   recipient = recipient                          — 直接透传
   *   value = 0n                                      — 卖出不带原生 ETH
   * 返回数组:[approveTx, swapTx],与 LaunchpadAdapter.buildSellTx 的约定一致。
   */
  async buildSellTx(token: Address, tokenIn: bigint, minEthOut: bigint, recipient: Address): Promise<TxRequest[]> {
    const pools = [this.fastPoolKeyOf(token), this.ethSnowKeyOf()];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    return [
      {
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [this.swapRouter, MAX_UINT256] }),
        value: 0n,
        chainId: this.chainId,
      },
      {
        to: this.swapRouter,
        data: encodeFunctionData({
          abi: snowSwapRouterAbi,
          functionName: "swapExactIn",
          args: [pools, token, tokenIn, minEthOut, recipient, deadline],
        }),
        value: 0n,
        chainId: this.chainId,
      },
    ];
  }
}
