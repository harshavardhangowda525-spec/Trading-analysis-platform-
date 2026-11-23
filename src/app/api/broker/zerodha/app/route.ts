import { z } from "zod";
import { clientIp, fail, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { audit } from "@/lib/data/pipeline";
import { encryptSecret } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";

/** GET → whether the user has saved their own Kite Connect app (never returns the secret). */
export async function GET() {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const [row] = await db()`select api_key, updated_at from kite_apps where user_id = ${a.user.userId}`;
  return json({ configured: !!row, apiKeyHint: row ? `${row.api_key.slice(0, 4)}…${row.api_key.slice(-2)}` : null });
}

const Body = z.object({
  apiKey: z.string().trim().regex(/^[A-Za-z0-9]{6,64}$/, "API key looks invalid"),
  apiSecret: z.string().trim().regex(/^[A-Za-z0-9]{10,128}$/, "API secret looks invalid"),
});

/** POST → save (or replace) the user's Kite Connect API key + secret. The secret is AES-256-GCM encrypted. */
export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  if (!serverEnv().tokenEncryptionKey) return fail("Server encryption key is not configured", 501);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail(b.error.issues.map((i) => i.message).join("; "));
  const uid = a.user.userId;
  await db()`insert into kite_apps (user_id, api_key, api_secret_enc) values (${uid}, ${b.data.apiKey}, ${encryptSecret(b.data.apiSecret)})
             on conflict (user_id) do update set api_key = excluded.api_key, api_secret_enc = excluded.api_secret_enc, updated_at = now()`;
  await audit(uid, "broker.app_saved", { api_key_suffix: b.data.apiKey.slice(-2) }, "kite_apps", uid, clientIp(req));
  return json({ ok: true });
}

/** DELETE → remove saved app credentials (also drops any stored Kite session). */
export async function DELETE(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const uid = a.user.userId;
  const q = db();
  await q.transaction([
    q`delete from kite_apps where user_id = ${uid}`,
    q`delete from broker_secrets where user_id = ${uid}`,
    q`update broker_connections set status = 'disconnected', disconnected_at = now(), updated_at = now() where user_id = ${uid}`,
  ]);
  await audit(uid, "broker.app_removed", {}, "kite_apps", uid, clientIp(req));
  return json({ ok: true });
}
