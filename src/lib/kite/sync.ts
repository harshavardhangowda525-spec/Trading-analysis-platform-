import "server-only";
import { serverEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/security/crypto";
import { addDays, localDate, zonedToUtc } from "@/lib/engine/time";
import { ingestExecutions, rebuildAnalytics, audit, notify } from "@/lib/data/pipeline";
import { KiteApiError, KiteClient } from "./client";
import { normalizeKiteTrades } from "./normalize";

/** Kite access tokens expire at 06:00 IST the next morning (regulatory daily logout). */
export function tokenExpiry(loginAt = new Date()): string {
  const d = localDate(loginAt);
  const sixToday = zonedToUtc(d, "06:00:00");
  return Date.parse(sixToday) > loginAt.getTime() ? sixToday : zonedToUtc(addDays(d, 1), "06:00:00");
}

export type SyncTrigger = "manual" | "scheduled" | "postback" | "connect";

export interface SyncOutcome {
  status: "updated" | "partial" | "reconnect_required" | "sync_failed" | "skipped";
  inserted?: number;
  duplicates?: number;
  newTrades?: number;
  message?: string;
}

/**
 * Pull today's executed fills (Kite's /trades only covers the current day), preserve
 * them locally, reconcile against broker positions and rebuild analytics.
 * Must only be called with a verified userId.
 */
export async function syncUser(userId: string, trigger: SyncTrigger): Promise<SyncOutcome> {
  const q = db();
  const { kiteApiKey } = serverEnv();
  const [conn] = await q`select * from broker_connections where user_id = ${userId} and broker = 'zerodha'`;
  if (!conn || conn.status === "disconnected") return { status: "skipped", message: "No active Zerodha connection" };
  const [secret] = await q`select access_token_enc from broker_secrets where connection_id = ${conn.id} and user_id = ${userId}`;
  if (!secret) return markReconnect(conn.id, userId, "No stored session — reconnect required");
  if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now()) return markReconnect(conn.id, userId, "Zerodha session expired (daily 06:00 IST logout)");

  const [run] = await q`insert into broker_sync_runs (user_id, connection_id, trigger) values (${userId}, ${conn.id}, ${trigger}) returning id`;
  await q`update broker_connections set status = 'synchronizing', updated_at = now() where id = ${conn.id}`;

  try {
    const kite = new KiteClient(kiteApiKey, decryptSecret(secret.access_token_enc));
    const [trades, orders, positions, holdings] = await Promise.all([kite.trades(), kite.orders(), kite.positions(), kite.holdings()]);

    // Preserve raw order history (status snapshots are NOT treated as executions)
    if (orders.length) {
      const rows = orders.map((o) => ({
        broker_order_id: o.order_id,
        status: o.status,
        tradingsymbol: o.tradingsymbol,
        exchange: o.exchange,
        order_timestamp: o.order_timestamp ? zonedToUtc(o.order_timestamp.slice(0, 10), o.order_timestamp.slice(11, 19)) : null,
        payload: o,
      }));
      await q`insert into raw_orders (user_id, broker_order_id, status, tradingsymbol, exchange, order_timestamp, payload)
              select ${userId}, x.broker_order_id, x.status, x.tradingsymbol, x.exchange, x.order_timestamp, x.payload
              from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(broker_order_id text, status text, tradingsymbol text, exchange text, order_timestamp timestamptz, payload jsonb)
              on conflict (user_id, broker_order_id) do update set status = excluded.status, payload = excluded.payload, received_at = now()`;
    }

    const { executions, rejected } = normalizeKiteTrades(trades);
    const payloads = new Map(trades.map((t) => [`${t.exchange}:${t.trade_id}`, t as unknown]));
    const ing = await ingestExecutions(userId, executions, { source: "kite_api", rowCount: trades.length, errors: rejected, payloads });
    const rb = await rebuildAnalytics(userId);

    // Reconciliation: intraday net quantities reported by Kite vs our reconstruction
    const ours = await q`select exchange, tradingsymbol, product, open_quantity, direction from reconstructed_positions where user_id = ${userId}`;
    const mismatches: string[] = [];
    for (const p of positions.net.filter((x) => x.product === "MIS")) {
      const mine = ours.find((o) => o.exchange === p.exchange && o.tradingsymbol === p.tradingsymbol && o.product === "MIS");
      const mineQty = mine ? Number(mine.open_quantity) * (mine.direction === "SHORT" ? -1 : 1) : 0;
      if (mineQty !== p.quantity) mismatches.push(`${p.exchange}:${p.tradingsymbol} broker=${p.quantity} tradeos=${mineQty}`);
    }
    const partial = rejected.length > 0 || mismatches.length > 0;
    const status = partial ? "partial" : "updated";
    const stats = { fills: trades.length, orders: orders.length, inserted: ing.inserted, duplicates: ing.duplicates, rejected: rejected.length, holdings: holdings.length, newTrades: rb.newTradeKeys.length, mismatches, warnings: rb.warnings.slice(0, 20) };
    await q`update broker_sync_runs set status = ${partial ? "partial" : "succeeded"}, finished_at = now(), stats = ${JSON.stringify(stats)}::jsonb where id = ${run.id}`;
    const lastError = partial ? `Partial data: ${[...mismatches, ...rejected.map((r) => r.reason)].slice(0, 3).join("; ")}` : null;
    await q`update broker_connections set status = ${status}, last_synced_at = now(), last_error = ${lastError}, updated_at = now() where id = ${conn.id}`;
    if (ing.inserted) await notify(userId, "trade_imported", `${ing.inserted} new fill(s) imported from Zerodha`, `${rb.newTradeKeys.length} trade(s) closed.`, "/journal", `import:${run.id}`);
    await audit(userId, "broker.sync", { trigger, ...stats, mismatches: mismatches.length });
    return { status, inserted: ing.inserted, duplicates: ing.duplicates, newTrades: rb.newTradeKeys.length };
  } catch (e) {
    const err = e as Error;
    if (e instanceof KiteApiError && e.requiresReconnect) {
      await q`update broker_sync_runs set status = 'failed', finished_at = now(), error = 'Session expired' where id = ${run.id}`;
      return markReconnect(conn.id, userId, "Zerodha rejected the session token — reconnect required");
    }
    await q`update broker_sync_runs set status = 'failed', finished_at = now(), error = ${err.message} where id = ${run.id}`;
    await q`update broker_connections set status = 'sync_failed', last_error = ${err.message}, updated_at = now() where id = ${conn.id}`;
    await notify(userId, "sync_failed", "Zerodha synchronization failed", err.message.slice(0, 200), "/broker", `sync_failed:${localDate(new Date())}`);
    await audit(userId, "broker.sync_failed", { trigger, error: err.message });
    return { status: "sync_failed", message: err.message };
  }
}

async function markReconnect(connectionId: string, userId: string, message: string): Promise<SyncOutcome> {
  const q = db();
  await q`update broker_connections set status = 'reconnect_required', last_error = ${message}, updated_at = now() where id = ${connectionId} and user_id = ${userId}`;
  await q`delete from broker_secrets where connection_id = ${connectionId} and user_id = ${userId}`;
  await notify(userId, "broker_disconnected", "Zerodha reconnection required", message, "/broker", `reconnect:${localDate(new Date())}`);
  return { status: "reconnect_required", message };
}
