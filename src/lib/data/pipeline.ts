import "server-only";
import { reconstruct } from "@/lib/engine/reconstruct";
import { localDate } from "@/lib/engine/time";
import { CALC_VERSION, type Execution } from "@/lib/engine/types";
import { db, iso } from "@/lib/db";
import { redact } from "@/lib/security/crypto";
import { tradeToRow, rowToRisk } from "./mappers";

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
  userId: string,
  executions: Execution[],
  batch: { source: "kite_api" | "csv"; fileName?: string; sha256?: string; rowCount: number; errors: unknown[]; payloads?: Map<string, unknown> }
): Promise<IngestResult> {
  const q = db();
  const [b] = await q`insert into broker_import_batches (user_id, source, file_name, content_sha256, row_count, error_count, errors, status)
    values (${userId}, ${batch.source}, ${batch.fileName ?? null}, ${batch.sha256 ?? null}, ${batch.rowCount}, ${batch.errors.length},
            ${JSON.stringify(batch.errors.slice(0, 200))}::jsonb, ${batch.errors.length ? "partial" : "completed"})
    returning id`;

  let inserted = 0;
  for (let i = 0; i < executions.length; i += 500) {
    const rows = executions.slice(i, i + 500).map((e) => ({
      source: e.source,
      broker_trade_id: e.brokerTradeId,
      broker_order_id: e.brokerOrderId,
      exchange: e.exchange,
      tradingsymbol: e.tradingsymbol,
      product: e.product,
      side: e.side,
      quantity: e.quantity,
      price: e.price,
      executed_at: e.executedAt,
      instrument_token: (batch.payloads?.get(e.id) as { instrument_token?: number } | undefined)?.instrument_token ?? null,
      payload: batch.payloads?.get(e.id) ?? {},
    }));
    const res = await q`insert into raw_executions (user_id, batch_id, source, is_demo, broker_trade_id, broker_order_id, exchange, tradingsymbol,
                          product, side, quantity, price, executed_at, instrument_token, payload)
      select ${userId}, ${b.id}, x.source, false, x.broker_trade_id, x.broker_order_id, x.exchange, x.tradingsymbol,
             x.product, x.side, x.quantity, x.price, x.executed_at, x.instrument_token, x.payload
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(source text, broker_trade_id text, broker_order_id text, exchange text,
           tradingsymbol text, product text, side text, quantity numeric, price numeric, executed_at timestamptz, instrument_token bigint, payload jsonb)
      on conflict (user_id, exchange, broker_trade_id) do nothing
      returning id`;
    inserted += res.length;
  }
  const duplicates = executions.length - inserted;
  await q`update broker_import_batches set inserted_count = ${inserted}, duplicate_count = ${duplicates} where id = ${b.id} and user_id = ${userId}`;
  return { batchId: b.id, received: executions.length, inserted, duplicates };
}

export async function loadExecutions(userId: string): Promise<Execution[]> {
  const rows = await db()`select broker_trade_id, broker_order_id, exchange, tradingsymbol, product, side, quantity, price, executed_at, source, is_demo
                          from raw_executions where user_id = ${userId} and is_demo = false order by executed_at`;
  return (rows as any[]).map((r) => ({
    id: `${r.exchange}:${r.broker_trade_id}`,
    brokerTradeId: r.broker_trade_id,
    brokerOrderId: r.broker_order_id,
    exchange: r.exchange,
    tradingsymbol: r.tradingsymbol,
    product: (r.product ?? "UNKNOWN") as Execution["product"],
    side: r.side,
    quantity: Number(r.quantity),
    price: Number(r.price),
    executedAt: iso(r.executed_at)!,
    source: r.source,
    isDemo: r.is_demo,
  }));
}

export interface RebuildResult {
  closedTrades: number;
  openPositions: number;
  newTradeKeys: string[];
  warnings: string[];
}

/** Rebuild all analytical records from the preserved raw executions — one atomic transaction. */
export async function rebuildAnalytics(userId: string): Promise<RebuildResult> {
  const q = db();
  const [execs, prevR] = await Promise.all([
    loadExecutions(userId),
    q`select trade_key from closed_trades where user_id = ${userId} and calc_version = ${CALC_VERSION}`,
  ]);
  const prev = new Set((prevR as any[]).map((r) => r.trade_key));
  const { closedTrades, openPositions, warnings } = reconstruct(execs);
  const trades = JSON.stringify(closedTrades.map(tradeToRow));
  const costs = JSON.stringify(closedTrades.flatMap((t) => t.costs.map((c) => ({ trade_key: t.tradeKey, ...c }))));
  const positions = JSON.stringify(
    openPositions.map((p) => ({ exchange: p.exchange, tradingsymbol: p.tradingsymbol, product: p.product, direction: p.direction, open_quantity: p.openQuantity, avg_cost: p.avgCost, opened_at: p.openedAt }))
  );

  await q.transaction([
    q`delete from closed_trades where user_id = ${userId} and calc_version = ${CALC_VERSION}`,
    q`insert into closed_trades (user_id, calc_version, trade_key, is_demo, exchange, tradingsymbol, instrument_category, product, direction,
         quantity, avg_entry, avg_exit, entry_at, exit_at, gross_pnl, est_costs, verified_costs, net_pnl, cost_status, return_pct,
         holding_seconds, outcome, execution_ids)
      select ${userId}, ${CALC_VERSION}, t.trade_key, coalesce(t.is_demo, false), t.exchange, t.tradingsymbol, t.instrument_category, t.product,
             t.direction, t.quantity, t.avg_entry, t.avg_exit, t.entry_at, t.exit_at, t.gross_pnl, t.est_costs, t.verified_costs, t.net_pnl,
             t.cost_status, t.return_pct, t.holding_seconds, t.outcome, array(select jsonb_array_elements_text(t.execution_ids))
      from jsonb_to_recordset(${trades}::jsonb) as t(trade_key text, is_demo boolean, exchange text, tradingsymbol text, instrument_category text,
           product text, direction text, quantity numeric, avg_entry numeric, avg_exit numeric, entry_at timestamptz, exit_at timestamptz,
           gross_pnl numeric, est_costs numeric, verified_costs numeric, net_pnl numeric, cost_status text, return_pct numeric,
           holding_seconds bigint, outcome text, execution_ids jsonb)`,
    q`insert into trade_costs (user_id, closed_trade_id, component, amount, source)
      select ${userId}, ct.id, c.component, c.amount, c.source
      from jsonb_to_recordset(${costs}::jsonb) as c(trade_key text, component text, amount numeric, source text)
      join closed_trades ct on ct.user_id = ${userId} and ct.calc_version = ${CALC_VERSION} and ct.trade_key = c.trade_key`,
    q`delete from reconstructed_positions where user_id = ${userId} and calc_version = ${CALC_VERSION}`,
    q`insert into reconstructed_positions (user_id, calc_version, exchange, tradingsymbol, product, direction, open_quantity, avg_cost, opened_at)
      select ${userId}, ${CALC_VERSION}, p.exchange, p.tradingsymbol, p.product, p.direction, p.open_quantity, p.avg_cost, p.opened_at
      from jsonb_to_recordset(${positions}::jsonb) as p(exchange text, tradingsymbol text, product text, direction text, open_quantity numeric,
           avg_cost numeric, opened_at timestamptz)`,
  ]);

  const fresh = closedTrades.filter((t) => !prev.has(t.tradeKey));
  // Notifications — only from verified records (closed trades reconstructed from real fills)
  const notes: { type: string; title: string; body: string; href: string; dedupe: string }[] = fresh.slice(-20).map((t) => ({
    type: "trade_closed",
    title: `Trade closed: ${t.tradingsymbol}`,
    body: `Gross P&L: ${t.grossPnl < 0 ? "−" : ""}₹${Math.abs(t.grossPnl).toFixed(2)}. AI review queued.`,
    href: `/journal/trade?key=${encodeURIComponent(t.tradeKey)}`,
    dedupe: `trade_closed:${t.tradeKey}`,
  }));
  if (fresh.length)
    notes.push({ type: "missing_journal", title: "Journal details missing", body: `${fresh.length} new trade(s) need entry rationale and a planned stop for strategy verification.`, href: "/journal?filter=unjournaled", dedupe: `missing_journal:${localDate(new Date())}` });
  const [riskRow] = await q`select * from risk_settings where user_id = ${userId}`;
  const risk = rowToRisk(riskRow ?? null);
  const today = localDate(new Date());
  const todayPnl = closedTrades.filter((t) => localDate(t.exitAt) === today).reduce((a, t) => a + t.netPnl, 0);
  if (todayPnl <= -risk.maxDailyLoss)
    notes.push({ type: "daily_loss_exceeded", title: "Daily loss limit exceeded", body: "You have exceeded your configured daily loss limit. Review your trades before continuing.", href: "/risk", dedupe: `daily_loss:${today}` });
  for (const n of notes) await notify(userId, n.type, n.title, n.body, n.href, n.dedupe);

  if (fresh.length)
    await q`insert into ai_trade_reviews (user_id, trade_key, status)
            select ${userId}, k, 'pending' from unnest(${fresh.map((t) => t.tradeKey)}::text[]) as k
            on conflict (user_id, trade_key) do nothing`;
  return { closedTrades: closedTrades.length, openPositions: openPositions.length, newTradeKeys: fresh.map((t) => t.tradeKey), warnings };
}

export async function notify(userId: string, type: string, title: string, body: string | null, href: string, dedupe: string) {
  await db()`insert into notifications (user_id, type, title, body, data, dedupe_key)
             values (${userId}, ${type}, ${title}, ${body}, ${JSON.stringify({ href })}::jsonb, ${dedupe})
             on conflict (user_id, dedupe_key) do nothing`;
}

export async function audit(userId: string | null, action: string, metadata: Record<string, unknown> = {}, entity?: string, entityId?: string, ip?: string | null) {
  try {
    await db()`insert into audit_logs (user_id, action, metadata, entity, entity_id, ip)
               values (${userId}, ${action}, ${JSON.stringify(redact(metadata))}::jsonb, ${entity ?? null}, ${entityId ?? null}, ${ip ?? null})`;
  } catch {
    /* audit must never break the main flow */
  }
}
