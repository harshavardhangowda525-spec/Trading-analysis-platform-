/**
 * Position reconstruction — methodology `fifo-v1`
 *
 * 1. Executions are grouped by (exchange, tradingsymbol, product) and sorted by
 *    execution time, then broker trade id (stable tiebreak).
 * 2. A *trade* (round trip) begins when the position leaves flat and ends when it
 *    returns to flat. Scaling in/out, partial fills and multiple entries/exits are
 *    all part of the same round trip.
 * 3. Exits are matched against open entry lots FIFO. Because a round trip always
 *    returns to flat, total gross P&L is identical under FIFO or average cost; FIFO
 *    determines the realized P&L of partial exits for still-open positions.
 * 4. A fill that crosses through zero (e.g. long 10, sell 15) is split: 10 closes the
 *    long trade, 5 opens a new short trade.
 * 5. Cash-equity short positions are only possible intraday. A SELL that opens a
 *    position for a CNC product, or for an UNKNOWN product that is not covered the
 *    same trading day, is most likely a sale of holdings acquired before the import
 *    window. It is NOT converted into a fabricated trade — it is reported as an
 *    unmatched execution warning instead.
 * 6. Outcome uses NET P&L: |net| < BREAKEVEN_EPSILON (₹1) => breakeven.
 * 7. Original executions are never mutated.
 */
import { estimateCosts, sumCosts } from "./fees";
import { localDate } from "./time";
import {
  CALC_VERSION,
  type ClosedTrade,
  type CostLine,
  type Direction,
  type Execution,
  type InstrumentCategory,
  type OpenPosition,
  type ReconstructionResult,
  type TradeLeg,
} from "./types";

export const BREAKEVEN_EPSILON = 1; // ₹
const QTY_EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function categorize(symbol: string, exchange: string): InstrumentCategory {
  const s = symbol.toUpperCase();
  if (["NFO", "BFO", "MCX", "CDS"].includes(exchange)) return "derivative";
  if (s.endsWith("BEES") || s.includes("ETF") || s.endsWith("IETF")) return "etf";
  if (s.startsWith("NIFTY ") || s === "SENSEX") return "index";
  return "stock";
}

interface Lot {
  qty: number;
  price: number;
}

interface Working {
  direction: Direction;
  lots: Lot[];
  legs: TradeLeg[];
  gross: number;
  firstExecId: string;
  split: boolean;
}

export interface ReconstructOptions {
  verifiedCosts?: Map<string, CostLine[]>;
  categoryOf?: (symbol: string, exchange: string) => InstrumentCategory;
}

export function reconstruct(executions: Execution[], opts: ReconstructOptions = {}): ReconstructionResult {
  const categoryOf = opts.categoryOf ?? categorize;
  const groups = new Map<string, Execution[]>();
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const e of executions) {
    const dedupe = `${e.exchange}:${e.brokerTradeId}`;
    if (seen.has(dedupe)) {
      warnings.push(`Duplicate execution ignored: ${dedupe}`);
      continue;
    }
    seen.add(dedupe);
    if (!(e.quantity > 0) || !(e.price >= 0) || Number.isNaN(Date.parse(e.executedAt))) {
      warnings.push(`Invalid execution skipped: ${dedupe}`);
      continue;
    }
    const k = `${e.exchange}|${e.tradingsymbol}|${e.product}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }

  const closedTrades: ClosedTrade[] = [];
  const openPositions: OpenPosition[] = [];

  for (const list of groups.values()) {
    list.sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.brokerTradeId.localeCompare(b.brokerTradeId));
    const { exchange, tradingsymbol, product, isDemo } = list[0];
    const category = categoryOf(tradingsymbol, exchange);
    let w: Working | null = null;

    const finalize = (wk: Working) => {
      const entries = wk.legs.filter((l) => l.role === "entry");
      const exits = wk.legs.filter((l) => l.role === "exit");
      const qty = entries.reduce((a, l) => a + l.quantity, 0);
      const avgEntry = entries.reduce((a, l) => a + l.quantity * l.price, 0) / qty;
      const avgExit = exits.reduce((a, l) => a + l.quantity * l.price, 0) / qty;
      const entryAt = entries[0].executedAt;
      const exitAt = exits[exits.length - 1].executedAt;
      const sameDay = localDate(entryAt) === localDate(exitAt);

      if (wk.direction === "SHORT" && category !== "derivative" && (product === "CNC" || (product === "UNKNOWN" && !sameDay))) {
        warnings.push(
          `Unmatched sell for ${exchange}:${tradingsymbol} at ${entryAt} — likely holdings acquired before the import window. Not counted as a trade.`
        );
        return;
      }
      const costProduct: "intraday" | "delivery" =
        product === "MIS" ? "intraday" : product === "CNC" || product === "NRML" ? "delivery" : sameDay ? "intraday" : "delivery";
      const tradeKey = `${exchange}:${tradingsymbol}:${product}:${wk.firstExecId}${wk.split ? "#2" : ""}`;
      const est = estimateCosts(wk.legs, { exchange, costProduct, category });
      const verified = opts.verifiedCosts?.get(tradeKey) ?? null;
      const estCosts = sumCosts(est);
      const verifiedCosts = verified ? sumCosts(verified) : null;
      const gross = r2(wk.gross);
      const net = r2(gross - (verifiedCosts ?? estCosts));
      const outcome = Math.abs(net) < BREAKEVEN_EPSILON ? "breakeven" : net > 0 ? "win" : "loss";
      closedTrades.push({
        tradeKey,
        calcVersion: CALC_VERSION,
        isDemo,
        exchange,
        tradingsymbol,
        category,
        product,
        costProduct,
        direction: wk.direction,
        quantity: r4(qty),
        avgEntry: r4(avgEntry),
        avgExit: r4(avgExit),
        entryAt,
        exitAt,
        grossPnl: gross,
        estCosts,
        verifiedCosts,
        netPnl: net,
        costStatus: verified ? "verified" : "estimated",
        costs: verified ?? est,
        returnPct: r4((gross / (avgEntry * qty)) * 100),
        holdingSeconds: Math.max(0, Math.round((Date.parse(exitAt) - Date.parse(entryAt)) / 1000)),
        outcome,
        legs: wk.legs,
        executionIds: [...new Set(wk.legs.map((l) => l.executionId))],
      });
    };

    for (const e of list) {
      let remaining = e.quantity;
      let splitOpen = false;
      while (remaining > QTY_EPS) {
        const dirOfFill: Direction = e.side === "BUY" ? "LONG" : "SHORT";
        if (!w) {
          w = { direction: dirOfFill, lots: [], legs: [], gross: 0, firstExecId: e.id, split: splitOpen };
        }
        if (w.direction === dirOfFill) {
          w.lots.push({ qty: remaining, price: e.price });
          w.legs.push(leg(e, remaining, "entry"));
          remaining = 0;
          break;
        }
        // reducing
        const open = w.lots.reduce((a, l) => a + l.qty, 0);
        const closeQty = Math.min(remaining, open);
        let toMatch = closeQty;
        const sign = w.direction === "LONG" ? 1 : -1;
        while (toMatch > QTY_EPS && w.lots.length) {
          const lot = w.lots[0];
          const m = Math.min(lot.qty, toMatch);
          w.gross += (e.price - lot.price) * m * sign;
          lot.qty -= m;
          toMatch -= m;
          if (lot.qty <= QTY_EPS) w.lots.shift();
        }
        w.legs.push(leg(e, closeQty, "exit"));
        remaining -= closeQty;
        if (w.lots.length === 0) {
          finalize(w);
          w = null;
          splitOpen = remaining > QTY_EPS;
        }
      }
    }

    if (w) {
      const openQty = w.lots.reduce((a, l) => a + l.qty, 0);
      const entries = w.legs.filter((l) => l.role === "entry");
      if (w.direction === "SHORT" && category !== "derivative" && product !== "MIS") {
        warnings.push(`Open short on ${exchange}:${tradingsymbol} (${product}) — likely sale of pre-import holdings. Not shown as a position.`);
      } else {
        openPositions.push({
          exchange,
          tradingsymbol,
          product,
          direction: w.direction,
          openQuantity: r4(openQty),
          avgCost: r4(w.lots.reduce((a, l) => a + l.qty * l.price, 0) / openQty),
          openedAt: entries[0].executedAt,
          realizedSoFar: r2(w.gross),
          legs: w.legs,
        });
      }
    }
  }

  closedTrades.sort((a, b) => a.exitAt.localeCompare(b.exitAt) || a.tradeKey.localeCompare(b.tradeKey));
  return { closedTrades, openPositions, warnings };
}

function leg(e: Execution, quantity: number, role: "entry" | "exit"): TradeLeg {
  return {
    executionId: e.id,
    brokerOrderId: e.brokerOrderId,
    side: e.side,
    quantity: r4(quantity),
    price: e.price,
    executedAt: e.executedAt,
    role,
  };
}
