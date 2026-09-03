import { eq } from "drizzle-orm";
import type { Db } from "@terminal/db";
import { indexerCursors } from "@terminal/db";

export async function loadCursor(db: Db, chainId: number): Promise<bigint | null> {
  const [row] = await db
    .select()
    .from(indexerCursors)
    .where(eq(indexerCursors.chainId, chainId))
    .limit(1);
  return row ? row.lastBlock : null;
}

export async function saveCursor(db: Db, chainId: number, lastBlock: bigint): Promise<void> {
  const now = new Date();
  await db
    .insert(indexerCursors)
    .values({ chainId, lastBlock, updatedAt: now })
    .onConflictDoUpdate({
      target: [indexerCursors.chainId],
      set: { lastBlock, updatedAt: now },
    });
}
