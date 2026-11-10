import "server-only";
import { NextResponse } from "next/server";
import { getWorkspace, type Workspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (error: string, status = 400) => json({ error }, status);

/** Resolve the caller's workspace; returns a 401 response when unauthenticated. */
export async function withWorkspace(): Promise<{ ws: Workspace } | { res: NextResponse }> {
  try {
    return { ws: await getWorkspace() };
  } catch (e) {
    if ((e as Error).message === "UNAUTHENTICATED") return { res: fail("Not signed in", 401) };
    throw e;
  }
}

/** Live-mode user (verified with Supabase Auth server). */
export async function requireUser() {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return { res: fail("Not signed in", 401) } as const;
  return { sb, user: data.user } as const;
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}
