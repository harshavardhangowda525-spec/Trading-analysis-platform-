/**
 * Historical trade import (Mode B).
 *
 * Supported formats (auto-detected from the header row):
 *  1. Zerodha Console "Tradebook" export:
 *     symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time
 *  2. TRADEOS generic CSV:
 *     symbol,side,quantity,price,executed_at,exchange,trade_id[,order_id][,product]
 *
 * Timestamps without an explicit offset are interpreted as Asia/Kolkata wall-clock time.
 * Rows are validated individually; invalid rows are reported, never guessed.
 */
import Papa from "papaparse";
import { z } from "zod";
import type { Execution, Product } from "@/lib/engine/types";
import { zonedToUtc } from "@/lib/engine/time";

export type CsvFormat = "zerodha_tradebook" | "generic";

export interface RowError {
  row: number; // 1-based data row (excluding header)
  message: string;
}

export interface ParseResult {
  format: CsvFormat | null;
  executions: Execution[];
  errors: RowError[];
  duplicatesInFile: number;
  rowCount: number;
}

const ZERODHA_REQUIRED = ["symbol", "trade_date", "exchange", "trade_type", "quantity", "price", "trade_id"];
const GENERIC_REQUIRED = ["symbol", "side", "quantity", "price", "executed_at", "exchange", "trade_id"];

const num = z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : v), z.number().finite());

const zerodhaRow = z.object({
  symbol: z.string().trim().min(1).regex(/^[A-Z0-9&\-_.]+$/i, "invalid symbol"),
  isin: z.string().trim().optional(),
  trade_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "trade_date must be YYYY-MM-DD"),
  exchange: z.string().trim().toUpperCase().pipe(z.enum(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"])),
  segment: z.string().trim().optional(),
  trade_type: z.string().trim().toLowerCase().pipe(z.enum(["buy", "sell"])),
  quantity: num.pipe(z.number().positive("quantity must be > 0")),
  price: num.pipe(z.number().nonnegative("price must be >= 0")),
  trade_id: z.string().trim().min(1),
  order_id: z.string().trim().optional(),
  order_execution_time: z.string().trim().optional(),
});

const genericRow = z.object({
  symbol: z.string().trim().min(1).regex(/^[A-Z0-9&\-_.]+$/i, "invalid symbol"),
  side: z.string().trim().toUpperCase().pipe(z.enum(["BUY", "SELL"])),
  quantity: num.pipe(z.number().positive("quantity must be > 0")),
  price: num.pipe(z.number().nonnegative("price must be >= 0")),
  executed_at: z.string().trim().min(1),
  exchange: z.string().trim().toUpperCase().pipe(z.enum(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"])),
  trade_id: z.string().trim().min(1),
  order_id: z.string().trim().optional(),
  product: z.string().trim().toUpperCase().optional(),
});

/** Parse a timestamp; naive timestamps are treated as IST. Returns null if invalid. */
export function parseTimestamp(value: string, fallbackDate?: string): string | null {
  const v = value.trim();
  if (!v) return fallbackDate ? zonedToUtc(fallbackDate, "09:15:00") : null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) {
    const [, mo, d] = m[1].split("-").map(Number);
    const [hh, mm] = m[2].split(":").map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
    return zonedToUtc(m[1], m[2].length === 5 ? `${m[2]}:00` : m[2]);
  }
  const dm = v.match(/^(\d{2})[-/](\d{2})[-/](\d{4})[ T](\d{2}:\d{2}(?::\d{2})?)$/); // DD-MM-YYYY HH:MM[:SS]
  if (dm) return zonedToUtc(`${dm[3]}-${dm[2]}-${dm[1]}`, dm[4].length === 5 ? `${dm[4]}:00` : dm[4]);
  return null;
}

export function detectFormat(headers: string[]): CsvFormat | null {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  if (ZERODHA_REQUIRED.every((k) => h.has(k))) return "zerodha_tradebook";
  if (GENERIC_REQUIRED.every((k) => h.has(k))) return "generic";
  return null;
}

export const MAX_ROWS = 50000;

export function parseTradeCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const headers = parsed.meta.fields ?? [];
  const format = detectFormat(headers);
  const errors: RowError[] = [];
  const executions: Execution[] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;
  if (!format) {
    return {
      format: null,
      executions,
      errors: [{ row: 0, message: `Unrecognised header. Expected Zerodha tradebook (${ZERODHA_REQUIRED.join(", ")}) or generic (${GENERIC_REQUIRED.join(", ")}).` }],
      duplicatesInFile,
      rowCount: parsed.data.length,
    };
  }
  if (parsed.data.length > MAX_ROWS) {
    return { format, executions, errors: [{ row: 0, message: `File has ${parsed.data.length} rows; maximum is ${MAX_ROWS}.` }], duplicatesInFile, rowCount: parsed.data.length };
  }

  parsed.data.forEach((raw, i) => {
    const row = i + 1;
    let e: Execution | null = null;
    if (format === "zerodha_tradebook") {
      const r = zerodhaRow.safeParse(raw);
      if (!r.success) return void errors.push({ row, message: r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      const d = r.data;
      const ts = parseTimestamp(d.order_execution_time ?? "", d.trade_date);
      if (!ts) return void errors.push({ row, message: `invalid timestamp "${d.order_execution_time}"` });
      e = {
        id: `${d.exchange}:${d.trade_id}`,
        brokerTradeId: d.trade_id,
        brokerOrderId: d.order_id || null,
        exchange: d.exchange,
        tradingsymbol: d.symbol.toUpperCase(),
        product: "UNKNOWN", // Console tradebook does not include product type
        side: d.trade_type === "buy" ? "BUY" : "SELL",
        quantity: d.quantity,
        price: d.price,
        executedAt: ts,
        source: "csv",
        isDemo: false,
      };
    } else {
      const r = genericRow.safeParse(raw);
      if (!r.success) return void errors.push({ row, message: r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      const d = r.data;
      const ts = parseTimestamp(d.executed_at);
      if (!ts) return void errors.push({ row, message: `invalid timestamp "${d.executed_at}"` });
      const product: Product = d.product === "MIS" || d.product === "CNC" || d.product === "NRML" ? d.product : "UNKNOWN";
      e = {
        id: `${d.exchange}:${d.trade_id}`,
        brokerTradeId: d.trade_id,
        brokerOrderId: d.order_id || null,
        exchange: d.exchange,
        tradingsymbol: d.symbol.toUpperCase(),
        product,
        side: d.side,
        quantity: d.quantity,
        price: d.price,
        executedAt: ts,
        source: "csv",
        isDemo: false,
      };
    }
    if (seen.has(e.id)) {
      duplicatesInFile++;
      return;
    }
    seen.add(e.id);
    executions.push(e);
  });
  return { format, executions, errors, duplicatesInFile, rowCount: parsed.data.length };
}
