import { z } from "zod";
import { fail, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

const TZ = (() => {
  try {
    return new Set(Intl.supportedValuesOf("timeZone"));
  } catch {
    return new Set(["Asia/Kolkata", "UTC"]);
  }
})();

const Body = z
  .object({
    dashboard_layout: z.array(z.string().regex(/^-?[a-z]+$/).max(30)).max(30).optional(),
    timezone: z.string().refine((t) => TZ.has(t), "unknown timezone").optional(),
    week_start: z.number().int().min(0).max(6).optional(),
    data_mode: z.enum(["live", "demo"]).optional(),
    email_reports: z.boolean().optional(),
  })
  .strict();

export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail(b.error.issues.map((i) => i.message).join("; "));
  const p = b.data;
  await db()`insert into user_preferences (user_id) values (${a.user.userId}) on conflict do nothing`;
  await db()`update user_preferences set
               dashboard_layout = coalesce(${p.dashboard_layout ? JSON.stringify(p.dashboard_layout) : null}::jsonb, dashboard_layout),
               timezone = coalesce(${p.timezone ?? null}, timezone),
               week_start = coalesce(${p.week_start ?? null}::smallint, week_start),
               data_mode = coalesce(${p.data_mode ?? null}, data_mode),
               email_reports = coalesce(${p.email_reports ?? null}::boolean, email_reports),
               updated_at = now()
             where user_id = ${a.user.userId}`;
  return json({ ok: true });
}
