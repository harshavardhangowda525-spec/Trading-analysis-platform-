import { after } from "next/server";
import { fail, json } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { postbackChecksum } from "@/lib/kite/client";
import { getKiteCredsByBrokerUser } from "@/lib/kite/credentials";
import { syncUser } from "@/lib/kite/sync";
import { safeEqual } from "@/lib/security/crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Kite order-update postback. The payload is an ORDER status update and is never
 * treated as proof of execution: on COMPLETE we only schedule a reconciliation sync
 * that reads executed fills from /trades.
 */
export async function POST(req: Request) {
  const env = serverEnv();
  if (!env.databaseUrl) return fail("Not configured", 501);
  const raw = await req.text();
  if (raw.length > 64_000) return fail("Payload too large", 413);
  let p: { order_id?: string; order_timestamp?: string; checksum?: string; user_id?: string; status?: string; tradingsymbol?: string; exchange?: string };
  try {
    p = JSON.parse(raw);
  } catch {
    return fail("Invalid JSON");
  }
  if (!p.order_id || !p.order_timestamp || !p.checksum || !p.user_id) return fail("Missing fields");
  const found = await getKiteCredsByBrokerUser(p.user_id);
  if (!found) return json({ ok: true }); // unknown account — acknowledge without action
  if (!safeEqual(postbackChecksum(p.order_id, p.order_timestamp, found.creds.apiSecret), p.checksum)) return fail("Bad checksum", 401);
  const q = db();
  const conn = { user_id: found.userId, status: found.status };
  const payload = { ...p, checksum: undefined };
  await q`insert into raw_orders (user_id, broker_order_id, status, tradingsymbol, exchange, payload)
          values (${conn.user_id}, ${p.order_id}, ${p.status ?? null}, ${p.tradingsymbol ?? null}, ${p.exchange ?? null}, ${JSON.stringify(payload)}::jsonb)
          on conflict (user_id, broker_order_id) do update set status = excluded.status, payload = excluded.payload, received_at = now()`;
  if (p.status === "COMPLETE" && ["connected", "updated", "partial"].includes(conn.status)) {
    after(() => syncUser(conn.user_id, "postback").catch(() => undefined));
  }
  return json({ ok: true });
}
