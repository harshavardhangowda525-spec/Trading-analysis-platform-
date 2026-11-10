import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconstruct } from "@/lib/engine/reconstruct";
import { localDate } from "@/lib/engine/time";
import { CALC_VERSION, type Execution } from "@/lib/engine/types";
import { tradeToRow, rowToRisk } from "./mappers";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { redact } from "@/lib/security/crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IngestResult {
  batchId: string | null;
  received: number;
  inserted: number;
  duplicates: number;
}

/**
 * Idempotent insert of raw executions. Uniqueness is enforced by the database
 * (user_id, exchange, broker_trade_id); re-importing the same data inserts nothing.
 */
export async function ingestExecutions(
  sb: SupabaseClient,
  userId: string,
  executions: Execution[],
  batch: { source: "kite_api" | "csv"; fileName?: string; sha256?: string; rowCount: number; errors: unknown[]; payloads?: Map<string, unknown> }
): Promise<IngestResult> {
  const { data: b, error: be } = await sb
    .from("broker_import_batches")
    .insert({
      user_id: userId,
      source: batch.source,
      file_name: batch.fileName ?? null,
      content_sha256: batch.sha256 ?? null,
      row_count: batch.rowCount,
      error_count: batch.errors.length,
      errors: batch.errors.slice(0, 200),
      status: batch.errors.length ? "partial" : "completed",
    })
    .select("id")
    .single();
  if (be) throw new Error(`Could not create import batch: ${be.message}`);

  let inserted = 0;
  for (let i = 0; i < executions.length; i += 500) {
    const chunk = executions.slice(i, i + 500).map((e) => ({
      user_id: userId,
      batch_id: b.id,
      source: e.source,
      is_demo: false,
      broker_trade_id: e.brokerTradeId,
      broker_order_id: e.brokerOrderId,
      exchange: e.exchange,
      tradingsymbol: e.tradingsymbol,
      product: e.product,
      side: e.side,
      quantity: e.quantity,
      price: e.price,
      executed_at: e.executedAt,
      payload: (batch.payloads?.get(e.id) as object) ?? {},
    }));
    const { data, error } = await sb
      .from("raw_executions")
      .upsert(chunk, { onConflict: "user_id,exchange,broker_trade_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`Insert failed: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  const duplicates = executions.length - inserted;
  await sb.from("broker_import_batches").update({ inserted_count: inserted, duplicate_count: duplicates }).eq("id", b.id);
  return { batchId: b.id, received: executions.length, inserted, duplicates };
}

export async function loadExecutions(sb: SupabaseClient, userId: string): Promise<Execution[]> {
  const out: Execution[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("raw_executions")
      .select("id, broker_trade_id, broker_order_id, exchange, tradingsymbol, product, side, quantity, price, executed_at, source, is_demo")
      .eq("user_id", userId)
      .eq("is_demo", false)
      .order("executed_at")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? [])
      out.push({
        id: `${r.exchange}:${r.broker_trade_id}`,
        brokerTradeId: r.broker_trade_id,
        brokerOrderId: r.broker_order_id,
        exchange: r.exchange,
        tradingsymbol: r.tradingsymbol,
        product: (r.product ?? "UNKNOWN") as Execution["product"],
        side: r.side,
        quantity: Number(r.quantity),
        price: Number(r.price),
        executedAt: new Date(r.executed_at).toISOString(),
        source: r.source,
        isDemo: r.is_demo,
      });
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface RebuildResult {
  closedTrades: number;
  openPositions: number;
  newTradeKeys: string[];
  warnings: string[];
}

/** Rebuild all analytical records from the preserved raw executions (atomic in the DB). */
export async function rebuildAnalytics(sb: SupabaseClient, userId: string): Promise<RebuildResult> {
  const [execs, prevQ] = await Promise.all([
    loadExecutions(sb, userId),
    sb.from("closed_trades").select("trade_key").eq("user_id", userId).eq("calc_version", CALC_VERSION),
  ]);
  const prev = new Set((prevQ.data ?? []).map((r: any) => r.trade_key));
  const { closedTrades, openPositions, warnings } = reconstruct(execs);
  const { error } = await sb.rpc("rebuild_analytics", {
    p_user_id: userId,
    p_calc_version: CALC_VERSION,
    p_trades: closedTrades.map(tradeToRow),
    p_costs: closedTrades.flatMap((t) => t.costs.map((c) => ({ trade_key: t.tradeKey, ...c }))),
    p_positions: openPositions.map((p) => ({
      exchange: p.exchange,
      tradingsymbol: p.tradingsymbol,
      product: p.product,
      direction: p.direction,
      open_quantity: p.openQuantity,
      avg_cost: p.avgCost,
      opened_at: p.openedAt,
    })),
  });
  if (error) throw new Error(`Rebuild failed: ${error.message}`);

  const fresh = closedTrades.filter((t) => !prev.has(t.tradeKey));
  // Notifications — only from verified records (closed trades reconstructed from real fills)
  const notes: any[] = fresh.slice(-20).map((t) => ({
    user_id: userId,
    type: "trade_closed",
    title: `Trade closed: ${t.tradingsymbol}`,
    body: `Gross P&L: ${t.grossPnl < 0 ? "−" : ""}₹${Math.abs(t.grossPnl).toFixed(2)}. AI review queued.`,
    data: { href: `/journal/trade?key=${encodeURIComponent(t.tradeKey)}`, trade_key: t.tradeKey },
    dedupe_key: `trade_closed:${t.tradeKey}`,
  }));
  if (fresh.length) {
    notes.push({
      user_id: userId,
      type: "missing_journal",
      title: "Journal details missing",
      body: `${fresh.length} new trade(s) need entry rationale and a planned stop for strategy verification.`,
      data: { href: "/journal?filter=unjournaled" },
      dedupe_key: `missing_journal:${localDate(new Date())}`,
    });
  }
  // daily loss check (informational only)
  const { data: riskRow } = await sb.from("risk_settings").select("*").eq("user_id", userId).maybeSingle();
  const risk = rowToRisk(riskRow);
  const today = localDate(new Date());
  const todayPnl = closedTrades.filter((t) => localDate(t.exitAt) === today).reduce((a, t) => a + t.netPnl, 0);
  if (todayPnl <= -risk.maxDailyLoss) {
    notes.push({
      user_id: userId,
      type: "daily_loss_exceeded",
      title: "Daily loss limit exceeded",
      body: "You have exceeded your configured daily loss limit. Review your trades before continuing.",
      data: { href: "/risk" },
      dedupe_key: `daily_loss:${today}`,
    });
  }
  if (notes.length) await sb.from("notifications").upsert(notes, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });

  // Queue AI reviews for new trades (processed in the background)
  if (fresh.length) {
    await sb
      .from("ai_trade_reviews")
      .upsert(fresh.map((t) => ({ user_id: userId, trade_key: t.tradeKey, status: "pending" })), { onConflict: "user_id,trade_key", ignoreDuplicates: true });
  }
  return { closedTrades: closedTrades.length, openPositions: openPositions.length, newTradeKeys: fresh.map((t) => t.tradeKey), warnings };
}

/** Audit logs are written with the service role only (no user insert policy). */
export async function audit(userId: string | null, action: string, metadata: Record<string, unknown> = {}, entity?: string, entityId?: string, ip?: string | null) {
  try {
    if (!serverEnv().serviceRoleKey) return;
    await createAdminClient()
      .from("audit_logs")
      .insert({ user_id: userId, action, metadata: redact(metadata), entity: entity ?? null, entity_id: entityId ?? null, ip: ip ?? null });
  } catch {
    /* audit must never break the main flow */
  }
}
