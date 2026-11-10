/**
 * Deterministic performance metrics. No LLM is involved in any calculation.
 *
 * Conventions (documented, tested):
 *  - Outcome is based on NET P&L (see reconstruct.ts, BREAKEVEN_EPSILON = ₹1).
 *  - winRate = wins / (wins + losses) × 100. Breakeven trades are EXCLUDED from the
 *    denominator and reported separately; `winRateInclBreakeven` uses all closed trades.
 *  - profitFactor = gross profits / |gross losses| on net P&L of winning vs losing
 *    trades. With no losing trades it is `null` and `profitFactorNote` explains why.
 *  - expectancy = P(win)·avgWin − P(loss)·avgLoss, probabilities over ALL closed trades
 *    (breakevens contribute 0), which equals mean net P&L per trade.
 *  - Drawdown is computed on the cumulative REALIZED net P&L series (by exit time),
 *    starting from `startingCapital`. Mark-to-market is never mixed in.
 *  - Reward/risk is only computed for trades with a recorded planned stop.
 */
import type { ClosedTrade, JournalEntry, RiskSettings } from "./types";
import { DAY_NAMES, localDate, localMonth, sessionOf, weekStartOf, zonedParts, DEFAULT_TZ } from "./time";

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export interface CoreMetrics {
  tradeCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  netPnl: number;
  grossPnl: number;
  totalCosts: number;
  costsAllVerified: boolean;
  winRate: number | null;
  winRateInclBreakeven: number | null;
  avgWin: number | null;
  avgLoss: number | null; // positive magnitude
  profitFactor: number | null;
  profitFactorNote: string | null;
  expectancy: number | null;
  avgRR: number | null;
  rrSampleSize: number;
  maxDrawdown: number; // ₹, positive magnitude
  maxDrawdownPct: number | null;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
  currentStreak: { type: "win" | "loss" | "none"; count: number };
  avgHoldingSeconds: number | null;
  bestTrade: ClosedTrade | null;
  worstTrade: ClosedTrade | null;
}

export function plannedRisk(t: ClosedTrade, j?: JournalEntry | null): number | null {
  if (!j || j.plannedStop == null || !(j.plannedStop > 0)) return null;
  const perUnit = t.direction === "LONG" ? t.avgEntry - j.plannedStop : j.plannedStop - t.avgEntry;
  if (!(perUnit > 0)) return null; // stop on wrong side => invalid plan data
  return perUnit * t.quantity;
}

export function computeMetrics(
  trades: ClosedTrade[],
  opts: { tz?: string; startingCapital?: number; journal?: Map<string, JournalEntry> } = {}
): CoreMetrics {
  const tz = opts.tz ?? DEFAULT_TZ;
  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  const bes = trades.filter((t) => t.outcome === "breakeven");
  const decided = wins.length + losses.length;
  const grossProfit = sum(wins.map((t) => t.netPnl));
  const grossLoss = Math.abs(sum(losses.map((t) => t.netPnl)));
  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;
  const n = trades.length;

  let profitFactor: number | null = null;
  let profitFactorNote: string | null = null;
  if (n === 0) profitFactorNote = "No closed trades";
  else if (losses.length === 0) profitFactorNote = wins.length ? "No losing trades — undefined (∞)" : "No wins or losses";
  else profitFactor = grossProfit / grossLoss;

  const expectancy = n ? (wins.length / n) * (avgWin ?? 0) - (losses.length / n) * (avgLoss ?? 0) : null;

  // reward/risk
  const rrs: number[] = [];
  for (const t of trades) {
    const risk = plannedRisk(t, opts.journal?.get(t.tradeKey));
    if (risk) rrs.push(t.netPnl / risk);
  }

  // drawdown on realized equity
  const dd = drawdownSeries(trades, opts.startingCapital ?? 0, tz);
  const maxDD = dd.reduce((m, p) => Math.max(m, p.drawdown), 0);
  const maxDDPct = opts.startingCapital ? dd.reduce((m, p) => Math.max(m, p.drawdownPct ?? 0), 0) : null;

  const days = groupSum(trades, (t) => localDate(t.exitAt, tz));
  let bestDay: CoreMetrics["bestDay"] = null;
  let worstDay: CoreMetrics["worstDay"] = null;
  for (const [date, pnl] of days) {
    if (!bestDay || pnl > bestDay.pnl) bestDay = { date, pnl: r2(pnl) };
    if (!worstDay || pnl < worstDay.pnl) worstDay = { date, pnl: r2(pnl) };
  }

  // current streak (breakevens neither extend nor break a streak)
  const ordered = [...trades].sort((a, b) => a.exitAt.localeCompare(b.exitAt));
  let streak: CoreMetrics["currentStreak"] = { type: "none", count: 0 };
  for (let i = ordered.length - 1; i >= 0; i--) {
    const o = ordered[i].outcome;
    if (o === "breakeven") continue;
    if (streak.type === "none") streak = { type: o, count: 1 };
    else if (streak.type === o) streak.count++;
    else break;
  }

  const byNet = [...trades].sort((a, b) => b.netPnl - a.netPnl);
  return {
    tradeCount: n,
    wins: wins.length,
    losses: losses.length,
    breakevens: bes.length,
    netPnl: r2(sum(trades.map((t) => t.netPnl))),
    grossPnl: r2(sum(trades.map((t) => t.grossPnl))),
    totalCosts: r2(sum(trades.map((t) => t.verifiedCosts ?? t.estCosts))),
    costsAllVerified: n > 0 && trades.every((t) => t.costStatus === "verified"),
    winRate: decided ? (wins.length / decided) * 100 : null,
    winRateInclBreakeven: n ? (wins.length / n) * 100 : null,
    avgWin: avgWin == null ? null : r2(avgWin),
    avgLoss: avgLoss == null ? null : r2(avgLoss),
    profitFactor: profitFactor == null ? null : Math.round(profitFactor * 100) / 100,
    profitFactorNote,
    expectancy: expectancy == null ? null : r2(expectancy),
    avgRR: rrs.length ? Math.round(mean(rrs) * 100) / 100 : null,
    rrSampleSize: rrs.length,
    maxDrawdown: r2(maxDD),
    maxDrawdownPct: maxDDPct == null ? null : Math.round(maxDDPct * 100) / 100,
    bestDay,
    worstDay,
    currentStreak: streak,
    avgHoldingSeconds: n ? Math.round(mean(trades.map((t) => t.holdingSeconds))) : null,
    bestTrade: byNet[0] ?? null,
    worstTrade: byNet[byNet.length - 1] ?? null,
  };
}

function groupSum(trades: ClosedTrade[], key: (t: ClosedTrade) => string) {
  const m = new Map<string, number>();
  for (const t of trades) m.set(key(t), (m.get(key(t)) ?? 0) + t.netPnl);
  return m;
}

export interface EquityPoint {
  time: string; // exit ISO
  date: string;
  equity: number;
  cumulative: number;
  drawdown: number;
  drawdownPct: number | null;
  tradeKey: string;
}

export function drawdownSeries(trades: ClosedTrade[], startingCapital = 0, tz = DEFAULT_TZ): EquityPoint[] {
  const ordered = [...trades].sort((a, b) => a.exitAt.localeCompare(b.exitAt));
  let cum = 0;
  let peak = startingCapital;
  const out: EquityPoint[] = [];
  for (const t of ordered) {
    cum += t.netPnl;
    const equity = startingCapital + cum;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    out.push({
      time: t.exitAt,
      date: localDate(t.exitAt, tz),
      equity: r2(equity),
      cumulative: r2(cum),
      drawdown: r2(dd),
      drawdownPct: peak > 0 ? (dd / peak) * 100 : null,
      tradeKey: t.tradeKey,
    });
  }
  return out;
}

export interface Bucket {
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  grossPnl: number;
  winRate: number | null;
  profitFactor: number | null;
  avgReturnPct: number | null;
  avgHoldingSeconds: number | null;
}

export function bucketize(
  trades: ClosedTrade[],
  keyFn: (t: ClosedTrade) => string,
  labelFn: (k: string) => string = (k) => k
): Bucket[] {
  const m = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const k = keyFn(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return [...m.entries()].map(([k, ts]) => {
    const w = ts.filter((t) => t.outcome === "win");
    const l = ts.filter((t) => t.outcome === "loss");
    const gp = sum(w.map((t) => t.netPnl));
    const gl = Math.abs(sum(l.map((t) => t.netPnl)));
    return {
      key: k,
      label: labelFn(k),
      trades: ts.length,
      wins: w.length,
      losses: l.length,
      netPnl: r2(sum(ts.map((t) => t.netPnl))),
      grossPnl: r2(sum(ts.map((t) => t.grossPnl))),
      winRate: w.length + l.length ? (w.length / (w.length + l.length)) * 100 : null,
      profitFactor: l.length ? Math.round((gp / gl) * 100) / 100 : null,
      avgReturnPct: ts.length ? mean(ts.map((t) => t.returnPct)) : null,
      avgHoldingSeconds: ts.length ? Math.round(mean(ts.map((t) => t.holdingSeconds))) : null,
    };
  });
}

export function breakdowns(trades: ClosedTrade[], tz = DEFAULT_TZ, weekStart = 1, journal?: Map<string, JournalEntry>) {
  const byKey = (a: Bucket, b: Bucket) => a.key.localeCompare(b.key);
  return {
    daily: bucketize(trades, (t) => localDate(t.exitAt, tz)).sort(byKey),
    weekly: bucketize(trades, (t) => weekStartOf(localDate(t.exitAt, tz), weekStart)).sort(byKey),
    monthly: bucketize(trades, (t) => localMonth(t.exitAt, tz)).sort(byKey),
    dayOfWeek: bucketize(trades, (t) => String(zonedParts(t.entryAt, tz).weekday), (k) => DAY_NAMES[+k]).sort(byKey),
    hourOfDay: bucketize(trades, (t) => String(zonedParts(t.entryAt, tz).hour).padStart(2, "0"), (k) => `${k}:00`).sort(byKey),
    session: bucketize(trades, (t) => sessionOf(t.entryAt, tz)),
    symbol: bucketize(trades, (t) => t.tradingsymbol).sort((a, b) => b.netPnl - a.netPnl),
    category: bucketize(trades, (t) => t.category),
    exchange: bucketize(trades, (t) => t.exchange),
    direction: bucketize(trades, (t) => t.direction),
    strategy: bucketize(trades, (t) => journal?.get(t.tradeKey)?.strategy || "Unassigned").sort((a, b) => b.netPnl - a.netPnl),
  };
}

export function histogram(trades: ClosedTrade[], bins = 12) {
  if (!trades.length) return [];
  const xs = trades.map((t) => t.netPnl);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const width = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({
    from: r2(lo + i * width),
    to: r2(lo + (i + 1) * width),
    count: 0,
  }));
  for (const x of xs) out[Math.min(bins - 1, Math.floor((x - lo) / width))].count++;
  return out;
}

/** Behaviour findings. Each finding lists its evidence (trade keys) and data coverage. */
export interface BehaviorFinding {
  id: string;
  title: string;
  status: "flag" | "ok" | "insufficient_data";
  detail: string;
  evidence: string[];
}

export function behaviorAnalysis(
  trades: ClosedTrade[],
  journal: Map<string, JournalEntry>,
  risk: RiskSettings,
  tz = DEFAULT_TZ
): BehaviorFinding[] {
  const out: BehaviorFinding[] = [];
  const journaled = trades.filter((t) => journal.has(t.tradeKey));

  // 1. trades outside plan
  const planKnown = journaled.filter((t) => journal.get(t.tradeKey)!.followedPlan != null);
  const outside = planKnown.filter((t) => journal.get(t.tradeKey)!.followedPlan === false);
  out.push(
    planKnown.length < 3
      ? { id: "outside_plan", title: "Trades outside the plan", status: "insufficient_data", detail: `Only ${planKnown.length} trades record whether the plan was followed.`, evidence: [] }
      : {
          id: "outside_plan",
          title: "Trades outside the plan",
          status: outside.length ? "flag" : "ok",
          detail: `${outside.length} of ${planKnown.length} journaled trades were marked as not following the plan (net ${fmt(sum(outside.map((t) => t.netPnl)))}).`,
          evidence: outside.map((t) => t.tradeKey),
        }
  );

  // 2. overtrading (objective: trade count per day vs configured limit)
  const perDay = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const d = localDate(t.entryAt, tz);
    if (!perDay.has(d)) perDay.set(d, []);
    perDay.get(d)!.push(t);
  }
  const heavy = [...perDay.entries()].filter(([, ts]) => ts.length > risk.maxTradesPerDay);
  out.push({
    id: "overtrading",
    title: "Trading frequency vs limit",
    status: trades.length === 0 ? "insufficient_data" : heavy.length ? "flag" : "ok",
    detail: heavy.length
      ? `${heavy.length} day(s) exceeded your limit of ${risk.maxTradesPerDay} trades/day: ${heavy.map(([d, ts]) => `${d} (${ts.length})`).join(", ")}.`
      : `No day exceeded your configured limit of ${risk.maxTradesPerDay} trades.`,
    evidence: heavy.flatMap(([, ts]) => ts.map((t) => t.tradeKey)),
  });

  // 3. stop-loss violations — requires recorded planned stop
  const withStop = trades.filter((t) => journal.get(t.tradeKey)?.plannedStop);
  const violations = withStop.filter((t) => {
    const s = journal.get(t.tradeKey)!.plannedStop!;
    return t.direction === "LONG" ? t.avgExit < s * 0.999 : t.avgExit > s * 1.001;
  });
  out.push(
    withStop.length < 3
      ? { id: "stop_violations", title: "Stop-loss adherence", status: "insufficient_data", detail: `Only ${withStop.length} trades have a recorded planned stop.`, evidence: [] }
      : {
          id: "stop_violations",
          title: "Stop-loss adherence",
          status: violations.length ? "flag" : "ok",
          detail: `${violations.length} of ${withStop.length} trades with a recorded stop exited beyond it (worse than planned).`,
          evidence: violations.map((t) => t.tradeKey),
        }
  );

  // 4. position sizing consistency (objective: coefficient of variation of entry value)
  if (trades.length >= 5) {
    const values = trades.map((t) => t.avgEntry * t.quantity);
    const m = mean(values);
    const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
    const cv = m ? sd / m : 0;
    const big = trades.filter((t) => t.avgEntry * t.quantity > m * 2);
    out.push({
      id: "sizing",
      title: "Position sizing consistency",
      status: cv > 0.75 ? "flag" : "ok",
      detail: `Entry value averages ${fmt(m)} with variation ${(cv * 100).toFixed(0)}%. ${big.length} trade(s) were over 2× your average size.`,
      evidence: big.map((t) => t.tradeKey),
    });
  } else {
    out.push({ id: "sizing", title: "Position sizing consistency", status: "insufficient_data", detail: "Need at least 5 closed trades.", evidence: [] });
  }

  // 5. performance after consecutive losses
  const ordered = [...trades].sort((a, b) => a.entryAt.localeCompare(b.entryAt));
  const after: ClosedTrade[] = [];
  let run = 0;
  for (const t of ordered) {
    if (run >= 2) after.push(t);
    if (t.outcome === "loss") run++;
    else if (t.outcome === "win") run = 0;
  }
  if (after.length >= 3) {
    const wr = (after.filter((t) => t.outcome === "win").length / after.length) * 100;
    const base = computeMetrics(trades).winRateInclBreakeven ?? 0;
    out.push({
      id: "after_losses",
      title: "Performance after 2+ consecutive losses",
      status: wr < base - 10 ? "flag" : "ok",
      detail: `${after.length} trades taken after 2+ losses: win rate ${wr.toFixed(0)}% vs overall ${base.toFixed(0)}%, net ${fmt(sum(after.map((t) => t.netPnl)))}.`,
      evidence: after.map((t) => t.tradeKey),
    });
  } else {
    out.push({ id: "after_losses", title: "Performance after 2+ consecutive losses", status: "insufficient_data", detail: `Only ${after.length} trades followed a losing streak.`, evidence: [] });
  }

  // 6. repeated mistakes (journal tags)
  const counts = new Map<string, string[]>();
  for (const t of journaled) for (const mk of journal.get(t.tradeKey)!.mistakes) {
    if (!counts.has(mk)) counts.set(mk, []);
    counts.get(mk)!.push(t.tradeKey);
  }
  const repeated = [...counts.entries()].filter(([, ks]) => ks.length >= 2).sort((a, b) => b[1].length - a[1].length);
  out.push({
    id: "repeated_mistakes",
    title: "Repeated mistakes (from your journal)",
    status: journaled.length === 0 ? "insufficient_data" : repeated.length ? "flag" : "ok",
    detail: repeated.length ? repeated.map(([m, ks]) => `${m} ×${ks.length}`).join(", ") : journaled.length ? "No mistake tag appears more than once." : "No journal entries yet.",
    evidence: repeated.flatMap(([, ks]) => ks),
  });
  return out;
}

export function fmt(n: number) {
  const s = Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}₹${s}`;
}
