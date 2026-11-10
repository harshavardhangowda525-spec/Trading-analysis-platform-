/**
 * SYNTHETIC DEMO DATA — clearly labelled, deterministic (seeded), never mixed with
 * real broker records (every execution has source: "demo", isDemo: true).
 */
import type { Execution, JournalEntry, Product } from "@/lib/engine/types";
import { addDays, localDate, weekdayOf, zonedToUtc } from "@/lib/engine/time";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNIVERSE: { symbol: string; price: number; vol: number }[] = [
  { symbol: "NIFTYBEES", price: 268, vol: 0.006 },
  { symbol: "BANKBEES", price: 532, vol: 0.008 },
  { symbol: "GOLDBEES", price: 64, vol: 0.006 },
  { symbol: "RELIANCE", price: 1415, vol: 0.011 },
  { symbol: "HDFCBANK", price: 1720, vol: 0.009 },
  { symbol: "INFY", price: 1560, vol: 0.012 },
  { symbol: "TCS", price: 3480, vol: 0.01 },
  { symbol: "SBIN", price: 815, vol: 0.013 },
  { symbol: "ITC", price: 428, vol: 0.008 },
  { symbol: "TATAMOTORS", price: 742, vol: 0.016 },
];

export const DEMO_STRATEGIES = ["Opening Range Breakout", "VWAP Pullback", "Trend Continuation", "Mean Reversion", "Swing Breakout"];
const MISTAKES = ["Moved stop-loss", "FOMO entry", "Exited too early", "Oversized position", "Revenge trade", "Ignored plan"];
const EMOTIONS = ["Calm", "Confident", "Anxious", "Impatient", "Frustrated", "Focused"];

const tick = (p: number) => Math.round(p * 20) / 20; // ₹0.05 tick

export function generateDemoExecutions(today: string, days = 95, seed = 20261110): Execution[] {
  const rnd = mulberry32(seed);
  const prices = new Map(UNIVERSE.map((u) => [u.symbol, u.price]));
  const execs: Execution[] = [];
  let tid = 100000;
  let oid = 250000;
  const push = (symbol: string, side: "BUY" | "SELL", qty: number, price: number, iso: string, product: Product, orderId: string) => {
    tid++;
    execs.push({
      id: `NSE:DEMO${tid}`,
      brokerTradeId: `DEMO${tid}`,
      brokerOrderId: orderId,
      exchange: "NSE",
      tradingsymbol: symbol,
      product,
      side,
      quantity: qty,
      price: tick(price),
      executedAt: iso,
      source: "demo",
      isDemo: true,
    });
  };
  const at = (date: string, mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return zonedToUtc(date, `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}`);
  };
  const busy = new Map<string, string>(); // symbol -> date when CNC position closes

  // Canonical example from the spec: NIFTYBEES 10 @ ₹250 -> ₹246 (gross −₹40)
  const start = addDays(today, -days);
  for (let d = start; d < today; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6) continue;
    for (const u of UNIVERSE) prices.set(u.symbol, prices.get(u.symbol)! * (1 + (rnd() - 0.48) * u.vol * 1.4));
    const n = Math.floor(rnd() * 5) + (rnd() < 0.12 ? 4 : 0); // occasional over-trading day
    let cursor = 555 + Math.floor(rnd() * 25); // 09:15+
    for (let i = 0; i < n; i++) {
      const u = UNIVERSE[Math.floor(rnd() * UNIVERSE.length)];
      if (busy.has(u.symbol) && busy.get(u.symbol)! >= d) continue;
      const swing = rnd() < 0.22;
      const product: Product = swing ? "CNC" : "MIS";
      const dir = !swing && rnd() < 0.25 ? "SHORT" : "LONG";
      const px = prices.get(u.symbol)!;
      const value = 15000 + rnd() * (rnd() < 0.1 ? 120000 : 45000);
      const qty = Math.max(1, Math.round(value / px));
      const entrySide = dir === "LONG" ? "BUY" : "SELL";
      const exitSide = dir === "LONG" ? "SELL" : "BUY";
      // edge: positive skew w/ realistic win rate
      const win = rnd() < 0.53;
      const movePct = (win ? 0.4 + rnd() * 1.8 : -(0.3 + rnd() * 1.4)) * u.vol * 100 * 0.01;
      const breakeven = rnd() < 0.04;
      const exitPx = breakeven ? px : px * (1 + (dir === "LONG" ? movePct : -movePct));
      const entryMin = cursor;
      const entryOrder = `DEMOORD${++oid}`;
      // partial fills on the entry order
      const fills = qty > 20 && rnd() < 0.4 ? 2 + Math.floor(rnd() * 2) : 1;
      let left = qty;
      for (let f = 0; f < fills; f++) {
        const q = f === fills - 1 ? left : Math.max(1, Math.floor(qty / fills));
        left -= q;
        push(u.symbol, entrySide, q, px * (1 + (rnd() - 0.5) * 0.0006), at(d, entryMin + f), product, entryOrder);
      }
      // occasional scale-in
      let total = qty;
      if (rnd() < 0.15) {
        const add = Math.max(1, Math.round(qty * 0.5));
        total += add;
        push(u.symbol, entrySide, add, px * (1 + (rnd() - 0.5) * 0.004), at(d, entryMin + 8 + Math.floor(rnd() * 20)), product, `DEMOORD${++oid}`);
      }
      if (swing) {
        const hold = 1 + Math.floor(rnd() * 6);
        let exitDate = addDays(d, hold);
        while ([0, 6].includes(weekdayOf(exitDate))) exitDate = addDays(exitDate, 1);
        if (exitDate >= today) {
          busy.set(u.symbol, "9999-12-31"); // stays open
          continue;
        }
        busy.set(u.symbol, exitDate);
        push(u.symbol, exitSide, total, exitPx, at(exitDate, 600 + Math.floor(rnd() * 300)), product, `DEMOORD${++oid}`);
      } else {
        const exitMin = Math.min(915, entryMin + 10 + Math.floor(rnd() * 150));
        if (total > 1 && rnd() < 0.3) {
          const part = Math.floor(total / 2);
          push(u.symbol, exitSide, part, px + (exitPx - px) * 0.6, at(d, Math.min(915, entryMin + 6)), product, `DEMOORD${++oid}`);
          push(u.symbol, exitSide, total - part, exitPx, at(d, exitMin), product, `DEMOORD${++oid}`);
        } else push(u.symbol, exitSide, total, exitPx, at(d, exitMin), product, `DEMOORD${++oid}`);
        cursor = exitMin + 3;
      }
      cursor += 5 + Math.floor(rnd() * 25);
      if (cursor > 900) break;
    }
  }
  // the canonical spec example, 3 trading days ago
  let exDay = addDays(today, -1);
  while ([0, 6].includes(weekdayOf(exDay))) exDay = addDays(exDay, -1);
  push("NIFTYBEES", "BUY", 10, 250, zonedToUtc(exDay, "10:05:12"), "MIS", "DEMOORD999001");
  push("NIFTYBEES", "SELL", 10, 246, zonedToUtc(exDay, "11:42:40"), "MIS", "DEMOORD999002");
  // a breakeven scalp and still-open delivery positions (one partially exited)
  push("GOLDBEES", "BUY", 1, 64, zonedToUtc(exDay, "13:02:10"), "MIS", "DEMOORD999003");
  push("GOLDBEES", "SELL", 1, 64, zonedToUtc(exDay, "13:20:44"), "MIS", "DEMOORD999004");
  push("ITC", "BUY", 40, 431.5, zonedToUtc(exDay, "14:10:05"), "CNC", "DEMOORD999005");
  push("HDFCBANK", "BUY", 30, 1712.4, zonedToUtc(addDays(exDay, -3), "10:20:00"), "CNC", "DEMOORD999006");
  push("HDFCBANK", "SELL", 10, 1731.0, zonedToUtc(exDay, "10:40:00"), "CNC", "DEMOORD999007");
  return execs.sort((a, b) => a.executedAt.localeCompare(b.executedAt));
}

/** Deterministic synthetic journal for ~65% of demo trades. */
export function demoJournalFor(
  tradeKey: string,
  ctx: { netPnl: number; avgEntry: number; avgExit: number; direction: "LONG" | "SHORT" }
): JournalEntry | null {
  let h = 0;
  for (let i = 0; i < tradeKey.length; i++) h = (Math.imul(h, 31) + tradeKey.charCodeAt(i)) | 0;
  const rnd = mulberry32(h);
  if (tradeKey.includes("DEMO999001")) return null; // leave the spec example un-journaled
  if (rnd() > 0.65) return null;
  const loss = ctx.netPnl < 0;
  const riskPct = 0.004 + rnd() * 0.008;
  const stop = ctx.direction === "LONG" ? ctx.avgEntry * (1 - riskPct) : ctx.avgEntry * (1 + riskPct);
  const target = ctx.direction === "LONG" ? ctx.avgEntry * (1 + riskPct * 2) : ctx.avgEntry * (1 - riskPct * 2);
  const followed = loss ? rnd() > 0.45 : rnd() > 0.15;
  const mistakes = !followed || (loss && rnd() < 0.5) ? [MISTAKES[Math.floor(rnd() * MISTAKES.length)]] : [];
  return {
    tradeKey,
    strategy: DEMO_STRATEGIES[Math.floor(rnd() * DEMO_STRATEGIES.length)],
    entryRationale: rnd() < 0.8 ? "Price reclaimed VWAP with rising volume after the opening range." : null,
    exitRationale: rnd() < 0.7 ? (loss ? "Stop area reached; exited per plan." : "Target zone reached; booked profit.") : null,
    plannedStop: rnd() < 0.85 ? Math.round(stop * 20) / 20 : null,
    plannedTarget: rnd() < 0.7 ? Math.round(target * 20) / 20 : null,
    followedPlan: followed,
    mistakes,
    lessons: mistakes.length ? "Wait for confirmation candle before entry." : null,
    emotionalState: EMOTIONS[Math.floor(rnd() * EMOTIONS.length)],
    confidence: 1 + Math.floor(rnd() * 5),
    tags: rnd() < 0.5 ? ["demo"] : ["demo", "momentum"],
    notes: null,
  };
}

export interface Candle {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const INTERVAL_MIN: Record<string, number> = { "1minute": 1, "5minute": 5, "15minute": 15, "30minute": 30, day: 375 };

/**
 * SYNTHETIC candles for demo replay only. A Brownian bridge pinned to the recorded
 * entry and exit prices — explicitly labelled as synthetic in the UI.
 */
export function demoCandles(
  entryAt: string,
  exitAt: string,
  entryPx: number,
  exitPx: number,
  interval: keyof typeof INTERVAL_MIN,
  seedKey: string
): Candle[] {
  let h = 7;
  for (let i = 0; i < seedKey.length; i++) h = (Math.imul(h, 33) ^ seedKey.charCodeAt(i)) | 0;
  const rnd = mulberry32(h);
  const step = INTERVAL_MIN[interval];
  const times: number[] = [];
  const entryT = Date.parse(entryAt) / 1000;
  const exitT = Date.parse(exitAt) / 1000;
  if (interval === "day") {
    let d = addDays(localDate(entryAt), -25);
    const end = addDays(localDate(exitAt), 10);
    for (; d <= end; d = addDays(d, 1)) if (![0, 6].includes(weekdayOf(d))) times.push(Date.parse(zonedToUtc(d, "09:15:00")) / 1000);
  } else {
    let d = addDays(localDate(entryAt), -1);
    while ([0, 6].includes(weekdayOf(d))) d = addDays(d, -1); // previous session as context
    const end = localDate(exitAt);
    for (; d <= end; d = addDays(d, 1)) {
      if ([0, 6].includes(weekdayOf(d))) continue;
      const open = Date.parse(zonedToUtc(d, "09:15:00")) / 1000;
      for (let m = 0; m < 375; m += step) times.push(open + m * 60);
    }
  }
  if (!times.length) return [];
  const idxOf = (t: number) => {
    let best = 0;
    for (let i = 0; i < times.length; i++) if (times[i] <= t) best = i;
    return best;
  };
  const ei = idxOf(entryT);
  const xi = Math.max(ei, idxOf(exitT));
  const sigma = entryPx * 0.0025 * Math.sqrt(step / 5);
  const path: number[] = new Array(times.length);
  path[ei] = entryPx;
  for (let i = ei - 1; i >= 0; i--) path[i] = path[i + 1] + (rnd() - 0.5) * 2 * sigma;
  for (let i = ei + 1; i <= xi; i++) {
    const remaining = xi - i + 1;
    path[i] = path[i - 1] + (exitPx - path[i - 1]) / remaining + (remaining > 1 ? (rnd() - 0.5) * 2 * sigma : 0);
  }
  path[xi] = exitPx;
  for (let i = xi + 1; i < times.length; i++) path[i] = path[i - 1] + (rnd() - 0.5) * 2 * sigma;
  return times.map((t, i) => {
    const close = tick(path[i]);
    const open = tick(i ? path[i - 1] : path[i] + (rnd() - 0.5) * sigma);
    const wig = Math.abs(rnd() * sigma * 0.8);
    return {
      time: t,
      open,
      close,
      high: tick(Math.max(open, close) + wig),
      low: tick(Math.min(open, close) - Math.abs(rnd() * sigma * 0.8)),
      volume: Math.round(2000 + rnd() * 20000),
    };
  });
}
