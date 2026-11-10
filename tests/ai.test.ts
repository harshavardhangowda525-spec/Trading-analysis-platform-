import { describe, expect, it } from "vitest";
import { allowedNumbers, checkGrounding } from "@/lib/ai/grounding";
import { buildReview, deterministicNarrative } from "@/lib/ai/review";
import { routeQuestion, runTool, resolvePeriod } from "@/lib/ai/coach";
import { reconstruct } from "@/lib/engine/reconstruct";
import { DEFAULT_RISK } from "@/lib/engine/types";
import { ex } from "./fixtures/executions";

const { closedTrades } = reconstruct([ex("NIFTYBEES", "BUY", 10, 250, "2026-11-02", "10:00:00"), ex("NIFTYBEES", "SELL", 10, 246, "2026-11-02", "11:00:00")]);
const t = closedTrades[0];

describe("AI response grounding", () => {
  const payload = { gross: -40, ret: -1.6, entry: 250, exit: 246, qty: 10 };
  it("accepts text that only restates payload numbers", () => {
    expect(checkGrounding("You bought 10 units at ₹250 and exited at ₹246, a gross loss of ₹40 (−1.6%).", allowedNumbers(payload)).ok).toBe(true);
  });
  it("rejects invented numbers", () => {
    const g = checkGrounding("Your stop at ₹244.50 was hit after a 2.3% move.", allowedNumbers(payload));
    expect(g.ok).toBe(false);
    expect(g.ungrounded.length).toBe(2);
  });
  it("rejects promises and trade signals", () => {
    expect(checkGrounding("Your next trade will be profitable.", allowedNumbers(payload)).ok).toBe(false);
    expect(checkGrounding("You should buy NIFTYBEES now.", allowedNumbers(payload)).ok).toBe(false);
  });
});

describe("evidence-based review", () => {
  it("separates facts from missing information and never invents a reason", () => {
    const r = buildReview(t, null, closedTrades, null);
    expect(r.verifiedFacts.find((f) => f.key === "gross")!.text).toContain("−₹40.00");
    expect(r.verifiedFacts.find((f) => f.key === "gross")!.text).toContain("−1.60%");
    expect(r.missingInformation.map((m) => m.key)).toEqual(expect.arrayContaining(["stop", "rationale", "market"]));
    expect(r.possibleFactors).toHaveLength(0);
    const n = deterministicNarrative(t, r);
    expect(n).toMatch(/lost 1.6% before charges/);
    expect(n).toMatch(/strategy compliance cannot be verified/);
    expect(n).toMatch(/not necessarily a bad trade/);
  });
  it("only flags a stop breach when a stop was recorded", () => {
    const j = { tradeKey: t.tradeKey, strategy: "ORB", entryRationale: "x", exitRationale: null, plannedStop: 248, plannedTarget: 256, followedPlan: true, mistakes: [], lessons: null, emotionalState: null, confidence: null, tags: [], notes: null };
    const r = buildReview(t, j, closedTrades, null);
    expect(r.possibleFactors.find((f) => f.key === "stop_breach")).toBeTruthy();
    expect(r.verifiedFacts.find((f) => f.key === "rr")!.text).toMatch(/−2\.\d\dR|-2\.\d\dR/);
  });
});

describe("coach tools", () => {
  const ctx = { trades: closedTrades, journal: new Map(), risk: DEFAULT_RISK, tz: "Asia/Kolkata", weekStart: 1, now: new Date("2026-11-10T06:00:00Z") };
  it("routes questions to deterministic tools", () => {
    expect(routeQuestion("What was my win rate last week?")).toEqual([{ name: "get_performance", args: { period: "last_week" } }]);
    expect(routeQuestion("Show my worst five trades")[0].name).toBe("list_trades");
    expect(routeQuestion("Compare my last two weeks")[0].name).toBe("compare_periods");
    expect(routeQuestion("How much did I lose to transaction charges?")[0].name).toBe("cost_breakdown");
  });
  it("uses calendar weeks and returns traceable trade ids", () => {
    expect(resolvePeriod("last_week", ctx.now)).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
    const r = runTool(ctx, "get_performance", { period: "last_week" });
    expect(r.tradeIds).toEqual([t.tradeKey]);
    expect(r.data.net_pnl).toBe(t.netPnl);
    expect(r.summary).toContain("last calendar week");
  });
});
