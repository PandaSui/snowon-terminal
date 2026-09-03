import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@terminal/db";
import { tokens } from "@terminal/db";
import { fetchTokenOffchainMeta } from "@terminal/adapters";

export async function applyOffchainMeta(db: Db, chainId: number, tokenAddr: string) {
  const meta = await fetchTokenOffchainMeta(tokenAddr);
  const where = and(eq(tokens.chainId, chainId), eq(tokens.address, tokenAddr.toLowerCase()));
  if (!meta) {
    // 标记已尝试,避免每次启动都打 Pinata
    await db.update(tokens).set({ description: "" }).where(where);
    return null;
  }
  await db
    .update(tokens)
    .set({
      description: meta.description ?? "",
      skill: meta.skill,
      website: meta.website,
      twitter: meta.twitter,
      telegram: meta.telegram,
      github: meta.github,
      ...(meta.logo ? { logoUri: meta.logo } : {}),
    })
    .where(where);
  return meta;
}

/** 回填已入库但还没有简介/社交链接的代币 */
export async function enrichMissingTokenMeta(db: Db, chainId: number) {
  const rows = await db
    .select({ address: tokens.address })
    .from(tokens)
    .where(and(eq(tokens.chainId, chainId), isNull(tokens.description)));
  const CONC = 3;
  for (let i = 0; i < rows.length; i += CONC) {
    await Promise.all(
      rows.slice(i, i + CONC).map(async (r) => {
        try {
          await applyOffchainMeta(db, chainId, r.address);
        } catch (e) {
          console.error(`[meta] ${r.address}`, e);
        }
      }),
    );
  }
}
