import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createPublicClient, http, zeroAddress, type Address, type Hex } from "viem";
import { snowAbis, readPoolSqrtP, readPoolLiquidity } from "@terminal/adapters";
import { tokens } from "@terminal/db";
import { chainById } from "@/lib/chains";
import { getChainConfig } from "@/lib/chainConfigs";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { ttlMap } from "@/lib/ttlCache";

const quoteSymCache = ttlMap<string, string>(10 * 60_000);

const Q96 = 2n ** 96n;

function whole(n: bigint): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(19, "0");
  const intPart = s.slice(0, -18).replace(/^0+/, "") || "0";
  const frac = s.slice(-18).replace(/0+$/, "");
  return `${neg ? "-" : ""}${intPart}${frac ? `.${frac}` : ""}`;
}

function amountsFromSqrt(sqrtP: bigint, L: bigint) {
  if (sqrtP === 0n || L === 0n) return { amt0: 0n, amt1: 0n };
  return { amt0: (L * Q96) / sqrtP, amt1: (L * sqrtP) / Q96 };
}

/** 流动池配对:当前两边资产 + 毕业锁定的初始池 */
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const addr = address.toLowerCase() as Address;
    const [t] = await db
      .select()
      .from(tokens)
      .where(and(eq(tokens.chainId, CHAIN_ID), eq(tokens.address, addr)))
      .limit(1);
    if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });

    const quote = (t.quoteAsset || zeroAddress).toLowerCase() as Address;
    const quoteIsEth = quote === zeroAddress;
    const tokenIsC1 = addr.toLowerCase() > quote;
    let quoteSymbol = quoteIsEth || !t.graduated ? "ETH" : "Q";

    let currentQuote: string | null = null;
    let currentToken: string | null = null;
    let liquidity: string | null = null;

    if (t.graduated) {
      const cfg = await getChainConfig(CHAIN_ID);
      if (cfg?.poolManager) {
        try {
          const client = createPublicClient({
            chain: chainById(cfg.chainId),
            transport: http(cfg.rpcUrl, { batch: false, timeout: 6_000 }),
          });
          if (!quoteIsEth) {
            const cached = quoteSymCache.get(quote);
            if (cached) quoteSymbol = cached;
            else {
              try {
                const sym = await client.readContract({
                  address: quote,
                  abi: snowAbis.erc20Abi,
                  functionName: "symbol",
                });
                if (typeof sym === "string" && sym.trim()) {
                  quoteSymbol = sym.trim().slice(0, 12);
                  quoteSymCache.set(quote, quoteSymbol);
                }
              } catch {
                quoteSymbol = `${quote.slice(0, 6)}…`;
              }
            }
          }
          const manager = cfg.poolManager as Address;
          const pid = t.poolId as Hex | null;
          const reads: Array<Promise<unknown>> = [
            pid ? readPoolSqrtP(client, manager, pid) : Promise.resolve(null),
            pid ? readPoolLiquidity(client, manager, pid) : Promise.resolve(0n),
            client.readContract({
              address: addr,
              abi: snowAbis.erc20Abi,
              functionName: "balanceOf",
              args: [manager],
            }),
          ];
          const settled = await Promise.allSettled(reads);
          const sqrtP = settled[0].status === "fulfilled" ? (settled[0].value as bigint | null) : null;
          const L = settled[1].status === "fulfilled" && settled[1].value != null
            ? BigInt(settled[1].value as bigint)
            : 0n;
          const managerBal = settled[2].status === "fulfilled"
            ? BigInt(settled[2].value as bigint)
            : 0n;
          if (sqrtP && L > 0n) {
            liquidity = L.toString();
            const { amt0, amt1 } = amountsFromSqrt(sqrtP, L);
            const quoteWei = tokenIsC1 ? amt0 : amt1;
            const tokWei = tokenIsC1 ? amt1 : amt0;
            currentQuote = whole(quoteWei);
            currentToken = whole(tokWei);
          } else if (managerBal > 0n) {
            currentToken = whole(managerBal);
          }
        } catch {
          /* RPC 失败则用毕业锁仓 / 链下余额 */
        }
      }
    }
    if (!currentToken && t.lpTokenWei) {
      currentToken = whole(BigInt(String(t.lpTokenWei).split(".")[0] || "0"));
    }
    if (!currentQuote && t.lpQuoteWei) {
      currentQuote = whole(BigInt(String(t.lpQuoteWei).split(".")[0] || "0"));
    }

    const initQ = t.lpQuoteWei ? whole(BigInt(String(t.lpQuoteWei).split(".")[0] || "0")) : null;
    const initT = t.lpTokenWei ? whole(BigInt(String(t.lpTokenWei).split(".")[0] || "0")) : null;

    return NextResponse.json({
      symbol: t.symbol,
      quoteSymbol,
      quoteIsEth: quoteIsEth || !t.graduated,
      pair: `${t.symbol}/${quoteIsEth || !t.graduated ? "ETH" : quoteSymbol}`,
      graduated: t.graduated,
      locked: t.lpLockedForever && t.graduated,
      poolId: t.poolId,
      liquidity,
      current: currentQuote != null || currentToken != null ? { quote: currentQuote, token: currentToken } : null,
      initial: initQ != null || initT != null ? { quote: initQ ?? "0", token: initT ?? "0" } : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
