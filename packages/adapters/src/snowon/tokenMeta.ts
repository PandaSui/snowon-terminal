/**
 * snowon.fun 把 logo/简介/社交链接签到 IPFS(kind=token-meta),
 * 通过官网 /api/pinata 列出 pin,再走 ipfs.snowon.fun 拉 JSON。
 */

export interface TokenOffchainMeta {
  description: string | null;
  skill: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  github: string | null;
  logo: string | null;
}

const PINATA = process.env.SNOWON_PINATA_URL ?? "https://www.snowon.fun/api/pinata";
const IPFS = process.env.SNOWON_IPFS_GATEWAY ?? "https://ipfs.snowon.fun/ipfs";

function httpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("ipfs://")) return `${IPFS}/${t.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  return null;
}

function twitterUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const https = httpUrl(t);
  if (https) return https;
  const handle = t.replace(/^@/, "");
  if (/^[A-Za-z0-9_]{1,30}$/.test(handle)) return `https://x.com/${handle}`;
  return null;
}

function telegramUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const https = httpUrl(t);
  if (https) return https;
  const handle = t.replace(/^@/, "");
  if (/^[A-Za-z0-9_]{3,32}$/.test(handle)) return `https://t.me/${handle}`;
  return null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

export async function fetchTokenOffchainMeta(token: string): Promise<TokenOffchainMeta | null> {
  const addr = token.toLowerCase();
  try {
    const listed = (await fetchJson(PINATA, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "pinList",
        metadata: { kind: "token-meta", token: addr },
        pageLimit: 20,
      }),
    })) as { rows?: Array<{ ipfs_pin_hash: string }> };
    const rows = listed.rows ?? [];
    if (rows.length === 0) return null;

    let best: { time: number; body: Record<string, unknown> } | null = null;
    const CONC = 6;
    for (let i = 0; i < rows.length; i += CONC) {
      const slice = rows.slice(i, i + CONC);
      const bodies = await Promise.all(
        slice.map((row) => fetchJson(`${IPFS}/${row.ipfs_pin_hash}`).catch(() => null)),
      );
      for (const raw of bodies) {
        if (!raw || typeof raw !== "object") continue;
        const body = raw as Record<string, unknown>;
        if (body.kind !== "token-meta") continue;
        if (String(body.token ?? "").toLowerCase() !== addr) continue;
        const time = Number(body.time ?? 0);
        if (!best || time >= best.time) best = { time, body };
      }
    }
    if (!best) return null;
    const b = best.body;
    const desc = typeof b.description === "string" ? b.description.trim() : "";
    const skill = typeof b.skill === "string" ? b.skill.trim() : "";
    return {
      description: desc || null,
      skill: skill || null,
      website: httpUrl(b.website),
      twitter: twitterUrl(b.twitter),
      telegram: telegramUrl(b.telegram),
      github: httpUrl(b.github),
      logo: httpUrl(b.logo),
    };
  } catch {
    return null;
  }
}
