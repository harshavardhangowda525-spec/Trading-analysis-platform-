import { fail, json, requireUser } from "@/lib/api";
import { integrationStatus } from "@/lib/env";
import { db } from "@/lib/db";
import { syncUser } from "@/lib/kite/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const a = await requireUser();
  if ("res" in a) return a.res;
  if (!integrationStatus().kite) return fail("Zerodha integration is not configured on the server", 501);
  const [last] = await db()`select started_at from broker_sync_runs where user_id = ${a.user.userId} order by started_at desc limit 1`;
  if (last && Date.now() - new Date(last.started_at).getTime() < 60_000) return fail("Please wait a minute between manual syncs", 429);
  const out = await syncUser(a.user.userId, "manual");
  return json(out, out.status === "sync_failed" ? 502 : 200);
}
