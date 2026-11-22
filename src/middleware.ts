import { NextResponse, type NextRequest } from "next/server";

const DEMO_COOKIE = "tradeos_demo";
const SESSION_COOKIE = "tradeos_session";
const PUBLIC_PAGES = ["/login"];
const MACHINE_APIS = ["/api/broker/zerodha/postback", "/api/cron/"]; // authenticated by checksum / secret

// Best-effort in-memory rate limiter (per instance). Use a shared store (e.g. Upstash) for strict limits.
const buckets = new Map<string, { n: number; reset: number }>();
function limited(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return false;
  }
  b.n++;
  return b.n > max;
}

/**
 * Edge gate: rate limiting, CSRF origin check and a fast redirect for visitors with no
 * session cookie. The session itself (and MFA state) is verified server-side against
 * the database on every request (src/lib/auth/session.ts).
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isMachine = MACHINE_APIS.some((p) => pathname.startsWith(p));

  if (isApi) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (pathname.startsWith("/api/auth/") && pathname !== "/api/auth/logout" && req.method === "POST" && limited(`${ip}:auth`, 20)) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
    const heavy = /^\/api\/(coach|import|broker|reports|reviews)/.test(pathname);
    if (limited(`${ip}:${heavy ? "heavy" : "api"}`, heavy ? 30 : 180)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    if (!isMachine && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.get("origin");
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      if (!origin || !host || new URL(origin).host !== host) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (!process.env.DATABASE_URL) return NextResponse.next(); // demo-only deployment
  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = !!req.cookies.get(SESSION_COOKIE)?.value;
  const demo = req.cookies.get(DEMO_COOKIE)?.value === "1";
  if (!isPublic && !hasSession && !demo) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
