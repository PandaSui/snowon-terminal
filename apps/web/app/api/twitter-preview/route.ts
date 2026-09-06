import { NextResponse } from "next/server";
import { ttlMap } from "@/lib/ttlCache";

export interface TwitterPreview {
  handle: string;
  name: string;
  bio: string;
  avatar: string | null;
  banner: string | null;
  followers: number | null;
  following: number | null;
  website: string | null;
  tweet: string | null;
  url: string;
}

const cache = ttlMap<string, TwitterPreview>(30 * 60_000, 200);

function parseTwitter(raw: string): { handle?: string; statusId?: string } {
  const s = raw.trim();
  if (/^[A-Za-z0-9_]{1,15}$/.test(s.replace(/^@/, ""))) {
    return { handle: s.replace(/^@/, "") };
  }
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, "");
    if (!/^(twitter\.com|x\.com|mobile\.twitter\.com)$/i.test(host)) return {};
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts[0] || parts[0] === "i" || parts[0] === "intent") return {};
    const handle = parts[0].replace(/^@/, "");
    const statusId = parts[1] === "status" && parts[2] ? parts[2] : undefined;
    return { handle, statusId };
  } catch {
    return {};
  }
}

function asUser(j: Record<string, unknown>): Partial<TwitterPreview> {
  const user = (j.user ?? j) as Record<string, unknown>;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    handle: String(user.screen_name ?? user.username ?? "").replace(/^@/, ""),
    name: String(user.name ?? ""),
    bio: String(user.description ?? user.bio ?? ""),
    avatar: (user.avatar_url ?? user.avatar ?? user.profile_image_url_https ?? null) as string | null,
    banner: (user.banner_url ?? user.profile_banner_url ?? null) as string | null,
    followers: n(user.followers ?? user.followers_count),
    following: n(user.following ?? user.friends_count),
    website: (user.website ?? null) as string | null,
  };
}

/** GET ?url=https://x.com/handle  → 资料 + 可选推文 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url).searchParams.get("url") ?? "";
    const { handle, statusId } = parseTwitter(url);
    if (!handle) return NextResponse.json({ error: "bad twitter url" }, { status: 400 });
    const cacheKey = `${handle.toLowerCase()}:${statusId ?? ""}`;
    const hit = cache.get(cacheKey);
    if (hit) return NextResponse.json(hit);

    const headers = { "user-agent": "Mozilla/5.0 SnowOnTerminal", accept: "application/json" };
    let tweet: string | null = null;
    let profile: Partial<TwitterPreview> = { handle };

    if (statusId) {
      const r = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${encodeURIComponent(statusId)}`, {
        headers, signal: AbortSignal.timeout(8_000),
      });
      if (r.ok) {
        const j = (await r.json()) as { tweet?: { text?: string; author?: Record<string, unknown> }; user?: Record<string, unknown> };
        tweet = j.tweet?.text ?? null;
        if (j.tweet?.author) profile = { ...profile, ...asUser(j.tweet.author) };
        else if (j.user) profile = { ...profile, ...asUser(j as unknown as Record<string, unknown>) };
      }
    }

    if (!profile.name) {
      const r = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`, {
        headers, signal: AbortSignal.timeout(8_000),
      });
      if (r.ok) {
        const j = (await r.json()) as Record<string, unknown>;
        profile = { ...profile, ...asUser(j) };
      }
    }

    const out: TwitterPreview = {
      handle: profile.handle || handle,
      name: profile.name || handle,
      bio: profile.bio || "",
      avatar: profile.avatar ?? null,
      banner: profile.banner ?? null,
      followers: profile.followers ?? null,
      following: profile.following ?? null,
      website: profile.website ?? null,
      tweet,
      url: `https://x.com/${profile.handle || handle}${statusId ? `/status/${statusId}` : ""}`,
    };
    cache.set(cacheKey, out);
    return NextResponse.json(out, { headers: { "Cache-Control": "public, max-age=120" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
