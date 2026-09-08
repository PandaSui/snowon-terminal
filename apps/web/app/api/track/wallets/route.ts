import { NextResponse } from "next/server";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { trackedWallets } from "@terminal/db";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

const ADDR_OK = /^0x[0-9a-f]{40}$/;
const LIMIT = 10_000;

/**
 * Db 是 Postgres|Pglite 联合类型,带字段的 .returning() 在联合上只能命中 0 参
 * 签名(TS2554)。这里把查询构造器收窄出带参 returning,纯类型层,运行行为不变。
 */
type Returnable<Q> = Q & {
  returning(fields: Record<string, unknown>): Promise<Array<{ address: string }>>;
};
function returnable<Q>(q: Q): Returnable<Q> {
  return q as Returnable<Q>;
}

function ownerOf(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return ADDR_OK.test(s) ? s : null;
}

function cleanAddr(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return ADDR_OK.test(s) ? s : null;
}

function rowJson(r: typeof trackedWallets.$inferSelect) {
  return {
    address: r.address,
    label: r.label || `${r.address.slice(0, 6)}…${r.address.slice(-4)}`,
    note: r.note ?? "",
    watching: r.watching,
    addedAt: r.addedAt ? r.addedAt.getTime() : undefined,
  };
}

async function listFor(owner: string) {
  const rows = await db
    .select()
    .from(trackedWallets)
    .where(and(eq(trackedWallets.chainId, CHAIN_ID), eq(trackedWallets.owner, owner)))
    .orderBy(desc(trackedWallets.addedAt));
  return rows.map(rowJson);
}

/** 某已连接钱包自己的追踪名单。 */
export async function GET(req: Request) {
  try {
    const owner = ownerOf(new URL(req.url).searchParams.get("owner"));
    if (!owner) return NextResponse.json({ error: "connect wallet" }, { status: 401 });
    return NextResponse.json({ owner, wallets: await listFor(owner) });
  } catch (e) {
    return apiError(e);
  }
}

/** 批量加入。body: { owner, items: [{ address, note?, label?, watching? }] } */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      owner?: unknown;
      items?: Array<{ address?: unknown; note?: unknown; label?: unknown; watching?: unknown }>;
    };
    const owner = ownerOf(body.owner);
    if (!owner) return NextResponse.json({ error: "connect wallet" }, { status: 401 });
    const items = Array.isArray(body.items) ? body.items : [];
    const [{ n }] = await db
      .select({ n: count() })
      .from(trackedWallets)
      .where(and(eq(trackedWallets.chainId, CHAIN_ID), eq(trackedWallets.owner, owner)));
    let used = Number(n ?? 0);
    let added = 0;
    let skipped = 0;
    let limitHit = false;
    const toInsert: Array<{
      chainId: number; owner: string; address: string; label: string | null; note: string | null; watching: boolean;
    }> = [];
    const seen = new Set<string>();
    for (const it of items) {
      const address = cleanAddr(it.address);
      if (!address || seen.has(address)) {
        skipped += 1;
        continue;
      }
      seen.add(address);
      if (used + toInsert.length >= LIMIT) {
        limitHit = true;
        skipped += 1;
        continue;
      }
      const note = it.note != null ? String(it.note).trim().slice(0, 80) : "";
      const label = it.label != null ? String(it.label).trim().slice(0, 64) : "";
      toInsert.push({
        chainId: CHAIN_ID,
        owner,
        address,
        label: label || `${address.slice(0, 6)}…${address.slice(-4)}`,
        note: note || null,
        watching: it.watching === false ? false : true,
      });
    }
    if (toInsert.length > 0) {
      const inserted = await returnable(
        db.insert(trackedWallets).values(toInsert).onConflictDoNothing(),
      ).returning({ address: trackedWallets.address });
      added = inserted.length;
      skipped += toInsert.length - added;
      for (const row of toInsert) {
        if (!row.note) continue;
        if (inserted.some((x) => x.address === row.address)) continue;
        await db.execute(sql`
          UPDATE tracked_wallets
          SET note = ${row.note}
          WHERE chain_id = ${CHAIN_ID} AND owner = ${owner} AND address = ${row.address}
            AND (note IS NULL OR note = '')
        `);
      }
    }
    return NextResponse.json({
      owner,
      added,
      skipped,
      limitHit,
      wallets: await listFor(owner),
    });
  } catch (e) {
    return apiError(e);
  }
}

/** 改备注 / 关注。body: { owner, address, note?, watching?, label? } */
export async function PATCH(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      owner?: unknown; address?: unknown; note?: unknown; watching?: unknown; label?: unknown;
    };
    const owner = ownerOf(body.owner);
    const address = cleanAddr(body.address);
    if (!owner) return NextResponse.json({ error: "connect wallet" }, { status: 401 });
    if (!address) return NextResponse.json({ error: "bad address" }, { status: 400 });
    const set: { note?: string | null; watching?: boolean; label?: string | null } = {};
    if (body.note !== undefined) set.note = String(body.note ?? "").trim().slice(0, 80) || null;
    if (body.watching !== undefined) set.watching = body.watching !== false;
    if (body.label !== undefined) set.label = String(body.label ?? "").trim().slice(0, 64) || null;
    if (Object.keys(set).length === 0) return NextResponse.json({ owner, wallets: await listFor(owner) });
    const updated = await returnable(
      db
        .update(trackedWallets)
        .set(set)
        .where(and(eq(trackedWallets.chainId, CHAIN_ID), eq(trackedWallets.owner, owner), eq(trackedWallets.address, address))),
    ).returning({ address: trackedWallets.address });
    if (updated.length === 0) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(trackedWallets)
        .where(and(eq(trackedWallets.chainId, CHAIN_ID), eq(trackedWallets.owner, owner)));
      if (Number(n ?? 0) >= LIMIT) return NextResponse.json({ error: "limit", limitHit: true }, { status: 400 });
      await db.insert(trackedWallets).values({
        chainId: CHAIN_ID,
        owner,
        address,
        label: set.label ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
        note: set.note ?? null,
        watching: set.watching ?? true,
      });
    }
    return NextResponse.json({ owner, wallets: await listFor(owner) });
  } catch (e) {
    return apiError(e);
  }
}

/** 移除。body: { owner, address } */
export async function DELETE(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { owner?: unknown; address?: unknown };
    const owner = ownerOf(body.owner);
    const address = cleanAddr(body.address);
    if (!owner) return NextResponse.json({ error: "connect wallet" }, { status: 401 });
    if (!address) return NextResponse.json({ error: "bad address" }, { status: 400 });
    await db
      .delete(trackedWallets)
      .where(and(eq(trackedWallets.chainId, CHAIN_ID), eq(trackedWallets.owner, owner), eq(trackedWallets.address, address)));
    return NextResponse.json({ owner, wallets: await listFor(owner) });
  } catch (e) {
    return apiError(e);
  }
}
