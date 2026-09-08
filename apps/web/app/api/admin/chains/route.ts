import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { createPublicClient, http, zeroAddress, type Address, type Chain } from "viem";
import { DEFAULT_PONS_DEPLOY_BLOCK, DEFAULT_PONS_FACTORY, DEFAULT_PONS_HOOK, snowAbis } from "@terminal/adapters";
import { chainConfigs, tokens } from "@terminal/db";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { envAdminWallets } from "@/lib/admins";
import { requireAdminReason } from "@/lib/auth";
import { invalidateChainConfigCache, listChainConfigs, type ChainConfigRow } from "@/lib/chainConfigs";

/**
 * 管理面板:每条链的发射工厂参数配置。
 * GET    /api/admin/chains        列表 + 链上实时参数(只读)
 * PUT    /api/admin/chains        更新某链配置(需管理员钱包 header)
 * POST   /api/admin/chains        新增链配置(需管理员钱包 header)
 * DELETE /api/admin/chains        删除发射台或整条链配置(需管理员)
 *
 * 鉴权说明(开发阶段):写操作校验 x-admin-wallet 请求头是否命中
 * ADMIN_WALLETS / NEXT_PUBLIC_ADMIN_WALLETS(逗号分隔)。这只是名单拦截,
 * 正式环境应换成 Privy access token 验签(参考 apps/chat 的 PRIVY_APP_SECRET 流程)。
 */

function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

async function checkAdmin(req: NextRequest): Promise<NextResponse | null> {
  const gate = await requireAdminReason(req);
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return null;
}

/** 任意 chainId 的通用 viem Chain(管理面板可能登记未收录的链) */
function genericChain(chainId: number, name: string, rpcUrl: string): Chain {
  return {
    id: chainId,
    name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** 链上实时参数:逐条读,失败降级为 null 并带错误说明,不拖垮整个列表 */
async function readOnchain(row: ChainConfigRow) {
  const client = createPublicClient({
    chain: genericChain(row.chainId, row.name, row.rpcUrl),
    // 该 RPC 网关在批量模式下会间歇丢响应(见 apps/indexer/src/config.ts 注释),必须单请求
    transport: http(row.rpcUrl, { batch: false, retryCount: 1, retryDelay: 500, timeout: 8000 }),
  });
  const out: Record<string, unknown> = {};
  const safe = async <T>(key: string, fn: () => Promise<T>, fmt: (v: T) => unknown = (v) => v) => {
    try {
      out[key] = fmt(await fn());
    } catch (e) {
      out[key] = null;
      out[`${key}Error`] = (e as Error).message.slice(0, 80);
    }
  };

  // 五个合约地址的部署状态(getCode)
  for (const [key, addr] of Object.entries({
    factory: row.factory, hook: row.hook, registry: row.registry,
    swapRouter: row.swapRouter, poolManager: row.poolManager,
    ponsFactory: row.ponsFactory, ponsHook: row.ponsHook,
  })) {
    if (!addr) continue;
    await safe(`deployed_${key}`, async () => ((await client.getCode({ address: addr as Address })) ?? "0x") !== "0x");
  }
  // 工厂参数
  await safe("tokenCount", () =>
    client.readContract({ address: row.factory as Address, abi: snowAbis.snowOnFactoryAbi, functionName: "allTokensLength" }),
  );
  await safe("protocolSplit", async () => {
    const [creatorBps, snowBuyBps, revenueBps] = await client.readContract({
      address: row.factory as Address, abi: snowAbis.snowOnFactoryAbi, functionName: "protocolSplit",
    });
    return { creatorBps, snowBuyBps, revenueBps };
  });
  await safe("graduationThresholdEth", async () => {
    const wei = await client.readContract({
      address: row.factory as Address, abi: snowAbis.snowOnFactoryAbi, functionName: "graduationThreshold", args: [zeroAddress],
    });
    return Number(wei) / 1e18;
  });
  // 路由费 / 报价资产白名单
  await safe("swapRouterFeeBps", () =>
    client.readContract({ address: row.swapRouter as Address, abi: snowAbis.snowSwapRouterAbi, functionName: "feeBps" }),
  );
  await safe("allowedPairs", () =>
    client.readContract({ address: row.registry as Address, abi: snowAbis.snowPairRegistryAbi, functionName: "allowedPairsLength" }),
  );
  return out;
}

export async function GET() {
  try {
    const rows = await listChainConfigs();
    const result = [];
    for (const row of rows) {
      const cid = row.chainId;
      const envFactory = process.env[`PONS_FACTORY_${cid}`] ?? "";
      const envHook = process.env[`PONS_HOOK_${cid}`] ?? "";
      const envDeploy = process.env[`PONS_DEPLOY_BLOCK_${cid}`] ?? "";
      const ponsOn = row.ponsEnabled !== false;
      const ponsFactory = !ponsOn
        ? (row.ponsFactory || "")
        : (row.ponsFactory && ADDR_RE.test(row.ponsFactory)
          ? row.ponsFactory
          : (ADDR_RE.test(envFactory) ? envFactory.toLowerCase() : DEFAULT_PONS_FACTORY));
      const ponsHook = !ponsOn
        ? (row.ponsHook || "")
        : (row.ponsHook && ADDR_RE.test(row.ponsHook)
          ? row.ponsHook
          : (ADDR_RE.test(envHook) ? envHook.toLowerCase() : DEFAULT_PONS_HOOK));
      const dbDeploy = row.ponsDeployBlock != null ? BigInt(String(row.ponsDeployBlock).split(".")[0] || "0") : 0n;
      const ponsDeployBlock = !ponsOn
        ? dbDeploy
        : (dbDeploy > 0n ? dbDeploy : BigInt(envDeploy || String(DEFAULT_PONS_DEPLOY_BLOCK)));
      const filled = { ...row, ponsFactory, ponsHook, ponsDeployBlock, snowonEnabled: row.snowonEnabled !== false, ponsEnabled: ponsOn };
      const onchain = await readOnchain(filled);
      let ponsTokenCount = 0;
      try {
        const [cnt] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(tokens)
          .where(and(eq(tokens.chainId, cid), eq(tokens.platformId, "pons")));
        ponsTokenCount = Number(cnt?.n ?? 0);
      } catch { /* 列未迁完时不拖垮列表 */ }
      result.push(jsonSafe({ ...filled, ponsTokenCount, onchain }));
    }
    return NextResponse.json({ chains: result, adminWalletsConfigured: envAdminWallets().length > 0 });
  } catch (e) {
    return apiError(e);
  }
}

const EDITABLE = [
  "name", "rpcUrl", "wsUrl", "factory", "hook", "registry", "swapRouter", "poolManager", "deployBlock", "enabled",
  "ponsFactory", "ponsHook", "ponsDeployBlock", "snowonEnabled", "ponsEnabled",
] as const;
const ADDR_KEYS = new Set(["factory", "hook", "registry", "swapRouter", "poolManager", "ponsFactory", "ponsHook"]);
const BLOCK_KEYS = new Set(["deployBlock", "ponsDeployBlock"]);

function validatePatch(body: Record<string, unknown>): { patch: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    const v = body[key];
    if (ADDR_KEYS.has(key)) {
      if (typeof v !== "string" || !ADDR_RE.test(v)) return { patch, error: `${key} 不是合法地址` };
      patch[key] = v.toLowerCase();
    } else if (BLOCK_KEYS.has(key)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return { patch, error: `${key} 必须是非负数字` };
      patch[key] = BigInt(Math.floor(n));
    } else if (key === "enabled" || key === "ponsEnabled" || key === "snowonEnabled") {
      patch[key] = !!v;
    } else if (key === "wsUrl") {
      patch[key] = typeof v === "string" && v.trim() ? v.trim() : null;
    } else {
      if (typeof v !== "string" || !v.trim()) return { patch, error: `${key} 不能为空` };
      patch[key] = v.trim();
    }
  }
  return { patch };
}

export async function PUT(req: NextRequest) {
  const deny = await checkAdmin(req);
  if (deny) return deny;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const chainId = Number(body.chainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      return NextResponse.json({ error: "chainId 缺失或非法" }, { status: 400 });
    }
    const { patch, error } = validatePatch(body);
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "没有可更新字段" }, { status: 400 });

    const [updated] = await db
      .update(chainConfigs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(chainConfigs.chainId, chainId))
      .returning();
    if (!updated) return NextResponse.json({ error: `chain ${chainId} 不存在,请用 POST 新增` }, { status: 404 });
    invalidateChainConfigCache(chainId);
    return NextResponse.json(jsonSafe({ ok: true, chain: updated }));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  const deny = await checkAdmin(req);
  if (deny) return deny;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const chainId = Number(body.chainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      return NextResponse.json({ error: "chainId 缺失或非法" }, { status: 400 });
    }
    const { patch, error } = validatePatch(body);
    if (error) return NextResponse.json({ error }, { status: 400 });
    for (const required of ["name", "rpcUrl", "factory", "hook", "registry", "swapRouter", "poolManager"] as const) {
      if (!(required in patch)) return NextResponse.json({ error: `缺少必填字段 ${required}` }, { status: 400 });
    }
    const [created] = await db
      .insert(chainConfigs)
      .values({
        chainId,
        platformId: typeof body.platformId === "string" && body.platformId.trim() ? body.platformId.trim() : "snowon",
        deployBlock: 0n,
        enabled: true,
        ...(patch as Record<string, unknown>),
      } as never)
      .onConflictDoNothing()
      .returning();
    if (!created) return NextResponse.json({ error: `chain ${chainId} 已存在,请用 PUT 修改` }, { status: 409 });
    invalidateChainConfigCache(chainId);
    return NextResponse.json(jsonSafe({ ok: true, chain: created }));
  } catch (e) {
    return apiError(e);
  }
}

/**
 * DELETE /api/admin/chains?chainId=4663&platform=snowon|pons|chain
 * snowon/pons:停用该发射台(已索引代币保留)
 * chain:删除整条链配置行
 */
export async function DELETE(req: NextRequest) {
  const deny = await checkAdmin(req);
  if (deny) return deny;
  try {
    const q = req.nextUrl.searchParams;
    const chainId = Number(q.get("chainId"));
    const platform = (q.get("platform") ?? "").toLowerCase();
    if (!Number.isInteger(chainId) || chainId <= 0) {
      return NextResponse.json({ error: "chainId 缺失或非法" }, { status: 400 });
    }
    if (platform === "chain") {
      const [deleted] = await db.delete(chainConfigs).where(eq(chainConfigs.chainId, chainId)).returning();
      if (!deleted) return NextResponse.json({ error: `chain ${chainId} 不存在` }, { status: 404 });
      invalidateChainConfigCache(chainId);
      return NextResponse.json({ ok: true, deleted: "chain", chainId });
    }
    if (platform === "pons" || platform === "snowon") {
      const patch = platform === "pons" ? { ponsEnabled: false } : { snowonEnabled: false };
      const [updated] = await db
        .update(chainConfigs)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(chainConfigs.chainId, chainId))
        .returning();
      if (!updated) return NextResponse.json({ error: `chain ${chainId} 不存在` }, { status: 404 });
      invalidateChainConfigCache(chainId);
      return NextResponse.json(jsonSafe({ ok: true, chain: updated }));
    }
    return NextResponse.json({ error: "platform 必须是 snowon / pons / chain" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
