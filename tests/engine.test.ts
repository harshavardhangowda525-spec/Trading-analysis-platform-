import { describe, expect, it } from "vitest";
import { reconstruct, BREAKEVEN_EPSILON } from "@/lib/engine/reconstruct";
import { computeMetrics, drawdownSeries, behaviorAnalysis } from "@/lib/engine/metrics";
import { estimateCosts, sumCosts } from "@/lib/engine/fees";
import { calendarWeek, localDate, weekStartOf, zonedToUtc } from "@/lib/engine/time";
import { buildWeeklyReport } from "@/lib/engine/weekly";
import { riskStatus } from "@/lib/engine/risk";
import { DEFAULT_RISK, type ClosedTrade, type JournalEntry } from "@/lib/engine/types";
import { ex } from "./fixtures/executions";

const D = "2026-11-02"; // Monday

describe("gross and net P&L", () => {
  it("computes the spec example: 10 @ ₹250 -> ₹246", () => {
    const { closedTrades } = reconstruct([ex("NIFTYBEES", "BUY", 10, 250, D, "10:00:00"), ex("NIFTYBEES", "SELL", 10, 246, D, "11:00:00")]);
    expect(closedTrades).toHaveLength(1);
    const t = closedTrades[0];
    expect(t.grossPnl).toBe(-40);
    expect(t.returnPct).toBeCloseTo(-1.6, 6);
    expect(t.costStatus).toBe("estimated");
    expect(t.netPnl).toBeCloseTo(-40 - t.estCosts, 6);
    expect(t.outcome).toBe("loss");
  });

  it("uses verified costs over estimates when supplied", () => {
    const execs = [ex("INFY", "BUY", 10, 1500, D, "10:00:00", { id: "V1" }), ex("INFY", "SELL", 10, 1520, D, "10:30:00", { id: "V2" })];
    const key = "NSE:INFY:MIS:NSE:V1";
    const { closedTrades } = reconstruct(execs, { verifiedCosts: new Map([[key, [{ component: "other", amount: 12.5, source: "verified" }]]]) });
    expect(closedTrades[0].tradeKey).toBe(key);
    expect(closedTrades[0].costStatus).toBe("verified");
    expect(closedTrades[0].netPnl).toBe(200 - 12.5);
  });

  it("computes short intraday P&L", () => {
    const { closedTrades } = reconstruct([ex("SBIN", "SELL", 20, 800, D, "09:30:00"), ex("SBIN", "BUY", 20, 790, D, "10:30:00")]);
    expect(closedTrades[0].direction).toBe("SHORT");
    expect(closedTrades[0].grossPnl).toBe(200);
  });
});

describe("position reconstruction", () => {
  it("merges partial fills, scale-ins and multiple exits into one round trip", () => {
    const execs = [
      ex("TCS", "BUY", 30, 3500, D, "09:20:00", { order: "A" }),
      ex("TCS", "BUY", 70, 3501, D, "09:20:01", { order: "A" }),
      ex("TCS", "BUY", 50, 3490, D, "09:45:00", { order: "B" }),
      ex("TCS", "SELL", 80, 3520, D, "10:15:00", { order: "C" }),
      ex("TCS", "SELL", 70, 3530, D, "11:00:00", { order: "D" }),
    ];
    const { closedTrades, openPositions } = reconstruct(execs);
    expect(openPositions).toHaveLength(0);
    expect(closedTrades).toHaveLength(1);
    const t = closedTrades[0];
    expect(t.quantity).toBe(150);
    const entryValue = 30 * 3500 + 70 * 3501 + 50 * 3490;
    const exitValue = 80 * 3520 + 70 * 3530;
    expect(t.avgEntry).toBeCloseTo(entryValue / 150, 4);
    expect(t.grossPnl).toBeCloseTo(exitValue - entryValue, 2);
    // brokerage capped at ₹20 per ORDER (4 orders => ₹80), not per fill (5 fills => ₹100)
    expect(t.costs.find((c) => c.component === "brokerage")!.amount).toBeCloseTo(4 * 20, 2);
  });

  it("keeps an open position with FIFO realized P&L on partial exit", () => {
    const execs = [
      ex("ITC", "BUY", 10, 400, "2026-11-02", "10:00:00", { product: "CNC" }),
      ex("ITC", "BUY", 10, 420, "2026-11-03", "10:00:00", { product: "CNC" }),
      ex("ITC", "SELL", 12, 430, "2026-11-04", "10:00:00", { product: "CNC" }),
    ];
    const { closedTrades, openPositions } = reconstruct(execs);
    expect(closedTrades).toHaveLength(0);
    expect(openPositions).toHaveLength(1);
    expect(openPositions[0].openQuantity).toBe(8);
    expect(openPositions[0].avgCost).toBe(420); // FIFO: remaining lot from second buy
    expect(openPositions[0].realizedSoFar).toBe(10 * 30 + 2 * 10);
  });

  it("splits a fill that flips the position through zero", () => {
    const execs = [ex("SBIN", "BUY", 10, 800, D, "09:30:00"), ex("SBIN", "SELL", 15, 810, D, "10:00:00"), ex("SBIN", "BUY", 5, 805, D, "10:30:00")];
    const { closedTrades } = reconstruct(execs);
    expect(closedTrades).toHaveLength(2);
    expect(closedTrades[0].direction).toBe("LONG");
    expect(closedTrades[0].grossPnl).toBe(100);
    expect(closedTrades[1].direction).toBe("SHORT");
    expect(closedTrades[1].grossPnl).toBe(25);
    expect(closedTrades[1].tradeKey.endsWith("#2")).toBe(true);
  });

  it("does not fabricate a trade from a sell of pre-import holdings", () => {
    const { closedTrades, openPositions, warnings } = reconstruct([ex("RELIANCE", "SELL", 5, 1400, D, "10:00:00", { product: "CNC" })]);
    expect(closedTrades).toHaveLength(0);
    expect(openPositions).toHaveLength(0);
    expect(warnings.join(" ")).toMatch(/pre-import holdings/);
  });

  it("classifies UNKNOWN product by the same-day rule for cost estimation", () => {
    const intraday = reconstruct([ex("INFY", "BUY", 10, 1500, D, "10:00:00", { product: "UNKNOWN" }), ex("INFY", "SELL", 10, 1510, D, "14:00:00", { product: "UNKNOWN" })]);
    const delivery = reconstruct([ex("INFY", "BUY", 10, 1500, D, "10:00:00", { product: "UNKNOWN" }), ex("INFY", "SELL", 10, 1510, "2026-11-05", "14:00:00", { product: "UNKNOWN" })]);
    expect(intraday.closedTrades[0].costProduct).toBe("intraday");
    expect(delivery.closedTrades[0].costProduct).toBe("delivery");
  });

  it("is idempotent on duplicate executions", () => {
    const a = ex("ITC", "BUY", 10, 400, D, "10:00:00", { id: "DUP1" });
    const b = ex("ITC", "SELL", 10, 410, D, "11:00:00", { id: "DUP2" });
    const once = reconstruct([a, b]);
    const twice = reconstruct([a, b, { ...a }, { ...b }]);
    expect(twice.closedTrades).toEqual(once.closedTrades);
    expect(twice.warnings.filter((w) => w.startsWith("Duplicate"))).toHaveLength(2);
  });

  it("is deterministic regardless of input order", () => {
    const execs = [ex("TCS", "BUY", 5, 3500, D, "09:20:00"), ex("TCS", "SELL", 5, 3510, D, "09:50:00"), ex("ITC", "BUY", 5, 400, D, "09:25:00"), ex("ITC", "SELL", 5, 399, D, "10:00:00")];
    expect(reconstruct([...execs].reverse()).closedTrades).toEqual(reconstruct(execs).closedTrades);
  });
});

describe("fees", () => {
  it("caps intraday brokerage at ₹20 per order and uses 0.03% below the cap", () => {
    const small = estimateCosts([{ executionId: "a", brokerOrderId: "1", side: "BUY", quantity: 10, price: 250, executedAt: zonedToUtc(D, "10:00:00"), role: "entry" }], { exchange: "NSE", costProduct: "intraday", category: "stock" });
    expect(small.find((c) => c.component === "brokerage")!.amount).toBeCloseTo(0.75, 2);
    const big = estimateCosts([{ executionId: "a", brokerOrderId: "1", side: "BUY", quantity: 1000, price: 250, executedAt: zonedToUtc(D, "10:00:00"), role: "entry" }], { exchange: "NSE", costProduct: "intraday", category: "stock" });
    expect(big.find((c) => c.component === "brokerage")!.amount).toBe(20);
  });
  it("charges 0.1% STT on both sides for delivery equity and no brokerage", () => {
    const lines = estimateCosts(
      [
        { executionId: "a", brokerOrderId: "1", side: "BUY", quantity: 10, price: 1000, executedAt: zonedToUtc(D, "10:00:00"), role: "entry" },
        { executionId: "b", brokerOrderId: "2", side: "SELL", quantity: 10, price: 1000, executedAt: zonedToUtc("2026-11-04", "10:00:00"), role: "exit" },
      ],
      { exchange: "NSE", costProduct: "delivery", category: "stock" }
    );
    expect(lines.find((c) => c.component === "stt")!.amount).toBe(20);
    expect(lines.find((c) => c.component === "brokerage")!.amount).toBe(0);
    expect(lines.every((c) => c.source === "estimated")).toBe(true);
    expect(sumCosts(lines)).toBeGreaterThan(20);
  });
});

function fake(net: number, i: number, extra: Partial<ClosedTrade> = {}): ClosedTrade {
  const exitAt = zonedToUtc("2026-11-02", `${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`);
  return {
    tradeKey: `K${i}`, calcVersion: "fifo-v1", isDemo: false, exchange: "NSE", tradingsymbol: "X", category: "stock", product: "MIS", costProduct: "intraday",
    direction: "LONG", quantity: 10, avgEntry: 100, avgExit: 100 + net / 10, entryAt: exitAt, exitAt, grossPnl: net, estCosts: 0, verifiedCosts: null,
    netPnl: net, costStatus: "estimated", costs: [], returnPct: net / 10, holdingSeconds: 600,
    outcome: Math.abs(net) < BREAKEVEN_EPSILON ? "breakeven" : net > 0 ? "win" : "loss", legs: [], executionIds: [], ...extra,
  };
}

describe("metrics", () => {
  it("excludes breakeven trades from the win-rate denominator", () => {
    const m = computeMetrics([fake(100, 1), fake(-50, 2), fake(0.5, 3), fake(200, 4)]);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(1);
    expect(m.breakevens).toBe(1);
    expect(m.winRate).toBeCloseTo((2 / 3) * 100, 6);
    expect(m.winRateInclBreakeven).toBe(50);
  });
  it("handles zero-loss periods without dividing by zero", () => {
    const m = computeMetrics([fake(100, 1), fake(50, 2)]);
    expect(m.profitFactor).toBeNull();
    expect(m.profitFactorNote).toMatch(/No losing trades/);
    expect(computeMetrics([]).winRate).toBeNull();
  });
  it("computes profit factor and expectancy", () => {
    const m = computeMetrics([fake(300, 1), fake(-100, 2), fake(-100, 3), fake(0, 4)]);
    expect(m.profitFactor).toBe(1.5);
    // (1/4)*300 - (2/4)*100 = 25 = mean net P&L
    expect(m.expectancy).toBe(25);
  });
  it("computes peak-to-trough drawdown on realized equity", () => {
    const trades = [fake(500, 1), fake(-200, 2), fake(-400, 3), fake(300, 4), fake(-100, 5)];
    const m = computeMetrics(trades, { startingCapital: 10000 });
    expect(m.maxDrawdown).toBe(600);
    expect(m.maxDrawdownPct).toBeCloseTo((600 / 10500) * 100, 2);
    expect(drawdownSeries(trades, 10000).map((p) => p.equity)).toEqual([10500, 10300, 9900, 10200, 10100]);
  });
  it("computes reward/risk only for trades with a valid planned stop", () => {
    const t1 = fake(200, 1); // entry 100, qty 10
    const t2 = fake(-50, 2);
    const journal = new Map<string, JournalEntry>([
      ["K1", { tradeKey: "K1", plannedStop: 95, strategy: null, entryRationale: null, exitRationale: null, plannedTarget: null, followedPlan: true, mistakes: [], lessons: null, emotionalState: null, confidence: null, tags: [], notes: null }],
      ["K2", { tradeKey: "K2", plannedStop: 105, strategy: null, entryRationale: null, exitRationale: null, plannedTarget: null, followedPlan: true, mistakes: [], lessons: null, emotionalState: null, confidence: null, tags: [], notes: null }],
    ]);
    const m = computeMetrics([t1, t2], { journal });
    expect(m.rrSampleSize).toBe(1); // K2 stop is above a long entry => invalid
    expect(m.avgRR).toBe(4);
  });
  it("reports insufficient data for behaviour findings without journal evidence", () => {
    const f = behaviorAnalysis([fake(100, 1), fake(-50, 2)], new Map(), DEFAULT_RISK);
    expect(f.find((x) => x.id === "stop_violations")!.status).toBe("insufficient_data");
    expect(f.find((x) => x.id === "outside_plan")!.status).toBe("insufficient_data");
  });
});

describe("timezone boundaries", () => {
  it("buckets by IST date, not UTC", () => {
    // 2026-11-02 23:30 IST == 18:00 UTC same day; 2026-11-03 00:30 IST == 2026-11-02 19:00 UTC
    expect(localDate(zonedToUtc("2026-11-03", "00:30:00"))).toBe("2026-11-03");
    expect(zonedToUtc("2026-11-03", "00:30:00")).toBe("2026-11-02T19:00:00.000Z");
  });
  it("uses calendar weeks with configurable week start", () => {
    expect(weekStartOf("2026-11-08", 1)).toBe("2026-11-02"); // Sunday -> Monday-start week
    expect(weekStartOf("2026-11-08", 0)).toBe("2026-11-08");
    expect(calendarWeek(zonedToUtc("2026-11-09", "00:10:00"))).toEqual({ start: "2026-11-09", end: "2026-11-15" });
  });
});

describe("weekly report", () => {
  it("includes only trades closed inside the calendar week in the user's timezone", () => {
    const execs = [
      ex("A", "BUY", 1, 100, "2026-11-01", "10:00:00"), ex("A", "SELL", 1, 110, "2026-11-01", "11:00:00"), // previous week (Sunday)
      ex("B", "BUY", 1, 100, "2026-11-02", "10:00:00"), ex("B", "SELL", 1, 90, "2026-11-02", "11:00:00"),
      ex("C", "BUY", 1, 100, "2026-11-08", "10:00:00"), ex("C", "SELL", 1, 120, "2026-11-08", "11:00:00"), // Sunday, still this week
      ex("D", "BUY", 1, 100, "2026-11-09", "10:00:00"), ex("D", "SELL", 1, 120, "2026-11-09", "11:00:00"), // next week
    ];
    const { closedTrades } = reconstruct(execs);
    const r = buildWeeklyReport(closedTrades, new Map(), "2026-11-02");
    expect(r.kind).toBe("calendar_week");
    expect(r.weekEnd).toBe("2026-11-08");
    expect(r.metrics.tradeCount).toBe(2);
    expect(r.tradeKeys.every((k) => /:(B|C):/.test(k))).toBe(true);
  });
});

describe("risk center", () => {
  it("raises an informational alert when the daily loss limit is exceeded", () => {
    const t = fake(-2500, 1);
    const s = riskStatus([t], new Map(), DEFAULT_RISK, new Date(t.exitAt));
    expect(s.alerts.find((a) => a.id === "daily")?.message).toMatch(/exceeded your configured daily loss limit/);
    expect(s.dailyBudgetRemaining).toBe(-500);
  });
});
