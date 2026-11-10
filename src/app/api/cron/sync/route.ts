import { fail, json } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { safeEqual } from "@/lib/security/crypto";
import { syncUser } from "@/lib/kite/sync";
import { calendarWeek, addDays, weekdayOf, localDate } from "@/lib/engine/time";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled daily collection (Vercel Cron, after market close IST).
 * Kite's /trades only returns the current day, so this run is what preserves history.
 */
export async function GET(req: Request) {
  const env = serverEnv();
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) return fail("Unauthorized", 401);
  if (!env.serviceRoleKey) return fail("Service role not configured", 501);
  const admin = createAdminClient();
  const { data: conns } = await admin.from("broker_connections").select("user_id").eq("broker", "zerodha").in("status", ["connected", "updated", "partial", "sync_failed", "synchronizing"]);
  const results: Record<string, string> = {};
  for (const c of conns ?? []) {
    try {
      results[c.user_id] = (await syncUser(admin, c.user_id, "scheduled")).status;
    } catch (e) {
      results[c.user_id] = `error: ${(e as Error).message}`;
    }
  }
  // Weekly report notification on Saturday (IST) for the just-finished trading week
  const today = localDate(new Date());
  if (weekdayOf(today) === 6) {
    const week = calendarWeek(new Date()).start;
    const { data: users } = await admin.from("user_preferences").select("user_id");
    if (users?.length)
      await admin.from("notifications").upsert(
        users.map((u) => ({ user_id: u.user_id, type: "weekly_report_ready", title: "Weekly report ready", body: `Your report for ${week} to ${addDays(week, 6)} is ready.`, data: { href: `/reports?week=${week}` }, dedupe_key: `weekly:${week}` })),
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
      );
  }
  return json({ synced: Object.keys(results).length, results });
}
