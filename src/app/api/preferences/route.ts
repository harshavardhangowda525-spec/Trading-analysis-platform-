import { z } from "zod";
import { fail, json, requireUser } from "@/lib/api";

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
  const { error } = await a.sb.from("user_preferences").upsert({ user_id: a.user.id, ...b.data, updated_at: new Date().toISOString() });
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}
