import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEMO_COOKIE } from "@/lib/data/workspace";

/** Email confirmation / magic-link PKCE code exchange. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      const res = NextResponse.redirect(new URL("/", u.origin));
      res.cookies.delete(DEMO_COOKIE);
      return res;
    }
  }
  return NextResponse.redirect(new URL("/login?error=auth", u.origin));
}
