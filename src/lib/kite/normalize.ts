import type { Execution, Product } from "@/lib/engine/types";
import { parseTimestamp } from "@/lib/import/csv";
import type { KiteTrade } from "./client";

export interface NormalizeResult {
  executions: Execution[];
  rejected: { tradeId: string | null; reason: string }[];
}

const PRODUCTS = new Set(["MIS", "CNC", "NRML"]);

/**
 * Convert Kite /trades rows (executed fills — not orders) to engine executions.
 * Kite timestamps are "YYYY-MM-DD HH:MM:SS" in IST.
 * Order-status data is never treated as proof of execution; only /trades fills are.
 */
export function normalizeKiteTrades(rows: unknown[]): NormalizeResult {
  const executions: Execution[] = [];
  const rejected: NormalizeResult["rejected"] = [];
  for (const raw of rows) {
    const r = raw as Partial<KiteTrade>;
    const tradeId = r?.trade_id ? String(r.trade_id) : null;
    if (!tradeId || !r.exchange || !r.tradingsymbol) {
      rejected.push({ tradeId, reason: "missing trade_id/exchange/tradingsymbol" });
      continue;
    }
    if (r.transaction_type !== "BUY" && r.transaction_type !== "SELL") {
      rejected.push({ tradeId, reason: `unexpected transaction_type ${String(r.transaction_type)}` });
      continue;
    }
    const qty = Number(r.quantity);
    const price = Number(r.average_price);
    if (!(qty > 0) || !(price >= 0)) {
      rejected.push({ tradeId, reason: "invalid quantity/price" });
      continue;
    }
    const ts = parseTimestamp(String(r.fill_timestamp ?? r.exchange_timestamp ?? r.order_timestamp ?? ""));
    if (!ts) {
      rejected.push({ tradeId, reason: "invalid or missing fill timestamp" });
      continue;
    }
    executions.push({
      id: `${r.exchange}:${tradeId}`,
      brokerTradeId: tradeId,
      brokerOrderId: r.order_id ? String(r.order_id) : null,
      exchange: r.exchange,
      tradingsymbol: r.tradingsymbol,
      product: (PRODUCTS.has(String(r.product)) ? r.product : "UNKNOWN") as Product,
      side: r.transaction_type,
      quantity: qty,
      price,
      executedAt: ts,
      source: "kite_api",
      isDemo: false,
    });
  }
  return { executions, rejected };
}
