import { createPublicClient, http, parseAbi, type Address } from "viem";
import { chainById } from "@/lib/chains";
import { getChainConfig } from "@/lib/chainConfigs";
import { CHAIN_ID } from "@/lib/db";
import { ttlMap } from "@/lib/ttlCache";

const cache = ttlMap<string, string>(45_000, 2_000);
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11" as Address;
const mcAbi = parseAbi(["function getEthBalance(address addr) view returns (uint256 balance)"]);

function weiToEthStr(wei: bigint): string {
  const neg = wei < 0n;
  const n = neg ? -wei : wei;
  const s = n.toString().padStart(19, "0");
  const intPart = s.slice(0, -18).replace(/^0+/, "") || "0";
  const frac = s.slice(-18).replace(/0+$/, "");
  return `${neg ? "-" : ""}${intPart}${frac ? `.${frac}` : ""}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 原生 ETH 余额。优先 Multicall3 一跳读完;失败再逐条重试。结果缓存 45s。 */
export async function fetchNativeBalances(addresses: string[]): Promise<Record<string, string | null>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
  const out: Record<string, string | null> = {};
  const missing: string[] = [];
  for (const a of unique) {
    const hit = cache.get(a);
    if (hit !== undefined) out[a] = hit;
    else missing.push(a);
  }
  if (missing.length === 0) return out;

  const cfg = await getChainConfig(CHAIN_ID);
  if (!cfg) {
    for (const a of missing) out[a] = null;
    return out;
  }
  const client = createPublicClient({
    chain: chainById(cfg.chainId),
    transport: http(cfg.rpcUrl, { batch: false, timeout: 8_000, retryCount: 2, retryDelay: 800 }),
  });

  const leftover: string[] = [];
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    try {
      const results = await client.multicall({
        multicallAddress: MULTICALL3,
        allowFailure: true,
        contracts: chunk.map((addr) => ({
          address: MULTICALL3,
          abi: mcAbi,
          functionName: "getEthBalance" as const,
          args: [addr as Address],
        })),
      });
      results.forEach((r, idx) => {
        const addr = chunk[idx]!;
        if (r.status === "success") {
          const s = weiToEthStr(r.result);
          cache.set(addr, s);
          out[addr] = s;
        } else {
          leftover.push(addr);
        }
      });
    } catch {
      leftover.push(...chunk);
    }
  }

  for (let i = 0; i < leftover.length; i += 3) {
    const chunk = leftover.slice(i, i + 3);
    await Promise.all(
      chunk.map(async (addr) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const wei = await client.getBalance({ address: addr as Address });
            const s = weiToEthStr(wei);
            cache.set(addr, s);
            out[addr] = s;
            return;
          } catch {
            await sleep(500 * (attempt + 1));
          }
        }
        out[addr] = null;
      }),
    );
  }
  return out;
}
