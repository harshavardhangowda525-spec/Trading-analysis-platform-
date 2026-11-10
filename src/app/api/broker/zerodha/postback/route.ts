import { after } from "next/server";
import { fail, json } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { postbackChecksum } from "@/lib/kite/client";
import { syncUser } from "@/lib/kite/sync";
import { safeEqual } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Kite order-update postback. The payload is an ORDER status update and is never
 * treated as proof of execution: on COMPLETE we only schedule a reconciliation sync
 * that reads executed fills from /trades.
 */
export async function POST(req: Request) {
  const env = serverEnv();
  if (!env.kiteApiSecret || !env.serviceRoleKey) return fail("Not configured", 501);
  const raw = await req.text();
  if (raw.length > 64_000) return fail("Payload too large", 413);
  let p: { order_id?: string; order_timestamp?: string; checksum?: string; user_id?: string; status?: string; tradingsymbol?: string; exchange?: string };
  try {
    p = JSON.parse(raw);
  } catch {
    return fail("Invalid JSON");
  }
  if (!p.order_id || !p.order_timestamp || !p.checksum || !p.user_id) return fail("Missing fields");
  if (!safeEqual(postbackChecksum(p.order_id, p.order_timestamp, env.kiteApiSecret), p.checksum)) return fail("Bad checksum", 401);

  const admin = createAdminClient();
  const { data: conn } = await admin.from("broker_connections").select("user_id, status").eq("broker", "zerodha").eq("broker_user_id", p.user_id).maybeSingle();
  if (!conn) return json({ ok: true }); // unknown account — acknowledge without action
  await admin.from("raw_orders").upsert(
    { user_id: conn.user_id, broker_order_id: p.order_id, status: p.status ?? null, tradingsymbol: p.tradingsymbol ?? null, exchange: p.exchange ?? null, payload: { ...p, checksum: undefined }, received_at: new Date().toISOString() },
    { onConflict: "user_id,broker_order_id" }
  );
  if (p.status === "COMPLETE" && ["connected", "updated", "partial"].includes(conn.status)) {
    after(() => syncUser(admin, conn.user_id, "postback").catch(() => undefined));
  }
  return json({ ok: true });
}
