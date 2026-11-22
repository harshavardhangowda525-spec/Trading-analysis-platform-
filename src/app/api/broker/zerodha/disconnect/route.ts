import { clientIp, json, requireUser } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { audit } from "@/lib/data/pipeline";
import { KiteClient } from "@/lib/kite/client";
import { decryptSecret } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";

/** Secure disconnection: invalidate the Kite session, destroy the stored token, keep history. */
export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const uid = a.user.userId;
  const q = db();
  const [conn] = await q`select id from broker_connections where user_id = ${uid} and broker = 'zerodha'`;
  if (!conn) return json({ ok: true });
  const [secret] = await q`select access_token_enc from broker_secrets where connection_id = ${conn.id} and user_id = ${uid}`;
  if (secret) {
    try {
      await new KiteClient(serverEnv().kiteApiKey, decryptSecret(secret.access_token_enc)).invalidateSession();
    } catch {
      /* token may already be expired — still delete locally */
    }
  }
  await q.transaction([
    q`delete from broker_secrets where connection_id = ${conn.id} and user_id = ${uid}`,
    q`update broker_connections set status = 'disconnected', disconnected_at = now(), token_expires_at = null, updated_at = now() where id = ${conn.id} and user_id = ${uid}`,
  ]);
  await audit(uid, "broker.disconnected", {}, "broker_connections", conn.id, clientIp(req));
  return json({ ok: true });
}
