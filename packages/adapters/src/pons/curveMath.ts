/** Pons V2 恒定乘积曲线:先从报价腿扣 fee+tax,再按无手续费 AMM 出货。 */

export const BPS = 10_000n;

export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 0n): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * (BPS - feeBps);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BPS + amountInWithFee;
  if (denominator <= 0n) return 0n;
  return numerator / denominator;
}

export function quoteBuy(quoteIn: bigint, quoteReserve: bigint, tokenReserve: bigint, feeBps: bigint, taxBps: bigint): bigint {
  const fee = (quoteIn * feeBps) / BPS;
  const tax = (quoteIn * taxBps) / BPS;
  const net = quoteIn - fee - tax;
  if (net <= 0n) return 0n;
  return getAmountOut(net, quoteReserve, tokenReserve, 0n);
}

export function quoteSell(tokensIn: bigint, quoteReserve: bigint, tokenReserve: bigint, feeBps: bigint, taxBps: bigint): bigint {
  const gross = getAmountOut(tokensIn, tokenReserve, quoteReserve, 0n);
  const fee = (gross * feeBps) / BPS;
  const tax = (gross * taxBps) / BPS;
  const out = gross - fee - tax;
  return out > 0n ? out : 0n;
}
