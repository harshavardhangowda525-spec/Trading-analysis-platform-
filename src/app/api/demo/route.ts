import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/data/workspace";

/** Enable anonymous demo mode (synthetic data only — no account data is touched). */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEMO_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEMO_COOKIE);
  return res;
}
