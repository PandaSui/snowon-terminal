import {
  type Address,
  type Hex,
  type PublicClient,
  encodeFunctionData,
  zeroAddress,
} from "viem";
import type { CurveState, GraduationStatus, LaunchpadAdapter, Quote, TxRequest } from "../types.js";
import { erc20Abi } from "../snowon/abis.js";
import { poolIdOf } from "../snowon/adapter.js";
import { readPoolSqrtP } from "../snowon/poolState.js";
import { poolPriceEth } from "../snowon/curveMath.js";
import { ponsCurveAbi, ponsFactoryAbi, ponsTokenAbi } from "./abis.js";
import * as math from "./curveMath.js";

const E18 = 10n ** 18n;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface PonsEnv {
  factory: Address;
  hook: Address;
  poolManager: Address;
  deployBlock: bigint;
}

export const DEFAULT_PONS_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as Address;
export const DEFAULT_PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044" as Address;
export const DEFAULT_PONS_DEPLOY_BLOCK = 55_500_000n;

const ADDR_OK = /^0x[0-9a-fA-F]{40}$/;
const LAUNCH_TTL_MS = 20_000;
const RESERVE_TTL_MS = 1_000;
const SQRTP_TTL_MS = 2_000;

/** 终端 DB 行提示:有曲线地址即可跳过 factory.getLaunchedToken。 */
export type PonsTokenHint = {
  curve?: string | null;
  quoteAsset?: string | null;
  graduated?: boolean | null;
  poolId?: string | null;
  taxBps?: number | null;
};

type Launch = {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: number;
  sweptQuote: bigint;
  sweptTokens: bigint;
  sweptAt: bigint;
  exists: boolean;
};

export function loadPonsEnv(chainId: number, poolManagerHint?: Address): PonsEnv | null {
  const factory = (process.env[`PONS_FACTORY_${chainId}`] ?? "") as string;
  const hook = (process.env[`PONS_HOOK_${chainId}`] ?? DEFAULT_PONS_HOOK) as string;
  const poolManager = (process.env[`PONS_POOL_MANAGER_${chainId}`] ?? process.env[`SNOWON_POOL_MANAGER_${chainId}`] ?? poolManagerHint ?? "") as string;
  if (!ADDR_OK.test(factory) || !ADDR_OK.test(poolManager)) return null;
  return {
    factory: factory.toLowerCase() as Address,
    hook: (ADDR_OK.test(hook) ? hook : DEFAULT_PONS_HOOK).toLowerCase() as Address,
    poolManager: poolManager.toLowerCase() as Address,
    deployBlock: BigInt(process.env[`PONS_DEPLOY_BLOCK_${chainId}`] ?? DEFAULT_PONS_DEPLOY_BLOCK.toString()),
  };
}

/** DB 覆盖 env:管理面板保存的 Pons 地址优先;再回退已知主网默认值。0 起始块视为未填。 */
export function mergePonsConfig(
  chainId: number,
  poolManager: Address,
  dbRow?: { ponsFactory?: string | null; ponsHook?: string | null; ponsDeployBlock?: bigint | number | string | null },
): PonsEnv | null {
  const env = loadPonsEnv(chainId, poolManager);
  const factory = (dbRow?.ponsFactory && ADDR_OK.test(dbRow.ponsFactory)
    ? dbRow.ponsFactory
    : env?.factory ?? DEFAULT_PONS_FACTORY) as string;
  if (!ADDR_OK.test(factory)) return null;
  const hook = (dbRow?.ponsHook && ADDR_OK.test(dbRow.ponsHook)
    ? dbRow.ponsHook
    : env?.hook ?? DEFAULT_PONS_HOOK) as string;
  const deployRaw = dbRow?.ponsDeployBlock;
  let deployBlock = env?.deployBlock ?? DEFAULT_PONS_DEPLOY_BLOCK;
  if (deployRaw != null && String(deployRaw) !== "") {
    const n = BigInt(String(deployRaw).split(".")[0] || "0");
    if (n > 0n) deployBlock = n;
  }
  const pm = (ADDR_OK.test(poolManager) ? poolManager : env?.poolManager) as string | undefined;
  if (!pm || !ADDR_OK.test(pm)) return null;
  return {
    factory: factory.toLowerCase() as Address,
    hook: hook.toLowerCase() as Address,
    poolManager: pm.toLowerCase() as Address,
    deployBlock,
  };
}

/**
 * Pons V2:毕业前打到该币自己的恒定乘积曲线;毕业后读 V4 池 spot 报价。
 * 毕业后的 swap calldata 需要专用路由,未配置时构交易会说明。
 */
export class PonsAdapter implements LaunchpadAdapter {
  readonly platformId = "pons";
  private readonly curveCache = new Map<string, Address>();
  private readonly hints = new Map<string, PonsTokenHint>();
  private readonly launchCache = new Map<string, { at: number; v: Launch }>();
  private readonly feeCache = new Map<string, bigint>();
  private readonly taxCache = new Map<string, bigint>();
  private readonly reservesCache = new Map<string, { at: number; q: bigint; t: bigint }>();
  private readonly sqrtPCache = new Map<string, { at: number; v: bigint | null }>();

  constructor(
    public readonly chainId: number,
    private readonly client: PublicClient,
    private readonly factory: Address,
    private readonly hook: Address,
    private readonly poolManager: Address,
  ) {}

  static fromEnv(chainId: number, client: PublicClient, fallbackPoolManager: Address): PonsAdapter | null {
    const env = loadPonsEnv(chainId);
    if (!env) return null;
    return new PonsAdapter(chainId, client, env.factory, env.hook, env.poolManager || fallbackPoolManager);
  }

  /** 用 tokens 表字段预热,报价不再每次打 factory.getLaunchedToken。 */
  hint(token: Address, h: PonsTokenHint): void {
    const key = token.toLowerCase();
    this.hints.set(key, h);
    if (h.curve && ADDR_OK.test(h.curve)) this.curveCache.set(key, h.curve.toLowerCase() as Address);
  }

  private async curveOf(token: Address): Promise<Address> {
    const key = token.toLowerCase();
    const hit = this.curveCache.get(key);
    if (hit) return hit;
    const launch = await this.launchOf(token);
    if (!launch.exists || launch.curve === zeroAddress) throw new Error(`unknown pons token ${token}`);
    const curve = launch.curve.toLowerCase() as Address;
    this.curveCache.set(key, curve);
    return curve;
  }

  private launchFromHint(token: Address, hint: PonsTokenHint): Launch | null {
    if (!hint.curve || !ADDR_OK.test(hint.curve)) return null;
    if (hint.graduated && !(hint.poolId && hint.poolId.length === 66)) return null;
    const pair = (hint.quoteAsset && ADDR_OK.test(hint.quoteAsset) ? hint.quoteAsset : zeroAddress) as Address;
    return {
      token: token.toLowerCase() as Address,
      curve: hint.curve.toLowerCase() as Address,
      deployer: zeroAddress,
      creatorFeeRecipient: zeroAddress,
      pairToken: pair.toLowerCase() as Address,
      graduationThreshold: 0n,
      poolFee: 0,
      tickSpacing: 0,
      creatorTaxBps: hint.taxBps ?? 0,
      buybackEnabled: false,
      phase: hint.graduated ? 2 : 0,
      sweptQuote: 0n,
      sweptTokens: 0n,
      sweptAt: 0n,
      exists: true,
    };
  }

  private async readLaunch(token: Address): Promise<Launch> {
    const raw = await this.client.readContract({
      address: this.factory,
      abi: ponsFactoryAbi,
      functionName: "getLaunchedToken",
      args: [token],
    });
    return raw as unknown as Launch;
  }

  private async launchOf(token: Address): Promise<Launch> {
    const key = token.toLowerCase();
    const cached = this.launchCache.get(key);
    if (cached && Date.now() - cached.at < LAUNCH_TTL_MS) return cached.v;
    const hint = this.hints.get(key);
    const syn = hint ? this.launchFromHint(token, hint) : null;
    if (syn) {
      this.launchCache.set(key, { at: Date.now(), v: syn });
      this.curveCache.set(key, syn.curve);
      return syn;
    }
    const v = await this.readLaunch(token);
    this.launchCache.set(key, { at: Date.now(), v });
    if (v.exists && v.curve !== zeroAddress) this.curveCache.set(key, v.curve.toLowerCase() as Address);
    return v;
  }

  private async reservesOf(curveAddr: Address): Promise<readonly [bigint, bigint]> {
    const key = curveAddr.toLowerCase();
    const hit = this.reservesCache.get(key);
    if (hit && Date.now() - hit.at < RESERVE_TTL_MS) return [hit.q, hit.t];
    const reserves = await this.client.readContract({
      address: curveAddr, abi: ponsCurveAbi, functionName: "getReserves",
    });
    const [q, t] = reserves as unknown as readonly [bigint, bigint];
    this.reservesCache.set(key, { at: Date.now(), q, t });
    return [q, t];
  }

  private async feeOf(curveAddr: Address): Promise<bigint> {
    const key = curveAddr.toLowerCase();
    const hit = this.feeCache.get(key);
    if (hit != null) return hit;
    const v = await this.client.readContract({
      address: curveAddr, abi: ponsCurveAbi, functionName: "feeBps",
    });
    this.feeCache.set(key, v);
    return v;
  }

  private async taxOf(curveAddr: Address): Promise<bigint> {
    const key = curveAddr.toLowerCase();
    const hit = this.taxCache.get(key);
    if (hit != null) return hit;
    const v = await this.client.readContract({
      address: curveAddr, abi: ponsCurveAbi, functionName: "creatorTaxBps",
    });
    this.taxCache.set(key, v);
    return v;
  }

  private poolIdOfLaunch(token: Address, launch: Launch): Hex {
    const hint = this.hints.get(token.toLowerCase());
    if (hint?.poolId && hint.poolId.length === 66) return hint.poolId as Hex;
    const quote = launch.pairToken;
    return poolIdOf({
      currency0: (token.toLowerCase() < quote.toLowerCase() ? token : quote) as Address,
      currency1: (token.toLowerCase() < quote.toLowerCase() ? quote : token) as Address,
      fee: Number(launch.poolFee),
      tickSpacing: Number(launch.tickSpacing),
      hooks: this.hook,
    });
  }

  private async sqrtPOf(poolId: Hex): Promise<bigint | null> {
    const hit = this.sqrtPCache.get(poolId);
    if (hit && Date.now() - hit.at < SQRTP_TTL_MS) return hit.v;
    const v = await readPoolSqrtP(this.client, this.poolManager, poolId);
    this.sqrtPCache.set(poolId, { at: Date.now(), v });
    return v;
  }

  async getCurveState(token: Address): Promise<CurveState> {
    const curveAddr = await this.curveOf(token);
    const [reserves, realQ, threshold, graduated, feeBps, taxBps] = await Promise.all([
      this.reservesOf(curveAddr),
      this.client.readContract({ address: curveAddr, abi: ponsCurveAbi, functionName: "realQuoteReserve" }),
      this.client.readContract({ address: curveAddr, abi: ponsCurveAbi, functionName: "graduationThreshold" }),
      this.client.readContract({ address: curveAddr, abi: ponsCurveAbi, functionName: "graduated" }),
      this.feeOf(curveAddr),
      this.taxOf(curveAddr),
    ]);
    const [quoteReserve, tokenReserve] = reserves;
    const priceQ = tokenReserve > 0n ? (quoteReserve * E18) / tokenReserve : 0n;
    return {
      sold: 0n,
      quoteReserve: realQ,
      priceQ,
      graduationThreshold: threshold,
      graduationProgress: threshold > 0n ? Number((realQ * 10_000n) / threshold) / 10_000 : 0,
      graduated,
      antiSnipe: true,
      antiBundle: false,
      buyTaxBps: Number(taxBps),
      sellTaxBps: Number(taxBps),
    };
  }

  async getGraduationStatus(token: Address): Promise<GraduationStatus> {
    const hint = this.hints.get(token.toLowerCase());
    if (hint?.graduated === false) return { graduated: false };
    if (hint?.graduated && hint.poolId && hint.poolId.length === 66) {
      return { graduated: true, poolId: hint.poolId as Hex, dexType: "univ4" };
    }
    const launch = await this.launchOf(token);
    const graduated = Number(launch.phase) >= 2;
    if (!graduated) return { graduated: false };
    return { graduated: true, poolId: this.poolIdOfLaunch(token, launch), dexType: "univ4" };
  }

  private async quoteCurve(token: Address, amountIn: bigint, isBuy: boolean): Promise<Quote> {
    const hint = this.hints.get(token.toLowerCase());
    const graduated = hint?.graduated === true
      ? true
      : hint?.graduated === false
        ? false
        : Number((await this.launchOf(token)).phase) >= 2;
    if (graduated) {
      const launch = await this.launchOf(token);
      return this.quoteOnPool(token, launch, amountIn, isBuy);
    }
    const curveAddr = await this.curveOf(token);
    const taxHint = hint?.taxBps;
    const [reserves, feeBps, taxBps] = await Promise.all([
      this.reservesOf(curveAddr),
      this.feeOf(curveAddr),
      taxHint != null ? Promise.resolve(BigInt(taxHint)) : this.taxOf(curveAddr),
    ]);
    const [qRes, tRes] = reserves;
    const amountOut = isBuy
      ? math.quoteBuy(amountIn, qRes, tRes, feeBps, taxBps)
      : math.quoteSell(amountIn, qRes, tRes, feeBps, taxBps);
    const spot = tRes > 0n ? (qRes * E18) / tRes : 0n;
    const effective = isBuy
      ? (amountOut > 0n ? (amountIn * E18) / amountOut : 0n)
      : (amountIn > 0n ? (amountOut * E18) / amountIn : 0n);
    return {
      amountIn,
      amountOut,
      effectivePriceEth: effective,
      priceImpactBps: impactBps(spot, effective),
      totalFeeBps: Number(feeBps + taxBps),
    };
  }

  async quoteBuy(token: Address, ethIn: bigint): Promise<Quote> {
    return this.quoteCurve(token, ethIn, true);
  }

  async quoteSell(token: Address, tokenIn: bigint): Promise<Quote> {
    return this.quoteCurve(token, tokenIn, false);
  }

  private async quoteOnPool(
    token: Address,
    launch: Launch,
    amountIn: bigint,
    isBuy: boolean,
  ): Promise<Quote> {
    const quote = launch.pairToken;
    const poolId = this.poolIdOfLaunch(token, launch);
    const sqrtP = await this.sqrtPOf(poolId);
    if (!sqrtP) throw new Error("pons graduated pool not initialized");
    const tokenIsC0 = token.toLowerCase() < quote.toLowerCase();
    const priceEth = poolPriceEth(sqrtP, tokenIsC0, quote === zeroAddress, 0n);
    const feeBps = 100 + Number(launch.creatorTaxBps);
    if (isBuy) {
      const afterFee = (amountIn * (10_000n - BigInt(feeBps))) / 10_000n;
      const amountOut = priceEth > 0n ? (afterFee * E18) / priceEth : 0n;
      return { amountIn, amountOut, effectivePriceEth: priceEth, priceImpactBps: 0, totalFeeBps: feeBps };
    }
    const gross = (amountIn * priceEth) / E18;
    const amountOut = (gross * (10_000n - BigInt(feeBps))) / 10_000n;
    return { amountIn, amountOut, effectivePriceEth: priceEth, priceImpactBps: 0, totalFeeBps: feeBps };
  }

  async buildBuyTx(token: Address, ethIn: bigint, minTokensOut: bigint, recipient: Address): Promise<TxRequest> {
    const launch = await this.launchOf(token);
    if (Number(launch.phase) >= 2) {
      throw new Error("该 Pons 代币已毕业,请在 Uniswap V4 池成交");
    }
    const native = launch.pairToken === zeroAddress;
    if (!native) throw new Error("暂不支持非 ETH 报价的 Pons 买入(需先授权报价资产)");
    return {
      to: launch.curve,
      data: encodeFunctionData({
        abi: ponsCurveAbi,
        functionName: "buy",
        args: [ethIn, minTokensOut, recipient],
      }),
      value: ethIn,
      chainId: this.chainId,
    };
  }

  async buildSellTx(token: Address, tokenIn: bigint, minEthOut: bigint, recipient: Address): Promise<TxRequest[]> {
    const launch = await this.launchOf(token);
    if (Number(launch.phase) >= 2) {
      throw new Error("该 Pons 代币已毕业,请在 Uniswap V4 池成交");
    }
    return [
      {
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [launch.curve, tokenIn] }),
        value: 0n,
        chainId: this.chainId,
      },
      {
        to: launch.curve,
        data: encodeFunctionData({
          abi: ponsCurveAbi,
          functionName: "sell",
          args: [tokenIn, minEthOut, recipient],
        }),
        value: 0n,
        chainId: this.chainId,
      },
    ];
  }
}

function impactBps(spot: bigint, effective: bigint): number {
  if (spot === 0n || effective === 0n) return 0;
  const diff = effective > spot ? effective - spot : spot - effective;
  return Number((diff * 10_000n) / spot);
}

export { ponsFactoryAbi, ponsCurveAbi, ponsTokenAbi };
