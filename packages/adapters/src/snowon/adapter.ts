import {
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  zeroAddress,
} from "viem";
import type { ChainConfig, CurveState, GraduationStatus, LaunchpadAdapter, Quote, TxRequest } from "../types.js";
import {
  erc20Abi,
  snowBondingCurveAbi,
  snowOnFactoryAbi,
  snowSwapRouterAbi,
} from "./abis.js";
import * as curve from "./curveMath.js";
import { readPoolSqrtP } from "./poolState.js";

const E18 = 10n ** 18n;
const MAX_UINT256 = (1n << 256n) - 1n;

interface PoolKeyStruct {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/** V4 PoolId = keccak256(abi.encode(PoolKey)) */
export function poolIdOf(key: PoolKeyStruct): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [key],
    ),
  );
}

/**
 * snowon.fun 适配器。
 * 毕业前: 交易打到 SnowBondingCurve(buy/sell,ETH 进出,内部自动换 Q);
 * 毕业后: 交易打 SnowSwapRouter.swapExactIn(ETH→[ETH/Q]→TOKEN/Q,或反向)。
 */
export class SnowOnAdapter implements LaunchpadAdapter {
  readonly platformId = "snowon";
  private readonly curveAddrCache = new Map<string, Address>();
  private readonly tokenOfCache = new Map<string, Address>();
  private readonly sqrtPCache = new Map<string, { at: number; v: bigint | null }>();

  constructor(
    public readonly chainId: number,
    private readonly client: PublicClient,
    private readonly cfg: ChainConfig,
  ) {}

  // ────────────────────────── 只读 ──────────────────────────

  private async curveOf(token: Address): Promise<Address> {
    const key = token.toLowerCase();
    const hit = this.curveAddrCache.get(key);
    if (hit) return hit;
    const curveAddr = await this.client.readContract({
      address: this.cfg.factory,
      abi: snowOnFactoryAbi,
      functionName: "tokenToCurve",
      args: [token],
    });
    if (curveAddr === zeroAddress) throw new Error(`unknown token ${token}`);
    this.curveAddrCache.set(key, curveAddr);
    return curveAddr;
  }

  async getCurveState(token: Address): Promise<CurveState> {
    const curveAddr = await this.curveOf(token);
    // 不用 multicall3:该链未部署,HTTP batch 也被 RPC 网关丢掉。并行单次 eth_call。
    const [sold, quoteReserve, priceQ, graduated, antiSnipe, antiBundle, buyTaxBps, sellTaxBps, quote] =
      await Promise.all([
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "sold" }),
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "quoteReserve" }),
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "price" }),
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "graduated" }),
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "antiSnipe" }),
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "antiBundle" }),
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "buyTaxBps" }),
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "sellTaxBps" }),
        this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "quote" }),
      ]);
    const threshold = await this.client.readContract({
      address: this.cfg.factory,
      abi: snowOnFactoryAbi,
      functionName: "graduationThreshold",
      args: [quote],
    });
    return {
      sold,
      quoteReserve,
      priceQ,
      graduationThreshold: threshold,
      graduationProgress: threshold > 0n ? Number((quoteReserve * 10_000n) / threshold) / 10_000 : 0,
      graduated,
      antiSnipe,
      antiBundle,
      buyTaxBps,
      sellTaxBps,
    };
  }

  async getGraduationStatus(token: Address): Promise<GraduationStatus> {
    const curveAddr = await this.curveOf(token);
    const graduated = await this.client.readContract({
      address: curveAddr,
      abi: snowBondingCurveAbi,
      functionName: "graduated",
    });
    if (!graduated) return { graduated: false };
    const key = await this.gradPoolKeyOf(curveAddr);
    return { graduated: true, poolId: poolIdOf(key), dexType: "univ4" };
  }

  // ────────────────────────── 报价 ──────────────────────────

  private async curveParams(curveAddr: Address) {
    const [p0, slope, sold, buyTaxBps, sellTaxBps, quote, quoteEthFee, quoteEthSpacing] = await Promise.all([
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "p0" }),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "slope" }),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "sold" }),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "buyTaxBps" }),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "sellTaxBps" }),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "quote" }),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "quoteEthFee" }),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "quoteEthSpacing" }),
    ]);
    return { p0, slope, sold, buyTaxBps, sellTaxBps, quote, quoteEthFee, quoteEthSpacing };
  }

  /** ETH/Q 池当前 sqrtP(quote == ETH 时返回 null) */
  private async quoteEthSqrtP(quote: Address, fee: number, spacing: number): Promise<bigint | null> {
    if (quote === zeroAddress) return null;
    const cacheKey = `${quote.toLowerCase()}:${fee}:${spacing}`;
    const hit = this.sqrtPCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 2_000) return hit.v;
    const key: PoolKeyStruct = {
      currency0: zeroAddress,
      currency1: quote,
      fee,
      tickSpacing: spacing,
      hooks: zeroAddress,
    };
    const sqrtP = await readPoolSqrtP(this.client, this.cfg.poolManager, poolIdOf(key));
    this.sqrtPCache.set(cacheKey, { at: Date.now(), v: sqrtP });
    return sqrtP;
  }

  async quoteBuy(token: Address, ethIn: bigint): Promise<Quote> {
    const curveAddr = await this.curveOf(token);
    const [p, graduated] = await Promise.all([
      this.curveParams(curveAddr),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "graduated" }),
    ]);

    if (!graduated) {
      // ETH → Q(展示级估算:spot 价,忽略内部 ±2% 路由冲击)
      let grossQ = ethIn;
      if (p.quote !== zeroAddress) {
        const sqrtP = await this.quoteEthSqrtP(p.quote, p.quoteEthFee, p.quoteEthSpacing);
        if (!sqrtP) throw new Error("ETH/Q pool not initialized");
        grossQ = curve.ethToQuoteAtSpot(sqrtP, ethIn);
      }
      const tokensOut = curve.quoteBuyOnCurve({ p0: p.p0, slope: p.slope }, p.sold, grossQ, p.buyTaxBps);
      const effectivePriceEth = tokensOut > 0n ? (ethIn * E18) / tokensOut : 0n;
      const spotPriceEth = await this.curveSpotEth(p);
      return {
        amountIn: ethIn,
        amountOut: tokensOut,
        effectivePriceEth,
        priceImpactBps: impactBps(spotPriceEth, effectivePriceEth),
        totalFeeBps: 100 + p.buyTaxBps,
      };
    }
    // 毕业后:经 SnowSwapRouter,fee(默认 0.1%) + hook 税(1% + buyTax)
    return this.quoteOnPool(curveAddr, p, ethIn, true);
  }

  async quoteSell(token: Address, tokenIn: bigint): Promise<Quote> {
    const curveAddr = await this.curveOf(token);
    const [p, graduated] = await Promise.all([
      this.curveParams(curveAddr),
      this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "graduated" }),
    ]);

    if (!graduated) {
      const netQ = curve.quoteSellOnCurve({ p0: p.p0, slope: p.slope }, p.sold, tokenIn, p.sellTaxBps);
      let ethOut = netQ;
      if (p.quote !== zeroAddress) {
        const sqrtP = await this.quoteEthSqrtP(p.quote, p.quoteEthFee, p.quoteEthSpacing);
        if (!sqrtP) throw new Error("ETH/Q pool not initialized");
        ethOut = curve.quoteToEthAtSpot(sqrtP, netQ);
      }
      const spotPriceEth = await this.curveSpotEth(p);
      const effectivePriceEth = tokenIn > 0n ? (ethOut * E18) / tokenIn : 0n;
      return {
        amountIn: tokenIn,
        amountOut: ethOut,
        effectivePriceEth,
        priceImpactBps: impactBps(spotPriceEth, effectivePriceEth),
        totalFeeBps: 100 + p.sellTaxBps,
      };
    }
    return this.quoteOnPool(curveAddr, p, tokenIn, false);
  }

  /** 毕业后报价:从池子 sqrtP 做 spot 估算(不含冲击;精确报价建议 eth_call 模拟 swapExactIn) */
  private async quoteOnPool(
    curveAddr: Address,
    p: Awaited<ReturnType<SnowOnAdapter["curveParams"]>>,
    amountIn: bigint,
    isBuy: boolean,
  ): Promise<Quote> {
    const key = await this.gradPoolKeyOf(curveAddr);
    const sqrtP = await readPoolSqrtP(this.client, this.cfg.poolManager, poolIdOf(key));
    if (!sqrtP) throw new Error("graduated pool not initialized");
    const tokenIsC0 = key.currency0.toLowerCase() === (await this.tokenOf(curveAddr)).toLowerCase();
    let quoteEthP = 0n;
    if (p.quote !== zeroAddress) {
      const qSqrt = await this.quoteEthSqrtP(p.quote, p.quoteEthFee, p.quoteEthSpacing);
      if (!qSqrt) throw new Error("ETH/Q pool not initialized");
      quoteEthP = qSqrt;
    }
    const priceEthPerToken = curve.poolPriceEth(sqrtP, tokenIsC0, p.quote === zeroAddress, quoteEthP);
    const routerFeeBps = Number(
      await this.client.readContract({ address: this.cfg.swapRouter, abi: snowSwapRouterAbi, functionName: "feeBps" }),
    );
    const taxBps = 100 + (isBuy ? p.buyTaxBps : p.sellTaxBps);
    const totalFeeBps = routerFeeBps + taxBps;
    if (isBuy) {
      const ethAfterFee = (amountIn * (10_000n - BigInt(totalFeeBps))) / 10_000n;
      const amountOut = priceEthPerToken > 0n ? (ethAfterFee * E18) / priceEthPerToken : 0n;
      return { amountIn, amountOut, effectivePriceEth: priceEthPerToken, priceImpactBps: 0, totalFeeBps };
    }
    const grossEth = (amountIn * priceEthPerToken) / E18;
    const amountOut = (grossEth * (10_000n - BigInt(totalFeeBps))) / 10_000n;
    return { amountIn, amountOut, effectivePriceEth: priceEthPerToken, priceImpactBps: 0, totalFeeBps };
  }

  private async curveSpotEth(p: Awaited<ReturnType<SnowOnAdapter["curveParams"]>>): Promise<bigint> {
    const spotQ = curve.priceAt({ p0: p.p0, slope: p.slope }, p.sold);
    if (p.quote === zeroAddress) return spotQ;
    const sqrtP = await this.quoteEthSqrtP(p.quote, p.quoteEthFee, p.quoteEthSpacing);
    if (!sqrtP) throw new Error("ETH/Q pool not initialized");
    return curve.quoteToEthAtSpot(sqrtP, spotQ);
  }

  private async tokenOf(curveAddr: Address): Promise<Address> {
    const key = curveAddr.toLowerCase();
    const hit = this.tokenOfCache.get(key);
    if (hit) return hit;
    const token = await this.client.readContract({
      address: curveAddr,
      abi: snowBondingCurveAbi,
      functionName: "token",
    });
    this.tokenOfCache.set(key, token);
    return token;
  }

  private async gradPoolKeyOf(curveAddr: Address): Promise<PoolKeyStruct> {
    return this.client.readContract({ address: curveAddr, abi: snowBondingCurveAbi, functionName: "gradPoolKey" });
  }

  private quoteEthKeyOf(p: { quote: Address; quoteEthFee: number; quoteEthSpacing: number }): PoolKeyStruct {
    return {
      currency0: zeroAddress,
      currency1: p.quote,
      fee: p.quoteEthFee,
      tickSpacing: p.quoteEthSpacing,
      hooks: zeroAddress,
    };
  }

  // ──────────────────────── 交易构造 ────────────────────────

  async buildBuyTx(token: Address, ethIn: bigint, minTokensOut: bigint, _recipient: Address): Promise<TxRequest> {
    const curveAddr = await this.curveOf(token);
    const graduated = await this.client.readContract({
      address: curveAddr, abi: snowBondingCurveAbi, functionName: "graduated",
    });

    if (!graduated) {
      return {
        to: curveAddr,
        data: encodeFunctionData({ abi: snowBondingCurveAbi, functionName: "buy", args: [minTokensOut] }),
        value: ethIn,
        chainId: this.chainId,
      };
    }

    // 毕业后:SnowSwapRouter,ETH→(ETH/Q)→TOKEN/Q
    const p = await this.curveParams(curveAddr);
    const gradKey = await this.gradPoolKeyOf(curveAddr);
    const pools =
      p.quote === zeroAddress ? [gradKey] : [this.quoteEthKeyOf(p), gradKey];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    return {
      to: this.cfg.swapRouter,
      data: encodeFunctionData({
        abi: snowSwapRouterAbi,
        functionName: "swapExactIn",
        args: [pools, zeroAddress, ethIn, minTokensOut, _recipient, deadline],
      }),
      value: ethIn,
      chainId: this.chainId,
    };
  }

  async buildSellTx(token: Address, tokenIn: bigint, minEthOut: bigint, recipient: Address): Promise<TxRequest[]> {
    const curveAddr = await this.curveOf(token);
    const graduated = await this.client.readContract({
      address: curveAddr, abi: snowBondingCurveAbi, functionName: "graduated",
    });

    if (!graduated) {
      return [
        {
          to: token,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [curveAddr, tokenIn] }),
          value: 0n,
          chainId: this.chainId,
        },
        {
          to: curveAddr,
          data: encodeFunctionData({ abi: snowBondingCurveAbi, functionName: "sell", args: [tokenIn, minEthOut] }),
          value: 0n,
          chainId: this.chainId,
        },
      ];
    }

    const p = await this.curveParams(curveAddr);
    const gradKey = await this.gradPoolKeyOf(curveAddr);
    const pools =
      p.quote === zeroAddress ? [gradKey] : [gradKey, this.quoteEthKeyOf(p)];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    return [
      {
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [this.cfg.swapRouter, MAX_UINT256] }),
        value: 0n,
        chainId: this.chainId,
      },
      {
        to: this.cfg.swapRouter,
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

function impactBps(spot: bigint, effective: bigint): number {
  if (spot === 0n || effective === 0n) return 0;
  const diff = effective > spot ? effective - spot : spot - effective;
  return Number((diff * 10_000n) / spot);
}
