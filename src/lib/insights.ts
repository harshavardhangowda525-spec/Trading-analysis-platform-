import type { ClosedTrade, JournalEntry, RiskSettings } from "@/lib/engine/types";
import { behaviorAnalysis, breakdowns, computeMetrics, fmt } from "@/lib/engine/metrics";

export interface Insight {
  id: string;
  tone: "pos" | "neg" | "warn" | "neutral";
  title: string;
  body: string;
  evidence: string;
  href?: string;
}

/** Rule-based insights computed from records. No language model involved. */
export function buildInsights(trades: ClosedTrade[], journal: Map<string, JournalEntry>, risk: RiskSettings, tz: string): Insight[] {
  if (trades.length < 3) return [];
  const out: Insight[] = [];
  const m = computeMetrics(trades, { tz, journal });
  const b = breakdowns(trades, tz, 1, journal);

  const sessions = b.session.filter((s) => s.trades >= 5).sort((a, b2) => a.netPnl - b2.netPnl);
  if (sessions.length >= 2 && sessions[0].netPnl < 0)
    out.push({ id: "session", tone: "neg", title: `${sessions[0].label} session is your weakest`, body: `${sessions[0].trades} trades entered in the ${sessions[0].label.toLowerCase()} session netted ${fmt(sessions[0].netPnl)}, vs ${fmt(sessions[sessions.length - 1].netPnl)} in the ${sessions[sessions.length - 1].label.toLowerCase()} session.`, evidence: "Entry time (IST) × net P&L", href: "/analytics?tab=time" });

  const dow = b.dayOfWeek.filter((d) => d.trades >= 4).sort((a, c) => a.netPnl - c.netPnl);
  if (dow.length >= 3 && dow[0].netPnl < 0) out.push({ id: "dow", tone: "warn", title: `${dow[0].label} has cost you ${fmt(Math.abs(dow[0].netPnl))}`, body: `Win rate on ${dow[0].label} is ${dow[0].winRate?.toFixed(0) ?? "—"}% across ${dow[0].trades} trades.`, evidence: "Day of week × net P&L", href: "/analytics?tab=time" });

  if (m.grossPnl > 0 && m.totalCosts > 0.4 * m.grossPnl)
    out.push({ id: "costs", tone: "warn", title: "Charges are absorbing a large share of gross profit", body: `${fmt(m.totalCosts)} in ${m.costsAllVerified ? "verified" : "estimated"} charges vs ${fmt(m.grossPnl)} gross P&L (${((m.totalCosts / m.grossPnl) * 100).toFixed(0)}%).`, evidence: "Gross P&L vs charges" });

  if (m.avgWin != null && m.avgLoss != null && m.avgLoss > m.avgWin)
    out.push({ id: "payoff", tone: "neg", title: "Average loss exceeds average win", body: `Avg loss ${fmt(m.avgLoss)} vs avg win ${fmt(m.avgWin)} — with a ${m.winRate?.toFixed(0)}% win rate, this limits expectancy (${fmt(m.expectancy ?? 0)}/trade).`, evidence: "Closed-trade outcomes" });

  const top = b.symbol[0];
  if (top && top.netPnl > 0) out.push({ id: "top", tone: "pos", title: `${top.label} is your top contributor`, body: `${fmt(top.netPnl)} net over ${top.trades} trades (win rate ${top.winRate?.toFixed(0) ?? "—"}%).`, evidence: "Instrument contribution", href: "/analytics?tab=instruments" });

  for (const f of behaviorAnalysis(trades, journal, risk, tz).filter((x) => x.status === "flag").slice(0, 2))
    out.push({ id: f.id, tone: "warn", title: f.title, body: f.detail, evidence: `${f.evidence.length} trade(s) as evidence`, href: "/analytics?tab=behavior" });

  return out.slice(0, 5);
}
