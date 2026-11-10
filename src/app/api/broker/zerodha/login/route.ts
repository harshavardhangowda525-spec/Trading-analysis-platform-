import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { env, integrationStatus, serverEnv } from "@/lib/env";
import { loginUrl } from "@/lib/kite/client";

export const dynamic = "force-dynamic";

/** Step 1: redirect to the official Zerodha login. TRADEOS never sees the user's password, PIN or OTP. */
export async function GET() {
  const a = await requireUser();
  if ("res" in a) return NextResponse.redirect(new URL("/login", env.appUrl));
  if (!integrationStatus().kite) return NextResponse.redirect(new URL("/broker?error=kite_not_configured", env.appUrl));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(loginUrl(serverEnv().kiteApiKey, state));
  res.cookies.set("kite_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/broker/zerodha", maxAge: 600 });
  return res;
}
