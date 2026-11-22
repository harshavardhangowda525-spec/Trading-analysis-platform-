import { z } from "zod";
import { clientIp, fail, json } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { audit } from "@/lib/data/pipeline";
import { DEMO_COOKIE } from "@/lib/data/workspace";
import { cookies } from "next/headers";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail("Enter a valid email and password");
  const problem = passwordProblem(b.data.password);
  if (problem) return fail(problem);
  const q = db();
  const hash = await hashPassword(b.data.password);
  const rows = await q`insert into users (email, password_hash) values (${b.data.email}, ${hash})
                       on conflict ((lower(email))) do nothing returning id`;
  if (!rows.length) return fail("An account with this email already exists. Sign in instead.", 409);
  const userId = rows[0].id as string;
  await q.transaction([
    q`insert into user_preferences (user_id) values (${userId}) on conflict do nothing`,
    q`insert into risk_settings (user_id) values (${userId}) on conflict do nothing`,
  ]);
  await createSession(userId, false, { ip: clientIp(req), ua: req.headers.get("user-agent") });
  (await cookies()).delete(DEMO_COOKIE);
  await audit(userId, "auth.signup", {}, "users", userId, clientIp(req));
  return json({ ok: true });
}
