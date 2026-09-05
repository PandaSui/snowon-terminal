import { NextResponse, type NextRequest } from "next/server";

/**
 * CORS for the split deployment: the frontend (Vercel) calls this backend's
 * `/api/*` cross-origin. Allowed origins come from CORS_ALLOW_ORIGIN
 * (comma-separated, or "*"); when unset no CORS headers are added, which is
 * correct for same-origin dev / the all-in-one server build.
 *
 * Auth is header-based (x-admin-wallet), never cookies, so credentialed CORS
 * is not needed — an allow-listed origin echo is enough.
 */
const ALLOW_METHODS = "GET, POST, PUT, DELETE, PATCH, OPTIONS";
const ALLOW_HEADERS = "content-type, x-admin-wallet";

function resolveOrigin(reqOrigin: string | null): string | null {
  const list = (process.env.CORS_ALLOW_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes("*")) return "*";
  if (reqOrigin && list.includes(reqOrigin)) return reqOrigin;
  return null;
}

function applyCors(res: NextResponse, allow: string): void {
  res.headers.set("Access-Control-Allow-Origin", allow);
  res.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
  res.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  res.headers.set("Access-Control-Max-Age", "86400");
  if (allow !== "*") res.headers.append("Vary", "Origin");
}

export function middleware(req: NextRequest): NextResponse {
  const allow = resolveOrigin(req.headers.get("origin"));

  // Preflight
  if (req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    if (allow) applyCors(res, allow);
    return res;
  }

  const res = NextResponse.next();
  if (allow) applyCors(res, allow);
  return res;
}

export const config = { matcher: "/api/:path*" };
