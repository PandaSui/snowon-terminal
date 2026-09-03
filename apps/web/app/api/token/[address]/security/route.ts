import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createPublicClient, http, zeroAddress, type Address, type Hex } from "viem";
import { snowAbis, readPoolLiquidity } from "@terminal/adapters";
import { tokens } from "@terminal/db";
import { chainById } from "@/lib/chains";
import { getChainConfig } from "@/lib/chainConfigs";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { fetchVerified } from "@/lib/explorers";

const DEAD = "0x000000000000000000000000000000000000dead" as Address;

/** 常见黑名单函数选择器(字节码子串启发式匹配) */
const BLACKLIST_SELECTORS: Record<string, string> = {
  f9f92be4: "blacklist(address)",
  "9cfe42da": "addBlacklist(address)",
  "153b0d1e": "setBlacklist(address,bool)",
  fe575a87: "isBlacklisted(address)",
  "44337ea1": "addToBlacklist(address)",
  "537df3b6": "removeFromBlacklist(address)",
  "16c02129": "blacklists(address)",
  a20623ce: "_blacklist(address)",
  "68092bd9": "setBlackList(address,bool)",
  b36d6919: "isBlackList(address)",
};

function decodeAddrWord(data: string | undefined): string | null {
  if (!data || data === "0x" || data.length < 66) return null;
  return `0x${data.slice(-40)}`.toLowerCase();
}

function pct(part: bigint, whole: bigint): number | null {
  if (whole <= 0n) return null;
  return Number((part * 10_000n) / whole) / 100;
}

/**
 * 合约开源(Blockscout 验证) + 流动池锁定/燃烧比例。
 * 开源不看 GitHub 链接,看浏览器是否已验证源码。
 * SnowOn 毕业池:hook 无条件拒绝撤流动性 → LP 锁定 100%。
 */
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

    const [tokenV, curveV] = await Promise.all([
      fetchVerified(CHAIN_ID, addr),
      t.curveAddress ? fetchVerified(CHAIN_ID, t.curveAddress) : Promise.resolve(null),
    ]);

    const snowon = t.platformId === "snowon";
    const tokenVerified = tokenV.verified || (tokenV.unknown && snowon);
    const curveVerified = !!(curveV?.verified || (curveV?.unknown && snowon));

    let lpLockPct: number | null = null;
    let lpBurnPct: number | null = null;
    let tokenBurnPct: number | null = null;
    let poolLiquidity: string | null = null;
    let ownerInfo: { status: "renounced" | "owned" | "none" | "unknown"; address: string | null } = {
      status: "unknown",
      address: null,
    };
    let blacklistInfo: { detected: boolean; hits: string[] } = { detected: false, hits: [] };
    let sellTaxOnchain: number | null = null;

    if (!t.graduated) {
      lpLockPct = null;
    } else if (t.lpLockedForever) {
      // SnowLaunchHook.beforeRemoveLiquidity 无条件 revert("LP locked forever")
      lpLockPct = 100;
    } else {
      lpLockPct = 0;
    }

    const cfg = await getChainConfig(CHAIN_ID);
    if (cfg) {
      const client = createPublicClient({
        chain: chainById(cfg.chainId),
        transport: http(cfg.rpcUrl, { batch: false, timeout: 8_000 }),
      });

      const onchain = await Promise.allSettled([
        client.readContract({ address: addr, abi: snowAbis.erc20Abi, functionName: "totalSupply" }),
        client.readContract({ address: addr, abi: snowAbis.erc20Abi, functionName: "balanceOf", args: [DEAD] }),
        client.readContract({ address: addr, abi: snowAbis.erc20Abi, functionName: "balanceOf", args: [zeroAddress] }),
        t.poolId
          ? readPoolLiquidity(client, cfg.poolManager as Address, t.poolId as Hex)
          : Promise.resolve(null),
      ]);

      const totalSupply = onchain[0].status === "fulfilled" ? (onchain[0].value as bigint) : 0n;
      const deadBal = onchain[1].status === "fulfilled" ? (onchain[1].value as bigint) : 0n;
      const zeroBal = onchain[2].status === "fulfilled" ? (onchain[2].value as bigint) : 0n;
      if (onchain[3].status === "fulfilled" && onchain[3].value != null) {
        poolLiquidity = (onchain[3].value as bigint).toString();
      }
      tokenBurnPct = pct(deadBal + zeroBal, totalSupply);

      // ── 权限放弃检测:owner() / getOwner() ────────────────
      try {
        const r1 = await client.call({ to: addr, data: "0x8da5cb5b" }).catch(() => null);
        let ownerAddr = decodeAddrWord(r1?.data);
        if (ownerAddr === null) {
          const r2 = await client.call({ to: addr, data: "0x893d20e8" }).catch(() => null);
          ownerAddr = decodeAddrWord(r2?.data);
        }
        if (ownerAddr === null) {
          ownerInfo = { status: "none", address: null }; // 无 owner 概念(无所有权函数)
        } else if (ownerAddr === zeroAddress || ownerAddr === DEAD.toLowerCase()) {
          ownerInfo = { status: "renounced", address: ownerAddr };
        } else {
          ownerInfo = { status: "owned", address: ownerAddr };
        }
      } catch {
        ownerInfo = { status: "unknown", address: null };
      }

      // ── 黑名单函数检测:字节码选择器启发式 ────────────────
      try {
        const code = (await client.getBytecode({ address: addr }))?.toLowerCase() ?? "";
        const hits = Object.entries(BLACKLIST_SELECTORS)
          .filter(([sel]) => code.includes(sel))
          .map(([, name]) => name);
        blacklistInfo = { detected: hits.length > 0, hits };
      } catch {
        blacklistInfo = { detected: false, hits: [] };
      }

      // ── 貔貅启发式:曲线卖出税率(≥99% 视为疑似貔貅)─────────
      try {
        if (t.curveAddress) {
          const st = await client.readContract({
            address: t.curveAddress as Address,
            abi: snowAbis.snowBondingCurveAbi,
            functionName: "sellTaxBps",
          });
          sellTaxOnchain = Number(st);
        }
      } catch {
        sellTaxOnchain = null;
      }
    }

    if (t.graduated && t.lpLockedForever) {
      // V4 无 ERC20 LP:hook 拒绝撤池,仓位永久锁死,燃烧锁定按 100% 计
      lpBurnPct = 100;
    }

    // 貔貅综合判定(启发式):卖税 ≥99% 或存在黑名单函数 → 高风险
    const sellTax = sellTaxOnchain;
    const honeypotSuspected =
      (sellTax != null && sellTax >= 9900) ||
      (blacklistInfo.detected && sellTax != null && sellTax >= 2000);
    const sellRisk: "ok" | "warn" | "bad" =
      honeypotSuspected ? "bad" : sellTax != null && sellTax >= 2000 ? "warn" : "ok";

    return NextResponse.json({
      verified: tokenVerified,
      contractName: tokenV.name || (tokenVerified && snowon ? "SnowLaunchToken" : null),
      compiler: tokenV.compiler,
      isProxy: tokenV.isProxy,
      implementation: tokenV.implementation,
      explorerUrl: tokenV.explorerUrl,
      curveVerified,
      curveName: curveV?.name || (curveVerified && snowon ? "SnowBondingCurve" : null),
      curveExplorerUrl: curveV?.explorerUrl ?? null,
      github: t.github || null,
      graduated: t.graduated,
      lpLockedForever: t.lpLockedForever,
      lpLockPct,
      lpBurnPct,
      tokenBurnPct,
      poolLiquidity,
      poolId: t.poolId,
      owner: ownerInfo,
      blacklist: blacklistInfo,
      sellTaxOnchain: sellTax,
      honeypotSuspected,
      sellRisk,
      heuristic: true,
    });
  } catch (e) {
    return apiError(e);
  }
}
