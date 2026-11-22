import { z } from "zod";
import QRCode from "qrcode";
import { clientIp, fail, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { getSession, markMfaPassed } from "@/lib/auth/session";
import { newTotpSecret, otpauthUrl, verifyTotp } from "@/lib/auth/totp";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { audit } from "@/lib/data/pipeline";

export const dynamic = "force-dynamic";

/** GET: MFA status. */
export async function GET() {
  const s = await getSession();
  if (!s) return fail("Not signed in", 401);
  return json({ enabled: s.totpEnabled, passed: s.mfaPassed });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("confirm"), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("disable"), code: z.string().regex(/^\d{6}$/) }),
]);

/**
 * enroll  → new secret (stored encrypted, not yet enabled) + QR code
 * confirm → first valid code enables TOTP
 * verify  → login challenge for a session pending MFA
 * disable → requires a valid code
 */
export async function POST(req: Request) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail("Invalid request");
  const q = db();
  const s = await getSession();
  if (!s) return fail("Not signed in", 401);

  if (b.data.action === "verify") {
    const [u] = await q`select totp_secret_enc, totp_enabled from users where id = ${s.userId}`;
    if (!u?.totp_enabled) return json({ ok: true });
    if (!verifyTotp(decryptSecret(u.totp_secret_enc), b.data.code)) {
      await audit(s.userId, "auth.mfa_failed", {}, undefined, undefined, clientIp(req));
      return fail("Invalid code", 401);
    }
    await markMfaPassed(s.sessionId);
    return json({ ok: true });
  }

  const a = await requireUser();
  if ("res" in a) return a.res;
  if (b.data.action === "enroll") {
    if (s.totpEnabled) return fail("Two-factor authentication is already enabled");
    const secret = newTotpSecret();
    await q`update users set totp_secret_enc = ${encryptSecret(secret)} where id = ${s.userId}`;
    const url = otpauthUrl(secret, s.email);
    return json({ secret, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
  }
  const [u] = await q`select totp_secret_enc, totp_enabled from users where id = ${s.userId}`;
  if (!u?.totp_secret_enc) return fail("Start enrolment first");
  if (!verifyTotp(decryptSecret(u.totp_secret_enc), b.data.code)) return fail("Invalid code", 401);
  if (b.data.action === "confirm") {
    await q`update users set totp_enabled = true where id = ${s.userId}`;
    await markMfaPassed(s.sessionId);
    await audit(s.userId, "auth.mfa_enabled", {}, "users", s.userId, clientIp(req));
  } else {
    await q`update users set totp_enabled = false, totp_secret_enc = null where id = ${s.userId}`;
    await audit(s.userId, "auth.mfa_disabled", {}, "users", s.userId, clientIp(req));
  }
  return json({ ok: true });
}
