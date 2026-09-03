import { eq } from "drizzle-orm";
import { adminWallets } from "@terminal/db";
import { db } from "@/lib/db";

export interface AdminEntry {
  address: string;
  /** env = 主管理员(配置文件,不可在面板移除);db = 面板添加的协管员 */
  source: "env" | "db";
  addedBy?: string | null;
  createdAt?: string | null;
}

/** env 名单:ADMIN_WALLETS / NEXT_PUBLIC_ADMIN_WALLETS(逗号分隔) */
export function envAdminWallets(): string[] {
  const raw = process.env.ADMIN_WALLETS ?? process.env.NEXT_PUBLIC_ADMIN_WALLETS ?? "";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** env ∪ DB,env 优先(同地址不重复) */
export async function listAdminWallets(): Promise<AdminEntry[]> {
  const env = envAdminWallets();
  let dbRows: Array<{ address: string; addedBy: string | null; createdAt: Date }> = [];
  try {
    dbRows = await db.select().from(adminWallets);
  } catch {
    /* 表未建/库不可达时退回 env 名单 */
  }
  const envSet = new Set(env);
  return [
    ...env.map((address) => ({ address, source: "env" as const })),
    ...dbRows
      .filter((r) => !envSet.has(r.address))
      .map((r) => ({
        address: r.address,
        source: "db" as const,
        addedBy: r.addedBy,
        createdAt: r.createdAt?.toISOString() ?? null,
      })),
  ];
}

export async function isAdminWallet(wallet: string): Promise<boolean> {
  const w = wallet.toLowerCase();
  if (envAdminWallets().includes(w)) return true;
  try {
    const [row] = await db.select({ address: adminWallets.address }).from(adminWallets).where(eq(adminWallets.address, w)).limit(1);
    return !!row;
  } catch {
    return false;
  }
}
