import { z } from "zod";
import { fail, json, requireUser } from "@/lib/api";

const Body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })]);

export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail("Invalid body");
  let q = a.sb.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if ("ids" in b.data) q = q.in("id", b.data.ids);
  const { error } = await q;
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}
