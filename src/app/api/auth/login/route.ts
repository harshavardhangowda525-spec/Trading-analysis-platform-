import { z } from "zod";
import { cookies } from "next/headers";
import { clientIp, fail, json } from "@/lib/api";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { audit } from "@/lib/data/pipeline";
import { DEMO_COOKIE } from "@/lib/data/workspace";

const Body = z.object({ email: z.string().trim().toLowerCase().max(254), password: z.string().min(1).max(200) });
// Constant-time-ish path for unknown emails
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export async function POST(req: Request) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail("Enter your email and password");
  const q = db();
  const [u] = await q`select id, password_hash, totp_enabled, failed_logins, locked_until from users where lower(email) = ${b.data.email}`;
  if (u?.locked_until && new Date(u.locked_until).getTime() > Date.now()) return fail("Too many failed attempts. Try again in 15 minutes.", 429);
  const ok = await verifyPassword(b.data.password, u?.password_hash ?? DUMMY);
  if (!u || !ok) {
    if (u)
      await q`update users set failed_logins = failed_logins + 1,
                locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else null end
              where id = ${u.id}`;
    await audit(u?.id ?? null, "auth.login_failed", { email_known: !!u }, undefined, undefined, clientIp(req));
    return fail("Incorrect email or password", 401);
  }
  await q`update users set failed_logins = 0, locked_until = null where id = ${u.id}`;
  await createSession(u.id, false, { ip: clientIp(req), ua: req.headers.get("user-agent") });
  (await cookies()).delete(DEMO_COOKIE);
  await audit(u.id, "auth.login", { mfa_pending: u.totp_enabled }, "users", u.id, clientIp(req));
  return json({ ok: true, mfaRequired: u.totp_enabled });
}
