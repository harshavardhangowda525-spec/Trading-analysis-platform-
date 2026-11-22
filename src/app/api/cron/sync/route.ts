import { fail, json } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { safeEqual } from "@/lib/security/crypto";
import { syncUser } from "@/lib/kite/sync";
import { calendarWeek, addDays, weekdayOf, localDate } from "@/lib/engine/time";
import { db } from "@/lib/db";

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
  if (!env.databaseUrl) return fail("Database not configured", 501);
  const q = db();
  const conns = await q`select user_id from broker_connections where broker = 'zerodha' and status in ('connected','updated','partial','sync_failed','synchronizing')`;
  const results: Record<string, string> = {};
  for (const c of conns ?? []) {
    try {
      results[c.user_id] = (await syncUser(c.user_id, "scheduled")).status;
    } catch (e) {
      results[c.user_id] = `error: ${(e as Error).message}`;
    }
  }
  // Weekly report notification on Saturday (IST) for the just-finished trading week
  const today = localDate(new Date());
  if (weekdayOf(today) === 6) {
    const week = calendarWeek(new Date()).start;
    await q`insert into notifications (user_id, type, title, body, data, dedupe_key)
            select user_id, 'weekly_report_ready', 'Weekly report ready', ${`Your report for ${week} to ${addDays(week, 6)} is ready.`},
                   ${JSON.stringify({ href: `/reports?week=${week}` })}::jsonb, ${`weekly:${week}`}
            from user_preferences on conflict (user_id, dedupe_key) do nothing`;
  }
  return json({ synced: Object.keys(results).length, results });
}
