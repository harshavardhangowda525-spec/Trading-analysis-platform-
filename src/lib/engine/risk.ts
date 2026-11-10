import type { ClosedTrade, JournalEntry, RiskSettings } from "./types";
import { calendarWeek, localDate, DEFAULT_TZ } from "./time";
import { computeMetrics, plannedRisk } from "./metrics";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RiskAlert {
  id: string;
  level: "info" | "warning" | "breach";
  message: string;
}

export interface RiskStatus {
  today: string;
  todayPnl: number;
  todayTrades: number;
  weekPnl: number;
  dailyBudgetRemaining: number;
  weeklyBudgetRemaining: number;
  currentDrawdownPct: number | null;
  maxDrawdownPct: number | null;
  largestLoss: number;
  consecutiveLosses: number;
  riskPerTrade: { tradeKey: string; riskPct: number; withinLimit: boolean }[];
  concentration: { symbol: string; sharePct: number }[];
  score: number; // 0-100 discipline score, deterministic
  scoreBreakdown: { label: string; points: number; max: number }[];
  alerts: RiskAlert[];
}

/** Informational only. Never places, modifies or cancels orders. */
export function riskStatus(
  trades: ClosedTrade[],
  journal: Map<string, JournalEntry>,
  s: RiskSettings,
  now = new Date(),
  tz = DEFAULT_TZ,
  weekStart = 1
): RiskStatus {
  const today = localDate(now, tz);
  const wk = calendarWeek(now, tz, weekStart);
  const todays = trades.filter((t) => localDate(t.exitAt, tz) === today);
  const weeks = trades.filter((t) => {
    const d = localDate(t.exitAt, tz);
    return d >= wk.start && d <= wk.end;
  });
  const todayPnl = r2(todays.reduce((a, t) => a + t.netPnl, 0));
  const weekPnl = r2(weeks.reduce((a, t) => a + t.netPnl, 0));
  const m = computeMetrics(trades, { tz, startingCapital: s.startingCapital, journal });

  const ordered = [...trades].sort((a, b) => a.exitAt.localeCompare(b.exitAt));
  let consec = 0;
  for (let i = ordered.length - 1; i >= 0 && ordered[i].outcome !== "win"; i--) if (ordered[i].outcome === "loss") consec++;

  let cum = 0;
  let peak = s.startingCapital;
  for (const t of ordered) {
    cum += t.netPnl;
    peak = Math.max(peak, s.startingCapital + cum);
  }
  const eq = s.startingCapital + cum;
  const currentDD = peak > 0 ? ((peak - eq) / peak) * 100 : null;

  const riskPerTrade = trades
    .map((t) => {
      const r = plannedRisk(t, journal.get(t.tradeKey));
      if (r == null) return null;
      const pct = (r / s.startingCapital) * 100;
      return { tradeKey: t.tradeKey, riskPct: Math.round(pct * 100) / 100, withinLimit: pct <= s.maxRiskPerTradePct };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const exposure = new Map<string, number>();
  let totalExp = 0;
  for (const t of trades) {
    const v = t.avgEntry * t.quantity;
    exposure.set(t.tradingsymbol, (exposure.get(t.tradingsymbol) ?? 0) + v);
    totalExp += v;
  }
  const concentration = [...exposure.entries()]
    .map(([symbol, v]) => ({ symbol, sharePct: totalExp ? Math.round((v / totalExp) * 1000) / 10 : 0 }))
    .sort((a, b) => b.sharePct - a.sharePct)
    .slice(0, 6);

  // Discipline score — transparent, rules-based
  const days = new Map<string, { pnl: number; n: number }>();
  for (const t of trades) {
    const d = localDate(t.exitAt, tz);
    const x = days.get(d) ?? { pnl: 0, n: 0 };
    x.pnl += t.netPnl;
    x.n++;
    days.set(d, x);
  }
  const dayArr = [...days.values()];
  const lossDaysOk = dayArr.length ? dayArr.filter((d) => d.pnl >= -s.maxDailyLoss).length / dayArr.length : 1;
  const freqOk = dayArr.length ? dayArr.filter((d) => d.n <= s.maxTradesPerDay).length / dayArr.length : 1;
  const sizingOk = riskPerTrade.length ? riskPerTrade.filter((r) => r.withinLimit).length / riskPerTrade.length : 0;
  const ddOk = m.maxDrawdownPct == null ? 1 : Math.max(0, 1 - m.maxDrawdownPct / (s.maxDrawdownPct * 2));
  const planCoverage = trades.length ? trades.filter((t) => journal.get(t.tradeKey)?.plannedStop).length / trades.length : 0;
  const scoreBreakdown = [
    { label: "Days within daily loss limit", points: Math.round(lossDaysOk * 30), max: 30 },
    { label: "Days within trade-count limit", points: Math.round(freqOk * 20), max: 20 },
    { label: "Trades within risk-per-trade limit", points: Math.round(sizingOk * 20), max: 20 },
    { label: "Drawdown control", points: Math.round(ddOk * 15), max: 15 },
    { label: "Trades with a recorded stop-loss", points: Math.round(planCoverage * 15), max: 15 },
  ];
  const score = scoreBreakdown.reduce((a, b) => a + b.points, 0);

  const alerts: RiskAlert[] = [];
  if (todayPnl <= -s.maxDailyLoss)
    alerts.push({ id: "daily", level: "breach", message: "You have exceeded your configured daily loss limit. Review your trades before continuing." });
  else if (todayPnl <= -0.75 * s.maxDailyLoss)
    alerts.push({ id: "daily-near", level: "warning", message: `You have used ${Math.round((-todayPnl / s.maxDailyLoss) * 100)}% of today's loss budget.` });
  if (weekPnl <= -s.maxWeeklyLoss)
    alerts.push({ id: "weekly", level: "breach", message: "You have exceeded your configured weekly loss limit for this calendar week." });
  if (todays.length > s.maxTradesPerDay)
    alerts.push({ id: "freq", level: "warning", message: `${todays.length} trades closed today — above your limit of ${s.maxTradesPerDay}.` });
  if (currentDD != null && currentDD >= s.maxDrawdownPct)
    alerts.push({ id: "dd", level: "breach", message: `Current drawdown ${currentDD.toFixed(1)}% is at or beyond your preferred maximum of ${s.maxDrawdownPct}%.` });
  if (consec >= 3) alerts.push({ id: "streak", level: "info", message: `${consec} consecutive losing trades. Consider pausing to review.` });

  return {
    today,
    todayPnl,
    todayTrades: todays.length,
    weekPnl,
    dailyBudgetRemaining: r2(s.maxDailyLoss + Math.min(0, todayPnl)),
    weeklyBudgetRemaining: r2(s.maxWeeklyLoss + Math.min(0, weekPnl)),
    currentDrawdownPct: currentDD == null ? null : Math.round(currentDD * 100) / 100,
    maxDrawdownPct: m.maxDrawdownPct,
    largestLoss: m.worstTrade && m.worstTrade.netPnl < 0 ? m.worstTrade.netPnl : 0,
    consecutiveLosses: consec,
    riskPerTrade,
    concentration,
    score,
    scoreBreakdown,
    alerts,
  };
}
