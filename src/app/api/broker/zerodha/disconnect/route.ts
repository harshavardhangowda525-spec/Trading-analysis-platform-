import { clientIp, fail, json, requireUser } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { audit } from "@/lib/data/pipeline";
import { KiteClient } from "@/lib/kite/client";
import { decryptSecret } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Secure disconnection: invalidate the Kite session, destroy the stored token, keep history. */
export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  if (!serverEnv().serviceRoleKey) return fail("Server not configured", 501);
  const admin = createAdminClient();
  const { data: conn } = await admin.from("broker_connections").select("id").eq("user_id", a.user.id).eq("broker", "zerodha").maybeSingle();
  if (!conn) return json({ ok: true });
  const { data: secret } = await admin.from("broker_secrets").select("access_token_enc").eq("connection_id", conn.id).maybeSingle();
  if (secret) {
    try {
      await new KiteClient(serverEnv().kiteApiKey, decryptSecret(secret.access_token_enc)).invalidateSession();
    } catch {
      /* token may already be expired — still delete locally */
    }
  }
  await admin.from("broker_secrets").delete().eq("connection_id", conn.id);
  await admin.from("broker_connections").update({ status: "disconnected", disconnected_at: new Date().toISOString(), token_expires_at: null, updated_at: new Date().toISOString() }).eq("id", conn.id);
  await audit(a.user.id, "broker.disconnected", {}, "broker_connections", conn.id, clientIp(req));
  return json({ ok: true });
}
