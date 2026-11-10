import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { decryptSecret } from "@/lib/security/crypto";
import { addDays, localDate, zonedToUtc } from "@/lib/engine/time";
import { ingestExecutions, rebuildAnalytics, audit } from "@/lib/data/pipeline";
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
 * Must be called with the SERVICE-ROLE client and a verified userId.
 */
export async function syncUser(admin: SupabaseClient, userId: string, trigger: SyncTrigger): Promise<SyncOutcome> {
  const { kiteApiKey } = serverEnv();
  const { data: conn } = await admin.from("broker_connections").select("*").eq("user_id", userId).eq("broker", "zerodha").maybeSingle();
  if (!conn || conn.status === "disconnected") return { status: "skipped", message: "No active Zerodha connection" };
  const { data: secret } = await admin.from("broker_secrets").select("access_token_enc").eq("connection_id", conn.id).maybeSingle();
  if (!secret) return markReconnect(admin, conn.id, userId, "No stored session — reconnect required");
  if (conn.token_expires_at && Date.parse(conn.token_expires_at) < Date.now())
    return markReconnect(admin, conn.id, userId, "Zerodha session expired (daily 06:00 IST logout)");

  const { data: run } = await admin.from("broker_sync_runs").insert({ user_id: userId, connection_id: conn.id, trigger }).select("id").single();
  await admin.from("broker_connections").update({ status: "synchronizing", updated_at: new Date().toISOString() }).eq("id", conn.id);

  try {
    const kite = new KiteClient(kiteApiKey, decryptSecret(secret.access_token_enc));
    const [trades, orders, positions, holdings] = await Promise.all([kite.trades(), kite.orders(), kite.positions(), kite.holdings()]);

    // Preserve raw order history (status snapshots are NOT treated as executions)
    if (orders.length) {
      await admin.from("raw_orders").upsert(
        orders.map((o) => ({
          user_id: userId,
          broker_order_id: o.order_id,
          status: o.status,
          tradingsymbol: o.tradingsymbol,
          exchange: o.exchange,
          order_timestamp: o.order_timestamp ? zonedToUtc(o.order_timestamp.slice(0, 10), o.order_timestamp.slice(11, 19)) : null,
          payload: o,
          received_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,broker_order_id" }
      );
    }

    const { executions, rejected } = normalizeKiteTrades(trades);
    const payloads = new Map(trades.map((t) => [`${t.exchange}:${t.trade_id}`, t as unknown]));
    const ing = await ingestExecutions(admin, userId, executions, { source: "kite_api", rowCount: trades.length, errors: rejected, payloads });
    const rb = await rebuildAnalytics(admin, userId);

    // Reconciliation: intraday net quantities reported by Kite vs our reconstruction
    const { data: ours } = await admin.from("reconstructed_positions").select("exchange, tradingsymbol, product, open_quantity, direction").eq("user_id", userId);
    const mismatches: string[] = [];
    for (const p of positions.net.filter((x) => x.product === "MIS")) {
      const mine = (ours ?? []).find((o) => o.exchange === p.exchange && o.tradingsymbol === p.tradingsymbol && o.product === "MIS");
      const mineQty = mine ? Number(mine.open_quantity) * (mine.direction === "SHORT" ? -1 : 1) : 0;
      if (mineQty !== p.quantity) mismatches.push(`${p.exchange}:${p.tradingsymbol} broker=${p.quantity} tradeos=${mineQty}`);
    }
    const partial = rejected.length > 0 || mismatches.length > 0;
    const status = partial ? "partial" : "updated";
    const stats = {
      fills: trades.length,
      orders: orders.length,
      inserted: ing.inserted,
      duplicates: ing.duplicates,
      rejected: rejected.length,
      holdings: holdings.length,
      newTrades: rb.newTradeKeys.length,
      mismatches,
      warnings: rb.warnings.slice(0, 20),
    };
    await admin.from("broker_sync_runs").update({ status: partial ? "partial" : "succeeded", finished_at: new Date().toISOString(), stats }).eq("id", run!.id);
    await admin
      .from("broker_connections")
      .update({ status, last_synced_at: new Date().toISOString(), last_error: partial ? `Partial data: ${[...mismatches, ...rejected.map((r) => r.reason)].slice(0, 3).join("; ")}` : null, updated_at: new Date().toISOString() })
      .eq("id", conn.id);
    if (ing.inserted)
      await admin.from("notifications").upsert(
        { user_id: userId, type: "trade_imported", title: `${ing.inserted} new fill(s) imported from Zerodha`, body: `${rb.newTradeKeys.length} trade(s) closed.`, data: { href: "/journal" }, dedupe_key: `import:${run!.id}` },
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
      );
    await audit(userId, "broker.sync", { trigger, ...stats, mismatches: mismatches.length });
    return { status, inserted: ing.inserted, duplicates: ing.duplicates, newTrades: rb.newTradeKeys.length };
  } catch (e) {
    const err = e as Error;
    if (e instanceof KiteApiError && e.requiresReconnect) {
      await admin.from("broker_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: "Session expired" }).eq("id", run!.id);
      return markReconnect(admin, conn.id, userId, "Zerodha rejected the session token — reconnect required");
    }
    await admin.from("broker_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: err.message }).eq("id", run!.id);
    await admin.from("broker_connections").update({ status: "sync_failed", last_error: err.message, updated_at: new Date().toISOString() }).eq("id", conn.id);
    await admin.from("notifications").upsert(
      { user_id: userId, type: "sync_failed", title: "Zerodha synchronization failed", body: err.message.slice(0, 200), data: { href: "/broker" }, dedupe_key: `sync_failed:${localDate(new Date())}` },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
    );
    await audit(userId, "broker.sync_failed", { trigger, error: err.message });
    return { status: "sync_failed", message: err.message };
  }
}

async function markReconnect(admin: SupabaseClient, connectionId: string, userId: string, message: string): Promise<SyncOutcome> {
  await admin.from("broker_connections").update({ status: "reconnect_required", last_error: message, updated_at: new Date().toISOString() }).eq("id", connectionId);
  await admin.from("broker_secrets").delete().eq("connection_id", connectionId);
  await admin.from("notifications").upsert(
    { user_id: userId, type: "broker_disconnected", title: "Zerodha reconnection required", body: message, data: { href: "/broker" }, dedupe_key: `reconnect:${localDate(new Date())}` },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
  );
  return { status: "reconnect_required", message };
}
