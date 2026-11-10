import { fail, json, requireUser } from "@/lib/api";
import { integrationStatus } from "@/lib/env";
import { syncUser } from "@/lib/kite/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const a = await requireUser();
  if ("res" in a) return a.res;
  if (!integrationStatus().kite || !integrationStatus().serviceRole) return fail("Zerodha integration is not configured on the server", 501);
  const admin = createAdminClient();
  const { data: last } = await admin.from("broker_sync_runs").select("started_at").eq("user_id", a.user.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.started_at) < 60_000) return fail("Please wait a minute between manual syncs", 429);
  const out = await syncUser(admin, a.user.id, "manual");
  return json(out, out.status === "sync_failed" ? 502 : 200);
}
