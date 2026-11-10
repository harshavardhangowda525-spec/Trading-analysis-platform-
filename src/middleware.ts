import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const DEMO_COOKIE = "tradeos_demo";
const PUBLIC_PAGES = ["/login", "/auth"];
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isMachine = MACHINE_APIS.some((p) => pathname.startsWith(p));

  if (isApi) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const heavy = /^\/api\/(coach|import|broker|reports|reviews)/.test(pathname);
    if (limited(`${ip}:${heavy ? "heavy" : "api"}`, heavy ? 30 : 180)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    // CSRF: state-changing requests must come from our own origin
    if (!isMachine && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.get("origin");
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      if (!origin || !host || new URL(origin).host !== host) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
    }
    if (isMachine) return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next(); // demo-only deployment

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const user = data.user;
  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const demo = req.cookies.get(DEMO_COOKIE)?.value === "1";

  if (!user) {
    if (!isApi && !isPublic && !demo) return NextResponse.redirect(new URL("/login", req.url));
    return res;
  }

  // Enforce MFA (AAL2) when the user has a verified factor
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2" && pathname !== "/login/mfa" && !pathname.startsWith("/auth")) {
    if (isApi) return NextResponse.json({ error: "MFA verification required" }, { status: 401 });
    return NextResponse.redirect(new URL("/login/mfa", req.url));
  }
  if (pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
