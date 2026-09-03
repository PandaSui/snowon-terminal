/**
 * SnowBondingCurve 线性曲线本地定价(与合约逐 wei 对齐)。
 * 曲线: P(S) = p0 + slope·S/1e27  (wei-Q / whole token)
 * 成本: cost(s,a) = p0·a/1e18 + slope·a·(2s+a)/(2·1e45)
 * 费用: 协议 1%(固定) + 创建者自定义税(买/卖可不同),均按 Q 总额扣。
 */

const E18 = 10n ** 18n;
const E27 = 10n ** 27n;
const E45 = 10n ** 45n;
export const PROTOCOL_BPS = 100n; // 永久 1%
export const BPS = 10_000n;

export interface CurveParams {
  p0: bigint;
  slope: bigint;
}

/** 边际价格 wei-Q/whole-token @ 已售 s */
export function priceAt(p: CurveParams, s: bigint): bigint {
  return p.p0 + (p.slope * s) / E27;
}

/** 从已售 s 处买入 a(base units)的 Q 成本 */
export function costQ(p: CurveParams, s: bigint, a: bigint): bigint {
  return (p.p0 * a) / E18 + (p.slope * a * (2n * s + a)) / (2n * E45);
}

/** bigint 开平方(向下取整) */
function isqrt(x: bigint): bigint {
  if (x === 0n) return 0n;
  let y = x;
  let z = (x + 1n) / 2n;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}

/**
 * 净额 netQ(wei-Q)能买到的代币数 —— 解二次方程闭式解:
 * (slope/2e45)·a² + (p0/1e18 + slope·s/1e45)·a − net = 0
 * 等比放大避免小数: 令 A = slope, B = 2·(p0·1e27 + slope·s), C = 2e45·net
 * 则 slope·a² + B·a − C = 0 → a = (−B + √(B² + 4·slope·C)) / (2·slope)
 * 结果向下取整后最多多 1,循环收敛到满足 cost ≤ net。
 */
export function tokensForQuote(p: CurveParams, s: bigint, netQ: bigint): bigint {
  if (netQ === 0n) return 0n;
  if (p.slope === 0n) {
    if (p.p0 === 0n) return 0n;
    return (netQ * E18) / p.p0;
  }
  const B = 2n * (p.p0 * E27 + p.slope * s);
  const C = 2n * E45 * netQ;
  const disc = B * B + 4n * p.slope * C;
  let a = (isqrt(disc) - B) / (2n * p.slope);
  while (a > 0n && costQ(p, s, a) > netQ) a -= 1n;
  while (costQ(p, s, a + 1n) <= netQ) a += 1n;
  return a;
}

/** 扣费:总额 grossQ → 净额(费 = 协议1% + customBps) */
export function netAfterFees(grossQ: bigint, customTaxBps: number): bigint {
  return (grossQ * (BPS - PROTOCOL_BPS - BigInt(customTaxBps))) / BPS;
}

/** 买入完整路径:netQ → tokensOut */
export function quoteBuyOnCurve(p: CurveParams, s: bigint, grossQ: bigint, buyTaxBps: number): bigint {
  return tokensForQuote(p, s, netAfterFees(grossQ, buyTaxBps));
}

/** 卖出完整路径:tokensIn → 用户实收 netQ(税费在卖出侧按 sellTax 收) */
export function quoteSellOnCurve(p: CurveParams, s: bigint, tokensIn: bigint, sellTaxBps: number): bigint {
  if (tokensIn <= 0n || s <= 0n) return 0n;
  const a = tokensIn > s ? s : tokensIn;
  const grossQ = costQ(p, s - a, a);
  return netAfterFees(grossQ, sellTaxBps);
}

/**
 * V4 sqrtPriceX96 → 原始价格比(currency1/currency0 的 raw-unit 比)。
 * rawOut = rawIn · sqrtP² / 2¹⁹²(zeroForOne 方向)
 */
export function sqrtPToRawPrice(sqrtPriceX96: bigint): { num: bigint; den: bigint } {
  const q192 = 1n << 192n;
  return { num: sqrtPriceX96 * sqrtPriceX96, den: q192 };
}

/** zeroForOne: amount0(ETH) → amount1(Q),按 spot 估算(忽略冲击,展示用) */
export function ethToQuoteAtSpot(sqrtPriceX96: bigint, ethIn: bigint): bigint {
  const { num, den } = sqrtPToRawPrice(sqrtPriceX96);
  return (ethIn * num) / den;
}

/** oneForZero: Q → ETH */
export function quoteToEthAtSpot(sqrtPriceX96: bigint, qIn: bigint): bigint {
  const { num, den } = sqrtPToRawPrice(sqrtPriceX96);
  return (qIn * den) / num;
}

/** 毕业后 TOKEN/Q 池子的瞬时价 → ETH/whole-token。tokenIsC0: token 是 currency0 */
export function poolPriceEth(
  poolSqrtP: bigint,
  tokenIsC0: boolean,
  quoteIsEth: boolean,
  quoteEthSqrtP: bigint, // quote != ETH 时的 ETH/Q 池价格
): bigint {
  // token/Q 的 raw 价比
  const { num, den } = sqrtPToRawPrice(poolSqrtP);
  // qPerToken(raw 比): token 是 c0 → price = num/den;否则倒数
  const qPerTokenNum = tokenIsC0 ? num : den;
  const qPerTokenDen = tokenIsC0 ? den : num;
  const SCALE = 10n ** 18n;
  if (quoteIsEth) {
    // ETH/whole-token = qPerToken(raw) · 1e18 / 1e18 …… raw 比直接等价于 whole 比(两边 18 位)
    return (qPerTokenNum * SCALE) / qPerTokenDen;
  }
  // 先得到 Q/whole-token,再乘 ETH/Q 汇率
  const qPerToken = (qPerTokenNum * SCALE) / qPerTokenDen;
  return (qPerToken * ethPerQuoteAtSpot(quoteEthSqrtP)) / SCALE;
}

/** ETH/Q 池 sqrtP → wei-ETH per whole-Q(Q decimals 任意:raw 比换算) */
export function ethPerQuoteAtSpot(sqrtPriceX96: bigint): bigint {
  // ETH 是 currency0,Q 是 currency1:raw price = Q per ETH;取倒数得 ETH per Q
  const { num, den } = sqrtPToRawPrice(sqrtPriceX96);
  const SCALE = 10n ** 18n;
  return (den * SCALE) / num;
}
