import { z } from "zod";
import { fail, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

const Body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })]);

export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail("Invalid body");
  if ("ids" in b.data) await db()`update notifications set read_at = now() where user_id = ${a.user.userId} and read_at is null and id = any(${b.data.ids}::uuid[])`;
  else await db()`update notifications set read_at = now() where user_id = ${a.user.userId} and read_at is null`;
  return json({ ok: true });
}
