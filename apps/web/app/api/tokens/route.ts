import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { ttlCache } from "@/lib/ttlCache";

const listCache = ttlCache<unknown[]>(2_000);

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

function parseSpark(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (typeof v === "string") {
    return v.replace(/[{}]/g, "").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  return [];
}

const BURN0 = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

/**
 * 发现页:代币列表 + 最新价 + 市值 + 24h 涨幅 + 毕业进度
 * + Top10 持仓占总量 + 捆绑/钓鱼占比 + 社交链接 + 价格火花线。
 * 市值 = priceEth × 总量 10 亿(曲线恒定总量)。
 */
export async function GET() {
  try {
    const cached = listCache.get();
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "public, max-age=1, s-maxage=2, stale-while-revalidate=8" },
      });
    }

    const res = await db.execute(sql`
      WITH listed AS (
        SELECT
          t.address,
          t.creator,
          t.name,
          t.symbol,
          t.logo_uri       AS "logoUri",
          t.graduated,
          t.graduated_at   AS "graduatedAt",
          t.anti_bundle    AS "antiBundle",
          t.created_at     AS "createdAt",
          t.website,
          t.twitter,
          t.telegram,
          t.github,
          t.description,
          t.skill,
          coalesce(lp.price_eth, lastp.price_eth)::text AS "priceEth",
          lp.graduation_progress::text    AS "graduationProgress",
          (coalesce(lp.price_eth, lastp.price_eth) * 1000000000)::text AS "mcapEth",
          CASE
            WHEN base.price_eth IS NULL OR base.price_eth = 0
              OR coalesce(lp.price_eth, lastp.price_eth) IS NULL THEN NULL
            ELSE ((coalesce(lp.price_eth, lastp.price_eth) - base.price_eth) / base.price_eth)::text
          END AS "change24hPct",
          bs.score AS "bundleScore",
          bs.same_funder_share::text AS "bundleShare",
          bs.launch_block_buy_share::text AS "launchBuyShare",
          v24.vol::text AS "volume24hEth"
        FROM tokens t
        LEFT JOIN LATERAL (
          SELECT coalesce(sum(tr.eth_amount::numeric), 0) / 1e18 AS vol
          FROM trades tr
          WHERE tr.chain_id = t.chain_id
            AND tr.token_address = t.address
            AND tr.kind IN ('buy', 'sell')
            AND tr.price_eth > 1e-14 AND tr.price_eth < 0.01
            AND tr.eth_amount::numeric < 1e22
            AND tr.block_timestamp >= now() - interval '24 hours'
        ) v24 ON true
        LEFT JOIN latest_prices lp
          ON lp.token_address = t.address AND lp.chain_id = t.chain_id
          AND lp.price_eth > 1e-14 AND lp.price_eth < 0.01
        LEFT JOIN bundle_scores bs
          ON bs.token_address = t.address AND bs.chain_id = t.chain_id
        LEFT JOIN LATERAL (
          SELECT tr.price_eth
          FROM trades tr
          WHERE tr.chain_id = t.chain_id
            AND tr.token_address = t.address
            AND tr.kind IN ('buy', 'sell')
            AND tr.price_eth > 1e-14 AND tr.price_eth < 0.01
          ORDER BY tr.block_timestamp DESC
          LIMIT 1
        ) lastp ON true
        LEFT JOIN LATERAL (
          SELECT tr.price_eth
          FROM trades tr
          WHERE tr.chain_id = t.chain_id
            AND tr.token_address = t.address
            AND tr.kind IN ('buy', 'sell')
            AND tr.price_eth > 1e-14 AND tr.price_eth < 0.01
            AND tr.block_timestamp >= now() - interval '24 hours'
          ORDER BY tr.block_timestamp ASC
          LIMIT 1
        ) base ON true
        WHERE t.chain_id = ${CHAIN_ID}
        ORDER BY t.created_at DESC
        LIMIT 200
      ),
      pos AS (
        SELECT p.token_address, p.wallet, p.balance AS bal
        FROM positions p
        INNER JOIN listed l ON l.address = p.token_address
        WHERE p.chain_id = ${CHAIN_ID}
          AND p.balance > 0
          AND p.wallet NOT IN (${BURN0}, ${DEAD})
      ),
      ranked AS (
        SELECT token_address, bal,
          row_number() OVER (PARTITION BY token_address ORDER BY bal DESC) AS rn
        FROM pos
      ),
      holder_stats AS (
        SELECT
          token_address,
          (coalesce(SUM(bal) FILTER (WHERE rn <= 10), 0) / 1e18 / 1000000000)::text AS "top10Share"
        FROM ranked
        GROUP BY token_address
      ),
      phish_stats AS (
        SELECT
          p.token_address,
          (coalesce(SUM(p.bal) FILTER (
            WHERE w.funder_label IN ('mixer')
              OR coalesce(w.labels::text, '') ILIKE '%phish%'
              OR coalesce(w.labels::text, '') ILIKE '%scam%'
              OR coalesce(w.labels::text, '') ILIKE '%mixer%'
          ), 0) / 1e18 / 1000000000)::text AS "phishShare"
        FROM pos p
        LEFT JOIN wallets w ON w.chain_id = ${CHAIN_ID} AND w.address = p.wallet
        GROUP BY p.token_address
      )
      SELECT
        l.*,
        CASE WHEN l."volume24hEth"::numeric > 0
          THEN row_number() OVER (ORDER BY l."volume24hEth"::numeric DESC)::int
        END AS "volRank",
        coalesce(hs."top10Share", '0') AS "top10Share",
        coalesce(ps."phishShare", '0') AS "phishShare",
        (coalesce(cpos.bal, 0) / 1e18)::text AS "creatorBal",
        spark.prices AS spark
      FROM listed l
      LEFT JOIN holder_stats hs ON hs.token_address = l.address
      LEFT JOIN phish_stats ps ON ps.token_address = l.address
      LEFT JOIN LATERAL (
        SELECT p.balance::numeric AS bal
        FROM positions p
        WHERE p.chain_id = ${CHAIN_ID}
          AND p.token_address = l.address
          AND p.wallet = l.creator
        LIMIT 1
      ) cpos ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(x.price_eth ORDER BY x.block_timestamp ASC) AS prices
        FROM (
          SELECT tr.price_eth, tr.block_timestamp
          FROM trades tr
          WHERE tr.chain_id = ${CHAIN_ID} AND tr.token_address = l.address
            AND tr.kind IN ('buy', 'sell')
            AND tr.price_eth > 1e-14 AND tr.price_eth < 0.01
          ORDER BY tr.block_timestamp DESC
          LIMIT 32
        ) x
      ) spark ON true
    `);

    const rows = asRows<Record<string, unknown>>(res).map((r) => {
      const creatorBal = Number(r.creatorBal ?? 0);
      return {
        ...r,
        spark: parseSpark(r.spark),
        devDumped: !Number.isFinite(creatorBal) || creatorBal < 1,
      };
    });
    listCache.set(rows);
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "public, max-age=1, s-maxage=2, stale-while-revalidate=8" },
    });
  } catch (e) {
    return apiError(e);
  }
}
