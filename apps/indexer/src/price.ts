/** ethAmount / tokenAmount → numeric(40,18) 字符串,不经过 Number() */
export function formatPriceEth(ethAmount: bigint, tokenAmount: bigint): string {
  if (tokenAmount === 0n) return `0.${"0".repeat(18)}`;
  const scaled = (ethAmount * 10n ** 18n) / tokenAmount;
  const sign = scaled < 0n ? "-" : "";
  const abs = scaled < 0n ? -scaled : scaled;
  const intPart = abs / 10n ** 18n;
  const frac = abs % 10n ** 18n;
  return `${sign}${intPart}.${frac.toString().padStart(18, "0")}`;
}

/** num/den 截断到 dp 位小数,并封顶 1 */
export function shareDecimal(num: bigint, den: bigint, dp = 4): string {
  if (den <= 0n) return `0.${"0".repeat(dp)}`;
  const scale = 10n ** BigInt(dp);
  let v = (num * scale) / den;
  if (v > scale) v = scale;
  if (v < 0n) v = 0n;
  const intPart = v / scale;
  const frac = v % scale;
  return `${intPart}.${frac.toString().padStart(dp, "0")}`;
}
