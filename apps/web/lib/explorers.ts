/** Robinhood Chain 用 Blockscout;浏览器页 + 兼容 Etherscan 的 module API。 */
export const EXPLORERS: Record<number, { browser: string; api: string }> = {
  4663: {
    browser: "https://robinhoodchain.blockscout.com",
    api: "https://robinhoodchain.blockscout.com/api",
  },
  46630: {
    browser: "https://explorer.testnet.chain.robinhood.com",
    api: "https://explorer.testnet.chain.robinhood.com/api",
  },
};

export function explorerFor(chainId: number) {
  return EXPLORERS[chainId] ?? EXPLORERS[4663]!;
}

export function contractUrl(chainId: number, address: string, hash = "contract") {
  const { browser } = explorerFor(chainId);
  return `${browser}/address/${address}#${hash}`;
}

export function addressUrl(chainId: number, address: string) {
  const { browser } = explorerFor(chainId);
  return `${browser}/address/${address}`;
}

export function txUrl(chainId: number, hash: string) {
  const { browser } = explorerFor(chainId);
  return `${browser}/tx/${hash}`;
}

export interface VerifiedContract {
  verified: boolean;
  /** 浏览器接口失败(限流/CF)时为 true,不要显示成「未验证」 */
  unknown: boolean;
  name: string | null;
  compiler: string | null;
  isProxy: boolean;
  implementation: string | null;
  explorerUrl: string;
}

const cache = new Map<string, { at: number; data: VerifiedContract; ttl: number }>();
const HIT_TTL = 60 * 60_000;
const MISS_TTL = 20_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function empty(chainId: number, address: string, unknown = true): VerifiedContract {
  return {
    verified: false,
    unknown,
    name: null,
    compiler: null,
    isProxy: false,
    implementation: null,
    explorerUrl: contractUrl(chainId, address),
  };
}

/** Blockscout getsourcecode。结果缓存 1h,避免打爆 CF。 */
export async function fetchVerified(chainId: number, address: string): Promise<VerifiedContract> {
  const addr = address.toLowerCase();
  const key = `${chainId}:${addr}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;

  const fallback = empty(chainId, addr);
  const { api, browser } = explorerFor(chainId);
  const url = `${api}?module=contract&action=getsourcecode&address=${addr}`;
  const headers = {
    "user-agent": UA,
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    referer: `${browser}/`,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
      const text = await res.text();
      if (res.status === 429 || !res.ok || text.startsWith("<") || text.startsWith("<!")) break;
      const j = JSON.parse(text) as {
        status?: string;
        message?: string;
        result?: Array<{
          SourceCode?: string;
          ContractName?: string;
          CompilerVersion?: string;
          Implementation?: string;
          Proxy?: string;
          IsProxy?: string;
        }>;
      };
      if (j.status !== "1" || !Array.isArray(j.result)) continue;
      const row = j.result[0];
      const src = String(row?.SourceCode ?? "").trim();
      const name = String(row?.ContractName ?? "").trim();
      const verified = name.length > 0 && src.length > 20 && src !== "Contract source code not verified";
      const impl = String(row?.Implementation ?? "").toLowerCase();
      const data: VerifiedContract = {
        verified,
        unknown: false,
        name: name || null,
        compiler: row?.CompilerVersion || null,
        isProxy: row?.Proxy === "1" || row?.IsProxy === "true",
        implementation: /^0x[0-9a-f]{40}$/.test(impl) ? impl : null,
        explorerUrl: contractUrl(chainId, addr),
      };
      cache.set(key, { at: Date.now(), data, ttl: HIT_TTL });
      return data;
    } catch {
      /* retry */
    }
  }
  cache.set(key, { at: Date.now(), data: fallback, ttl: MISS_TTL });
  return fallback;
}
