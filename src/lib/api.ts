import "server-only";
import { NextResponse } from "next/server";
import { getWorkspace, type Workspace } from "@/lib/data/workspace";
import { getSession, isFullyAuthenticated, type SessionUser } from "@/lib/auth/session";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (error: string, status = 400) => json({ error }, status);

/** Resolve the caller's workspace; returns a 401 response when unauthenticated. */
export async function withWorkspace(): Promise<{ ws: Workspace } | { res: NextResponse }> {
  try {
    return { ws: await getWorkspace() };
  } catch (e) {
    const m = (e as Error).message;
    if (m === "UNAUTHENTICATED") return { res: fail("Not signed in", 401) };
    if (m === "MFA_REQUIRED") return { res: fail("MFA verification required", 401) };
    throw e;
  }
}

/** Fully authenticated (password + MFA if enabled) live user. */
export async function requireUser(): Promise<{ user: SessionUser } | { res: NextResponse }> {
  const s = await getSession();
  if (!s) return { res: fail("Not signed in", 401) };
  if (!isFullyAuthenticated(s)) return { res: fail("MFA verification required", 401) };
  return { user: s };
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}
