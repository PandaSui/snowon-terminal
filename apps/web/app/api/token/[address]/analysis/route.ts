import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { CHAIN_ID, db } from "@/lib/db";
import { apiError } from "@/lib/api";

function asRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { rows?: unknown }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildRules(s: {
  uniqueTraders: number;
  buyVolEth: number;
  sellVolEth: number;
  newWalletBuyShare: number;
  newWalletCount: number;
  clusterCount: number;
  clusterEth: number;
  phishEth: number;
  trades24h: number;
}): string[] {
  const out: string[] = [];
  if (s.trades24h === 0) {
    out.push("近 24 小时没有成交，样本不足，无法判断买卖结构。");
    return out;
  }
  out.push(
    `近 24h ${s.trades24h} 笔、${s.uniqueTraders} 个钱包；买盘 ${s.buyVolEth.toFixed(4)} ETH，卖盘 ${s.sellVolEth.toFixed(4)} ETH。`,
  );
  if (s.newWalletBuyShare >= 0.3) {
    out.push(`新钱包(首见≤24h)买入占买盘 ${(s.newWalletBuyShare * 100).toFixed(0)}%（${s.newWalletCount} 个地址），像冲新或捆绑。`);
  } else if (s.newWalletCount > 0) {
    out.push(`新钱包参与 ${s.newWalletCount} 个，买入占比 ${(s.newWalletBuyShare * 100).toFixed(0)}%。`);
  }
  if (s.clusterCount >= 1) {
    out.push(`检测到 ${s.clusterCount} 组同资金来源持仓，合计买入约 ${s.clusterEth.toFixed(4)} ETH，优先看成捆绑。`);
  }
  if (s.phishEth > 0) {
    out.push(`钓鱼/混币标签地址涉及约 ${s.phishEth.toFixed(4)} ETH 成交，注意对手盘。`);
  }
  if (s.sellVolEth > s.buyVolEth * 1.4) {
    out.push("近 24h 卖压明显大于买盘。");
  } else if (s.buyVolEth > s.sellVolEth * 1.4) {
    out.push("近 24h 买盘占优。");
  }
  return out;
}

/**
 * LLM 风控结论。OpenAI 兼容协议,环境变量可配:
 *   AI_API_KEY   (必填,缺省静默降级回规则引擎;兼容旧变量 XAI_API_KEY)
 *   AI_BASE_URL  默认 Moonshot 国际站 https://api.moonshot.ai/v1(国内站 api.moonshot.cn;
 *                Kimi Code 订阅 Key 用 https://api.kimi.com/coding/v1)
 *   AI_MODEL     默认 kimi-k2.6(Kimi Code 订阅用 k3)
 */
async function llmInsight(payload: unknown, lang: string): Promise<string | null> {
  const key = process.env.AI_API_KEY ?? process.env.XAI_API_KEY;
  if (!key) return null;
  const base = (process.env.AI_BASE_URL ?? "https://api.moonshot.ai/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL ?? "kimi-k2.6";
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        // 有的模型(如 k3)只允许 temperature=1,缺省不传交给服务端默认
        ...(process.env.AI_TEMPERATURE !== undefined
          ? { temperature: Number(process.env.AI_TEMPERATURE) }
          : {}),
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              lang === "en"
                ? "You are snowon-terminal AI, the built-in risk analyst of the SnowOn Terminal launchpad trading terminal. Always identify yourself as snowon-terminal AI; never mention Kimi, Moonshot, or any other model or company name. Use only the JSON numbers the user gives. Write 3-6 sentences in English. Focus on new wallets, same-funder bundles, phish/mixers, and buy/sell flow. Do not invent missing data. No investment advice."
                : lang === "ko"
                  ? "당신은 SnowOn Terminal 런치패드 거래 단말기의 내장 리스크 분석가 snowon-terminal AI입니다. 항상 snowon-terminal AI라고만 밝히고, Kimi·Moonshot 등 다른 모델/회사 이름은 절대 언급하지 마세요. 사용자가 준 JSON 숫자만 사용하세요. 한국어로 3-6문장. 신규 지갑, 동일 자금원 번들, 피싱/믹서, 매수/매도 흐름에 집중. 없는 데이터를 만들지 마세요. 투자 조언 금지."
                  : "你是 snowon-terminal AI，SnowOn Terminal 发射盘交易终端的内置风控分析助手。任何时候只能自称 snowon-terminal AI，绝不提及 Kimi、Moonshot 或其他模型/公司名。只用用户给出的 JSON 数字做中文结论，3-6 句。重点：新钱包、同资金来源捆绑、钓鱼/混币、买卖盘。不要编造未提供的数据，不要投资建议口吻。",
          },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      // k3 带推理,真实负载下约 15-25s 返回,超时要留够
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}

/** 从 trades/wallets/positions 汇总，供面板与 AI 分析。配 AI_API_KEY 时再让模型写一段结论。 */
export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const addr = address.toLowerCase();
    const langRaw = new URL(req.url).searchParams.get("lang");
    const lang = langRaw === "en" || langRaw === "ko" ? langRaw : "zh";

    const [volRes, newRes, clusterRes, phishRes] = await Promise.all([
      db.execute(sql`
        SELECT
          count(*)::int AS trades,
          count(DISTINCT trader)::int AS traders,
          coalesce(sum(eth_amount) FILTER (WHERE is_buy), 0)::text AS "buyWei",
          coalesce(sum(eth_amount) FILTER (WHERE NOT is_buy), 0)::text AS "sellWei"
        FROM trades
        WHERE chain_id = ${CHAIN_ID} AND token_address = ${addr}
          AND block_timestamp >= now() - interval '24 hours'
      `),
      db.execute(sql`
        SELECT
          count(DISTINCT tr.trader)::int AS wallets,
          coalesce(sum(tr.eth_amount) FILTER (WHERE tr.is_buy), 0)::text AS "buyWei"
        FROM trades tr
        JOIN wallets w ON w.chain_id = tr.chain_id AND w.address = tr.trader
        WHERE tr.chain_id = ${CHAIN_ID} AND tr.token_address = ${addr}
          AND tr.block_timestamp >= now() - interval '24 hours'
          AND w.first_seen_at >= now() - interval '24 hours'
      `),
      db.execute(sql`
        SELECT
          count(*)::int AS clusters,
          coalesce(sum(eth), 0)::text AS "ethWei"
        FROM (
          SELECT w.first_funder, sum(p.total_bought_eth::numeric) AS eth
          FROM positions p
          JOIN wallets w ON w.chain_id = p.chain_id AND w.address = p.wallet
          WHERE p.chain_id = ${CHAIN_ID} AND p.token_address = ${addr}
            AND p.balance > 0 AND w.first_funder IS NOT NULL AND w.first_funder <> ''
          GROUP BY w.first_funder
          HAVING count(*) >= 2
        ) t
      `),
      db.execute(sql`
        SELECT coalesce(sum(tr.eth_amount), 0)::text AS "ethWei"
        FROM trades tr
        JOIN wallets w ON w.chain_id = tr.chain_id AND w.address = tr.trader
        WHERE tr.chain_id = ${CHAIN_ID} AND tr.token_address = ${addr}
          AND tr.block_timestamp >= now() - interval '24 hours'
          AND (
            w.funder_label = 'mixer'
            OR coalesce(w.labels::text, '') ILIKE '%phish%'
            OR coalesce(w.labels::text, '') ILIKE '%scam%'
            OR coalesce(w.labels::text, '') ILIKE '%mixer%'
          )
      `),
    ]);

    const vol = asRows<{ trades: number; traders: number; buyWei: string; sellWei: string }>(volRes)[0];
    const nw = asRows<{ wallets: number; buyWei: string }>(newRes)[0];
    const cl = asRows<{ clusters: number; ethWei: string }>(clusterRes)[0];
    const ph = asRows<{ ethWei: string }>(phishRes)[0];

    const buyVolEth = num(vol?.buyWei) / 1e18;
    const sellVolEth = num(vol?.sellWei) / 1e18;
    const newBuyEth = num(nw?.buyWei) / 1e18;
    const stats = {
      trades24h: num(vol?.trades),
      uniqueTraders: num(vol?.traders),
      buyVolEth,
      sellVolEth,
      newWalletCount: num(nw?.wallets),
      newWalletBuyEth: newBuyEth,
      newWalletBuyShare: buyVolEth > 0 ? newBuyEth / buyVolEth : 0,
      clusterCount: num(cl?.clusters),
      clusterEth: num(cl?.ethWei) / 1e18,
      phishEth: num(ph?.ethWei) / 1e18,
    };
    const rules = buildRules(stats);
    const llm = await llmInsight({ token: addr, ...stats, rules }, lang);

    return NextResponse.json({
      ...stats,
      rules,
      llm,
      llmEnabled: Boolean(process.env.AI_API_KEY ?? process.env.XAI_API_KEY),
    });
  } catch (e) {
    return apiError(e);
  }
}
