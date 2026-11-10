/**
 * TRADEOS INTELLIGENCE — evidence-based trade review.
 *
 * Stage 1 (deterministic): build facts, hypotheses, missing information and
 * improvement experiments strictly from executions, journal records and (when
 * licensed and available) market candles.
 * Stage 2 (optional LLM): the model writes a short narrative from the stage-1
 * JSON only. The narrative is rejected if it contains any number not present in
 * the payload or any forbidden claim; the deterministic summary is used instead.
 */
import type { Candle } from "@/lib/demo/generate";
import type { ClosedTrade, JournalEntry } from "@/lib/engine/types";
import { fmt, plannedRisk } from "@/lib/engine/metrics";
import { localDate, sessionOf } from "@/lib/engine/time";
import { allowedNumbers, checkGrounding } from "./grounding";

export interface ReviewItem {
  key: string;
  text: string;
  evidence?: string;
}

export interface TradeReview {
  tradeKey: string;
  verifiedFacts: ReviewItem[];
  possibleFactors: ReviewItem[];
  missingInformation: ReviewItem[];
  improvements: ReviewItem[];
  narrative: string;
  narrativeSource: "llm" | "deterministic";
  model: string | null;
  marketDataUsed: "licensed" | "synthetic_demo" | "none";
}

const pct = (n: number, d = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}%`;

export function holdingText(s: number) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function buildReview(
  t: ClosedTrade,
  j: JournalEntry | null,
  history: ClosedTrade[],
  candles: Candle[] | null,
  marketData: TradeReview["marketDataUsed"] = candles ? "licensed" : "none",
  maxTradesPerDay = 5
): Omit<TradeReview, "narrative" | "narrativeSource" | "model"> {
  const facts: ReviewItem[] = [];
  const factors: ReviewItem[] = [];
  const missing: ReviewItem[] = [];
  const improve: ReviewItem[] = [];
  const costs = t.verifiedCosts ?? t.estCosts;
  const long = t.direction === "LONG";

  facts.push({ key: "entry", text: `${long ? "Bought" : "Sold short"} ${t.quantity} ${t.tradingsymbol} at an average of ${fmt(t.avgEntry)}.` });
  facts.push({ key: "exit", text: `${long ? "Sold" : "Covered"} at an average of ${fmt(t.avgExit)}.` });
  facts.push({ key: "gross", text: `Gross P&L ${fmt(t.grossPnl)} (${pct(t.returnPct)} on entry value of ${fmt(t.avgEntry * t.quantity)}).` });
  facts.push({
    key: "costs",
    text: `${t.costStatus === "verified" ? "Verified" : "Estimated"} charges ${fmt(costs)}; net P&L ${fmt(t.netPnl)}.`,
    evidence: t.costStatus === "estimated" ? "Charges are estimated from the fee schedule, not a contract note." : undefined,
  });
  facts.push({ key: "holding", text: `Held for ${holdingText(t.holdingSeconds)}; entered during the ${sessionOf(t.entryAt).toLowerCase()} session on ${localDate(t.entryAt)}.` });
  const entryLegs = t.legs.filter((l) => l.role === "entry").length;
  const exitLegs = t.legs.filter((l) => l.role === "exit").length;
  if (entryLegs > 1 || exitLegs > 1) facts.push({ key: "legs", text: `Built from ${entryLegs} entry fill(s) and ${exitLegs} exit fill(s).` });

  // Journal-based facts
  if (j?.plannedStop) {
    const risk = plannedRisk(t, j);
    if (risk) {
      const r = t.netPnl / risk;
      facts.push({ key: "rr", text: `Planned stop ${fmt(j.plannedStop)} implied initial risk of ${fmt(risk)}; realized result was ${r.toFixed(2)}R.` });
      const beyond = long ? t.avgExit < j.plannedStop * 0.999 : t.avgExit > j.plannedStop * 1.001;
      if (beyond)
        factors.push({ key: "stop_breach", text: `The average exit ${fmt(t.avgExit)} was beyond the recorded stop ${fmt(j.plannedStop)}, so the loss exceeded the planned risk.`, evidence: "Recorded stop vs executed exit price" });
    } else facts.push({ key: "stop_invalid", text: `The recorded stop ${fmt(j.plannedStop)} is on the wrong side of the entry, so planned risk cannot be computed.` });
  } else missing.push({ key: "stop", text: "No planned stop-loss was recorded, so risk/reward and stop adherence cannot be verified." });
  if (!j?.entryRationale) missing.push({ key: "rationale", text: "Entry rationale was not recorded, so strategy compliance cannot be verified." });
  if (!j?.strategy) missing.push({ key: "strategy", text: "No strategy is assigned to this trade." });
  if (j?.followedPlan === false) factors.push({ key: "plan", text: "You marked this trade as not following your plan.", evidence: "Journal: followed plan = no" });
  if (j?.mistakes.length) factors.push({ key: "mistakes", text: `You tagged: ${j.mistakes.join(", ")}.`, evidence: "Journal mistake tags" });

  // History-based context (objective comparisons, phrased as hypotheses)
  const others = history.filter((h) => h.tradeKey !== t.tradeKey);
  if (others.length >= 5) {
    const sizes = others.map((h) => h.avgEntry * h.quantity);
    const medSize = median(sizes);
    const size = t.avgEntry * t.quantity;
    if (size > medSize * 1.5)
      factors.push({ key: "size", text: `Position value ${fmt(size)} was ${(size / medSize).toFixed(1)}× your median of ${fmt(medSize)}; larger size magnifies the impact of an adverse move.`, evidence: "Comparison with your closed-trade history" });
    const winners = others.filter((h) => h.outcome === "win");
    if (t.outcome === "loss" && winners.length >= 3) {
      const medWinHold = median(winners.map((h) => h.holdingSeconds));
      if (t.holdingSeconds < medWinHold * 0.4)
        factors.push({ key: "hold_short", text: `Held ${holdingText(t.holdingSeconds)} versus a median of ${holdingText(medWinHold)} on your winning trades.`, evidence: "Holding period comparison" });
    }
    const prior = [...others].filter((h) => h.exitAt <= t.entryAt).sort((a, b) => b.exitAt.localeCompare(a.exitAt));
    let streak = 0;
    for (const p of prior) {
      if (p.outcome === "loss") streak++;
      else if (p.outcome === "win") break;
    }
    if (streak >= 2) factors.push({ key: "after_losses", text: `This trade was entered after ${streak} consecutive losing trades.`, evidence: "Trade sequence" });
    const sameDay = history.filter((h) => localDate(h.entryAt) === localDate(t.entryAt)).length;
    if (sameDay > maxTradesPerDay) factors.push({ key: "frequency", text: `${sameDay} trades were opened that day, above your configured limit of ${maxTradesPerDay}.`, evidence: "Trade count vs risk settings" });
  }

  // Market-context (only with candles)
  if (candles && candles.length >= 25) {
    const entryT = Date.parse(t.entryAt) / 1000;
    const exitT = Date.parse(t.exitAt) / 1000;
    const idx = candles.findIndex((c) => c.time > entryT) - 1;
    const i = idx < 0 ? candles.length - 1 : idx;
    if (i >= 20) {
      const sma = candles.slice(i - 19, i + 1).reduce((a, c) => a + c.close, 0) / 20;
      const above = t.avgEntry >= sma;
      factors.push({
        key: "sma",
        text: `The entry occurred ${above ? "above" : "below"} the 20-period moving average (${fmt(sma)}). This alone does not establish why the trade ${t.outcome === "loss" ? "failed" : "worked"}.`,
        evidence: marketData === "synthetic_demo" ? "SYNTHETIC demo candles" : "Historical candles",
      });
      const atr = candles.slice(i - 13, i + 1).reduce((a, c) => a + (c.high - c.low), 0) / 14;
      const stopDist = j?.plannedStop ? Math.abs(t.avgEntry - j.plannedStop) : null;
      if (stopDist && stopDist < atr * 0.8)
        factors.push({ key: "stop_tight", text: `Your stop distance (${fmt(stopDist)}) was smaller than the average candle range (${fmt(atr)}), so normal noise could reach it.`, evidence: "ATR(14) vs stop distance" });
    }
    const during = candles.filter((c) => c.time >= entryT && c.time <= exitT);
    if (during.length) {
      const best = long ? Math.max(...during.map((c) => c.high)) : Math.min(...during.map((c) => c.low));
      const mfePct = ((best - t.avgEntry) / t.avgEntry) * 100 * (long ? 1 : -1);
      if (t.outcome === "loss" && mfePct > 0.3)
        factors.push({ key: "mfe", text: `Price moved up to ${mfePct.toFixed(2)}% in your favour before the exit; exit management may have contributed.`, evidence: "Maximum favourable excursion" });
    }
  } else {
    missing.push({ key: "market", text: "Historical market data was not available, so trend, structure, volatility and volume context were not assessed." });
  }

  // Improvement experiments — specific and testable, never trade signals
  if (missing.find((m) => m.key === "stop")) improve.push({ key: "imp_stop", text: "Record a planned stop and target before entry on your next 20 trades so risk/reward can be measured." });
  if (factors.find((f) => f.key === "stop_breach")) improve.push({ key: "imp_breach", text: "Place the stop-loss order at entry and track how often exits exceed the plan over the next 20 trades." });
  if (factors.find((f) => f.key === "size")) improve.push({ key: "imp_size", text: "Test a fixed-risk sizing rule (quantity = risk budget ÷ stop distance) and compare outcome dispersion." });
  if (factors.find((f) => f.key === "after_losses")) improve.push({ key: "imp_pause", text: "Experiment with a mandatory review pause after two consecutive losses and compare subsequent results." });
  if (factors.find((f) => f.key === "mfe")) improve.push({ key: "imp_mfe", text: "Back-test a rule that moves the stop to breakeven after a +1R move on your recorded trades." });
  if (factors.find((f) => f.key === "frequency")) improve.push({ key: "imp_freq", text: "Cap trades per day at your configured limit for two weeks and compare net P&L per trade." });
  if (!improve.length) improve.push({ key: "imp_journal", text: "Add entry and exit rationale so future reviews can test strategy adherence." });

  return { tradeKey: t.tradeKey, verifiedFacts: facts, possibleFactors: factors, missingInformation: missing, improvements: improve, marketDataUsed: marketData };
}

export function deterministicNarrative(t: ClosedTrade, r: Omit<TradeReview, "narrative" | "narrativeSource" | "model">): string {
  const verb = t.grossPnl < 0 ? "lost" : t.grossPnl > 0 ? "gained" : "ended flat at";
  const parts = [`Your trade ${verb} ${Math.abs(t.returnPct).toFixed(Math.abs(t.returnPct) < 0.1 ? 2 : 1)}% before charges (gross ${fmt(t.grossPnl)}, net ${fmt(t.netPnl)}).`];
  const sma = r.possibleFactors.find((f) => f.key === "sma");
  if (sma) parts.push(sma.text);
  if (r.missingInformation.find((m) => m.key === "stop") && r.missingInformation.find((m) => m.key === "rationale"))
    parts.push("Your initial stop-loss and entry rationale were not recorded, so strategy compliance cannot be verified.");
  else if (r.possibleFactors.length) parts.push(`Possible contributing factors: ${r.possibleFactors.filter((f) => f.key !== "sma").map((f) => f.text.replace(/\.$/, "")).join("; ") || "none identified"}.`);
  if (t.outcome === "loss") parts.push("A losing trade is not necessarily a bad trade; the review focuses on process, not outcome.");
  return parts.join(" ");
}

export const REVIEW_SYSTEM_PROMPT = `You are TRADEOS Intelligence, a trading-process reviewer.
Rules:
- Use ONLY the JSON payload. Never invent prices, reasons, P&L, or market events.
- Restate numbers exactly as given; do not compute new numbers.
- Distinguish verified facts from possible factors. Hedge hypotheses ("may have", "possibly").
- If information is missing, say what is missing instead of guessing.
- Never say a losing trade was necessarily a bad trade. Never promise future profits.
- Never give buy/sell recommendations or signals.
- 3 to 5 sentences, plain English, no markdown.`;

export function validateNarrative(text: string, payload: unknown) {
  return checkGrounding(text, allowedNumbers(payload));
}
