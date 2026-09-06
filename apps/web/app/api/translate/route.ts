import { NextResponse } from "next/server";
import { ttlMap } from "@/lib/ttlCache";

type Locale = "zh" | "en" | "ko";
const LANG: Record<Locale, { name: string; gtx: string }> = {
  zh: { name: "Simplified Chinese", gtx: "zh-CN" },
  en: { name: "English", gtx: "en" },
  ko: { name: "Korean", gtx: "ko" },
};

const cache = ttlMap<string, string>(6 * 60 * 60_000, 2000);

function keyOf(to: Locale, text: string) {
  return `${to}:${text}`;
}

async function gtxOne(text: string, to: Locale): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${LANG[to].gtx}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!r.ok) return text;
  const j = (await r.json()) as unknown;
  if (!Array.isArray(j) || !Array.isArray(j[0])) return text;
  const out = (j[0] as Array<[string]>).map((p) => p?.[0] ?? "").join("");
  return out.trim() || text;
}

async function xaiBatch(texts: string[], to: Locale): Promise<string[] | null> {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              `Translate each string into ${LANG[to].name}. Return a JSON array of strings of the same length and order. Do not translate crypto tickers, $SYMBOL, or 0x addresses. Keep tone. Output JSON only.`,
          },
          { role: "user", content: JSON.stringify(texts) },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content?.trim() ?? "";
    const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, "");
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr) || arr.length !== texts.length) return null;
    return arr.map((s, i) => (typeof s === "string" && s.trim() ? s.trim() : texts[i]));
  } catch {
    return null;
  }
}

/** POST { to: zh|en|ko, texts: string[] } → { texts: string[] } */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { to?: string; texts?: unknown };
    const to = body.to === "en" || body.to === "ko" || body.to === "zh" ? body.to : "zh";
    const texts = Array.isArray(body.texts)
      ? body.texts.map((s) => String(s ?? "")).slice(0, 40)
      : [];
    if (texts.length === 0) return NextResponse.json({ texts: [] });

    const out = new Array<string>(texts.length);
    const miss: number[] = [];
    texts.forEach((t, i) => {
      const src = t.trim();
      if (!src) {
        out[i] = t;
        return;
      }
      const hit = cache.get(keyOf(to, src));
      if (hit != null) out[i] = hit;
      else miss.push(i);
    });

    if (miss.length > 0) {
      const batch = miss.map((i) => texts[i]);
      const ai = await xaiBatch(batch, to);
      if (ai) {
        miss.forEach((i, k) => {
          out[i] = ai[k] ?? texts[i];
          cache.set(keyOf(to, texts[i].trim()), out[i]);
        });
      } else {
        await Promise.all(
          miss.map(async (i) => {
            try {
              out[i] = await gtxOne(texts[i], to);
            } catch {
              out[i] = texts[i];
            }
            cache.set(keyOf(to, texts[i].trim()), out[i]);
          }),
        );
      }
    }

    return NextResponse.json({ texts: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
