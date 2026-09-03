import { describe, expect, it } from "vitest";
import { costQ, netAfterFees, priceAt, quoteSellOnCurve, tokensForQuote } from "./curveMath.js";

const E18 = 10n ** 18n;

// 一组合理参数:p0 = 1e8 wei-Q,slope = 1e15(×1e27 约定)
const P = { p0: 100_000_000n, slope: 1_000_000_000_000_000n };

describe("linear curve math", () => {
  it("priceAt matches P(S) = p0 + slope·S/1e27", () => {
    expect(priceAt(P, 0n)).toBe(P.p0);
    expect(priceAt(P, 10n ** 27n)).toBe(P.p0 + P.slope);
  });

  it("costQ: buy 1 whole token at s=0 costs ~p0", () => {
    const c = costQ(P, 0n, E18);
    expect(c >= P.p0).toBe(true);
    expect(c < P.p0 + P.p0 / 100n).toBe(true); // 斜率项很小
  });

  it("tokensForQuote 与 costQ 互逆(±1 wei)", () => {
    const s = 123_456_789n * E18;
    for (const netQ of [10n ** 9n, 10n ** 12n, 5n * 10n ** 15n]) {
      const a = tokensForQuote(P, s, netQ);
      expect(costQ(P, s, a)).toBeLessThanOrEqual(netQ);
      expect(costQ(P, s, a + 1n)).toBeGreaterThan(netQ);
    }
  });

  it("netAfterFees 扣掉协议 1% + 自定义税", () => {
    expect(netAfterFees(10_000n, 0)).toBe(9_900n);
    expect(netAfterFees(10_000n, 500)).toBe(9_400n); // 1% + 5%
  });

  it("tokensForQuote handles slope = 0 (constant price)", () => {
    const flat = { p0: 100_000_000n, slope: 0n };
    const a = tokensForQuote(flat, 0n, 100_000_000n);
    expect(a).toBe(E18);
    expect(costQ(flat, 0n, a)).toBeLessThanOrEqual(100_000_000n);
  });

  it("quoteSellOnCurve clamps tokensIn to sold", () => {
    const s = E18;
    const out = quoteSellOnCurve(P, s, s * 2n, 0);
    const capped = quoteSellOnCurve(P, s, s, 0);
    expect(out).toBe(capped);
    expect(quoteSellOnCurve(P, 0n, E18, 0)).toBe(0n);
  });
});
