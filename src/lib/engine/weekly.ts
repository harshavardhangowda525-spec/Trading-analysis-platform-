import type { ClosedTrade, JournalEntry } from "./types";
import { addDays, calendarWeek, localDate, DEFAULT_TZ } from "./time";
import { computeMetrics, type CoreMetrics } from "./metrics";

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  timezone: string;
  /** Always a CALENDAR week (weekStart..weekStart+6) in the user's timezone, never rolling 7 days. */
  kind: "calendar_week";
  metrics: CoreMetrics;
  tradeKeys: string[];
  mostUsedStrategy: { name: string; count: number } | null;
  bestStrategy: { name: string; netPnl: number; trades: number } | null;
  repeatedMistakes: { mistake: string; count: number }[];
  journalCoverage: number; // %
  stopCoverage: number; // %
  improvementAreas: string[];
  wentWell: string[];
  wentWrong: string[];
}

export function tradesInWeek(trades: ClosedTrade[], weekStart: string, tz = DEFAULT_TZ) {
  const end = addDays(weekStart, 6);
  return trades.filter((t) => {
    const d = localDate(t.exitAt, tz);
    return d >= weekStart && d <= end;
  });
}

export function buildWeeklyReport(
  all: ClosedTrade[],
  journal: Map<string, JournalEntry>,
  weekStart: string,
  tz = DEFAULT_TZ
): WeeklyReport {
  const trades = tradesInWeek(all, weekStart, tz);
  const metrics = computeMetrics(trades, { tz, journal });
  const strat = new Map<string, { count: number; pnl: number }>();
  const mistakes = new Map<string, number>();
  let journaled = 0;
  let withStop = 0;
  for (const t of trades) {
    const j = journal.get(t.tradeKey);
    if (!j) continue;
    journaled++;
    if (j.plannedStop) withStop++;
    if (j.strategy) {
      const s = strat.get(j.strategy) ?? { count: 0, pnl: 0 };
      s.count++;
      s.pnl += t.netPnl;
      strat.set(j.strategy, s);
    }
    for (const m of j.mistakes) mistakes.set(m, (mistakes.get(m) ?? 0) + 1);
  }
  const strats = [...strat.entries()];
  const most = strats.sort((a, b) => b[1].count - a[1].count)[0];
  const best = [...strat.entries()].sort((a, b) => b[1].pnl - a[1].pnl)[0];
  const repeated = [...mistakes.entries()].filter(([, c]) => c >= 2).map(([mistake, count]) => ({ mistake, count })).sort((a, b) => b.count - a.count);
  const journalCoverage = trades.length ? Math.round((journaled / trades.length) * 100) : 0;
  const stopCoverage = trades.length ? Math.round((withStop / trades.length) * 100) : 0;

  const wentWell: string[] = [];
  const wentWrong: string[] = [];
  const improvementAreas: string[] = [];
  if (metrics.netPnl > 0) wentWell.push(`Net realized P&L was positive (${metrics.netPnl.toFixed(2)}).`);
  if (metrics.profitFactor != null && metrics.profitFactor >= 1.5) wentWell.push(`Profit factor of ${metrics.profitFactor} — winners outweighed losers.`);
  if (best && best[1].pnl > 0) wentWell.push(`"${best[0]}" was your best recorded strategy (${best[1].count} trades).`);
  if (metrics.netPnl < 0) wentWrong.push(`Net realized P&L was negative (${metrics.netPnl.toFixed(2)}).`);
  if (metrics.avgWin != null && metrics.avgLoss != null && metrics.avgLoss > metrics.avgWin)
    wentWrong.push(`Average loss (${metrics.avgLoss.toFixed(2)}) exceeded average win (${metrics.avgWin.toFixed(2)}).`);
  for (const r of repeated) wentWrong.push(`Mistake "${r.mistake}" was recorded ${r.count} times.`);
  if (journalCoverage < 80) improvementAreas.push(`Journal coverage is ${journalCoverage}%. Record rationale for every trade to enable strategy verification.`);
  if (stopCoverage < 80) improvementAreas.push(`Only ${stopCoverage}% of trades have a planned stop recorded, so risk/reward cannot be verified for the rest.`);
  if (repeated[0]) improvementAreas.push(`Create a checklist item that targets "${repeated[0].mistake}".`);

  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    timezone: tz,
    kind: "calendar_week",
    metrics,
    tradeKeys: trades.map((t) => t.tradeKey),
    mostUsedStrategy: most ? { name: most[0], count: most[1].count } : null,
    bestStrategy: best ? { name: best[0], netPnl: Math.round(best[1].pnl * 100) / 100, trades: best[1].count } : null,
    repeatedMistakes: repeated,
    journalCoverage,
    stopCoverage,
    improvementAreas,
    wentWell,
    wentWrong,
  };
}

export function listWeeks(trades: ClosedTrade[], tz = DEFAULT_TZ, weekStart = 1): string[] {
  const s = new Set<string>();
  for (const t of trades) s.add(calendarWeek(t.exitAt, tz, weekStart).start);
  return [...s].sort().reverse();
}
