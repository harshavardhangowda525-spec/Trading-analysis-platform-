/**
 * TRADEOS COACH — answers questions from the user's stored data.
 * All numbers come from deterministic tools below. The LLM (when configured) only
 * chooses tools and explains their validated output; answers are grounding-checked.
 */
import type { ClosedTrade, JournalEntry, RiskSettings } from "@/lib/engine/types";
import { behaviorAnalysis, breakdowns, computeMetrics, fmt } from "@/lib/engine/metrics";
import { addDays, calendarWeek, localDate, DEFAULT_TZ } from "@/lib/engine/time";
import type { ToolDef } from "./groq";

export const PERIODS = ["today", "yesterday", "this_week", "last_week", "week_before_last", "this_month", "last_month", "last_7_days", "last_30_days", "all"] as const;
export type Period = (typeof PERIODS)[number];

export interface CoachContext {
  trades: ClosedTrade[];
  journal: Map<string, JournalEntry>;
  risk: RiskSettings;
  tz: string;
  weekStart: number;
  now: Date;
}

export function resolvePeriod(p: Period, now = new Date(), tz = DEFAULT_TZ, weekStart = 1): { from: string | null; to: string; label: string } {
  const today = localDate(now, tz);
  const wk = calendarWeek(now, tz, weekStart);
  switch (p) {
    case "today":
      return { from: today, to: today, label: `today (${today})` };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y, label: `yesterday (${y})` };
    }
    case "this_week":
      return { from: wk.start, to: today, label: `this calendar week (${wk.start} to ${today})` };
    case "last_week": {
      const s = addDays(wk.start, -7);
      return { from: s, to: addDays(s, 6), label: `last calendar week (${s} to ${addDays(s, 6)})` };
    }
    case "week_before_last": {
      const s = addDays(wk.start, -14);
      return { from: s, to: addDays(s, 6), label: `the calendar week ${s} to ${addDays(s, 6)}` };
    }
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today, label: `this month (${today.slice(0, 7)})` };
    case "last_month": {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev, label: `last month (${lastPrev.slice(0, 7)})` };
    }
    case "last_7_days":
      return { from: addDays(today, -6), to: today, label: `the last 7 days (${addDays(today, -6)} to ${today})` };
    case "last_30_days":
      return { from: addDays(today, -29), to: today, label: `the last 30 days (${addDays(today, -29)} to ${today})` };
    default:
      return { from: null, to: today, label: "all recorded history" };
  }
}

function inPeriod(ctx: CoachContext, p: Period) {
  const b = resolvePeriod(p, ctx.now, ctx.tz, ctx.weekStart);
  return { ...b, trades: ctx.trades.filter((t) => { const d = localDate(t.exitAt, ctx.tz); return (!b.from || d >= b.from) && d <= b.to; }) };
}

const tradeRef = (t: ClosedTrade) => ({ trade_id: t.tradeKey, symbol: t.tradingsymbol, exit_date: localDate(t.exitAt), net_pnl: t.netPnl, gross_pnl: t.grossPnl, outcome: t.outcome });

export interface ToolResult {
  tool: string;
  period: string;
  tradeIds: string[];
  data: Record<string, unknown>;
  summary: string;
}

export function runTool(ctx: CoachContext, name: string, args: Record<string, unknown>): ToolResult {
  const period = (PERIODS.includes(args.period as Period) ? args.period : "all") as Period;
  switch (name) {
    case "get_performance": {
      const { trades, label } = inPeriod(ctx, period);
      const m = computeMetrics(trades, { tz: ctx.tz, journal: ctx.journal, startingCapital: ctx.risk.startingCapital });
      const data = {
        trades: m.tradeCount, wins: m.wins, losses: m.losses, breakevens: m.breakevens,
        win_rate_pct: m.winRate == null ? null : +m.winRate.toFixed(1), net_pnl: m.netPnl, gross_pnl: m.grossPnl, charges: m.totalCosts,
        profit_factor: m.profitFactor, profit_factor_note: m.profitFactorNote, expectancy: m.expectancy, max_drawdown: m.maxDrawdown,
        avg_win: m.avgWin, avg_loss: m.avgLoss,
      };
      const summary = m.tradeCount
        ? `For ${label}: ${m.tradeCount} closed trades (${m.wins} wins, ${m.losses} losses, ${m.breakevens} breakeven). Win rate ${data.win_rate_pct ?? "n/a"}% (breakevens excluded), net P&L ${fmt(m.netPnl)}, gross ${fmt(m.grossPnl)}, charges ${fmt(m.totalCosts)}, profit factor ${m.profitFactor ?? m.profitFactorNote}.`
        : `No closed trades were recorded for ${label}.`;
      return { tool: name, period: label, tradeIds: trades.map((t) => t.tradeKey), data, summary };
    }
    case "list_trades": {
      const { trades, label } = inPeriod(ctx, period);
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));
      const sort = args.sort === "best" ? "best" : args.sort === "recent" ? "recent" : "worst";
      let list = [...trades];
      if (args.outcome === "loss" || args.outcome === "win") list = list.filter((t) => t.outcome === args.outcome);
      list.sort((a, b) => (sort === "best" ? b.netPnl - a.netPnl : sort === "worst" ? a.netPnl - b.netPnl : b.exitAt.localeCompare(a.exitAt)));
      list = list.slice(0, limit);
      return {
        tool: name, period: label, tradeIds: list.map((t) => t.tradeKey), data: { trades: list.map(tradeRef) },
        summary: list.length ? `${sort === "recent" ? "Most recent" : sort === "best" ? "Best" : "Worst"} ${list.length} trade(s) for ${label}: ${list.map((t) => `${t.tradingsymbol} on ${localDate(t.exitAt)} (net ${fmt(t.netPnl)})`).join("; ")}.` : `No matching trades for ${label}.`,
      };
    }
    case "compare_periods": {
      const a = (PERIODS.includes(args.a as Period) ? args.a : "last_week") as Period;
      const b = (PERIODS.includes(args.b as Period) ? args.b : "week_before_last") as Period;
      const ra = runTool(ctx, "get_performance", { period: a });
      const rb = runTool(ctx, "get_performance", { period: b });
      return { tool: name, period: `${ra.period} vs ${rb.period}`, tradeIds: [...ra.tradeIds, ...rb.tradeIds], data: { a: ra.data, b: rb.data }, summary: `${ra.summary} Compared with ${rb.summary}` };
    }
    case "strategy_breakdown": {
      const { trades, label } = inPeriod(ctx, period);
      const s = breakdowns(trades, ctx.tz, ctx.weekStart, ctx.journal).strategy;
      const data = { strategies: s.map((x) => ({ name: x.label, trades: x.trades, net_pnl: x.netPnl, win_rate_pct: x.winRate == null ? null : +x.winRate.toFixed(1), profit_factor: x.profitFactor })) };
      const top = s.filter((x) => x.label !== "Unassigned")[0];
      return {
        tool: name, period: label, tradeIds: trades.map((t) => t.tradeKey), data,
        summary: top ? `For ${label}, the best recorded strategy by net P&L was "${top.label}" with ${top.trades} trades and net ${fmt(top.netPnl)}. ${s.find((x) => x.label === "Unassigned")?.trades ?? 0} trade(s) had no strategy assigned.` : `No trades with an assigned strategy for ${label}.`,
      };
    }
    case "cost_breakdown": {
      const { trades, label } = inPeriod(ctx, period);
      const by: Record<string, number> = {};
      for (const t of trades) for (const c of t.costs) by[c.component] = Math.round(((by[c.component] ?? 0) + c.amount) * 100) / 100;
      const total = Math.round(trades.reduce((a, t) => a + (t.verifiedCosts ?? t.estCosts), 0) * 100) / 100;
      const est = trades.filter((t) => t.costStatus === "estimated").length;
      return {
        tool: name, period: label, tradeIds: trades.map((t) => t.tradeKey), data: { total_charges: total, by_component: by, estimated_trades: est, trades: trades.length },
        summary: `For ${label}, charges totalled ${fmt(total)} across ${trades.length} trades${est ? ` (${est} with estimated charges — verify with contract notes)` : ""}.`,
      };
    }
    case "behavior_report": {
      const { trades, label } = inPeriod(ctx, period);
      const f = behaviorAnalysis(trades, ctx.journal, ctx.risk, ctx.tz);
      return {
        tool: name, period: label, tradeIds: [...new Set(f.flatMap((x) => x.evidence))], data: { findings: f.map((x) => ({ title: x.title, status: x.status, detail: x.detail })) },
        summary: `Behaviour review for ${label}: ` + f.map((x) => `${x.title} — ${x.status === "insufficient_data" ? "insufficient journal data" : x.status === "flag" ? "flagged" : "ok"}: ${x.detail}`).join(" "),
      };
    }
    default:
      return { tool: name, period: "", tradeIds: [], data: {}, summary: "Unknown tool." };
  }
}

const periodSchema = { type: "string", enum: [...PERIODS], description: "Calendar period in the user's timezone" };
export const COACH_TOOLS: ToolDef[] = [
  { type: "function", function: { name: "get_performance", description: "Win rate, P&L, charges, profit factor, expectancy and drawdown for a period", parameters: { type: "object", properties: { period: periodSchema }, required: ["period"] } } },
  { type: "function", function: { name: "list_trades", description: "List best, worst or recent trades", parameters: { type: "object", properties: { period: periodSchema, sort: { type: "string", enum: ["worst", "best", "recent"] }, limit: { type: "integer" }, outcome: { type: "string", enum: ["win", "loss", "any"] } }, required: ["period"] } } },
  { type: "function", function: { name: "compare_periods", description: "Compare performance of two periods", parameters: { type: "object", properties: { a: periodSchema, b: periodSchema }, required: ["a", "b"] } } },
  { type: "function", function: { name: "strategy_breakdown", description: "Performance by journal strategy", parameters: { type: "object", properties: { period: periodSchema }, required: ["period"] } } },
  { type: "function", function: { name: "cost_breakdown", description: "Brokerage and statutory charges for a period", parameters: { type: "object", properties: { period: periodSchema }, required: ["period"] } } },
  { type: "function", function: { name: "behavior_report", description: "Overtrading, plan adherence, stop-loss violations, sizing consistency, repeated mistakes", parameters: { type: "object", properties: { period: periodSchema }, required: ["period"] } } },
];

export const COACH_SYSTEM_PROMPT = `You are TRADEOS Coach. You analyse the user's HISTORICAL trading records for discipline and education.
- Always call tools to get numbers. Never invent trades, balances, prices or returns.
- Restate tool numbers exactly; do not do arithmetic yourself.
- State the calculation period. Mention when charges are estimated.
- For "why did I lose" questions, separate verified facts from possible factors and say what journal data is missing.
- Do not give buy/sell signals, price predictions, or promises of future profit.
- Be concise (under 150 words), plain text.`;

/** Deterministic intent router used when no LLM is configured (and as a fallback). */
export function routeQuestion(q: string): { name: string; args: Record<string, unknown> }[] {
  const s = q.toLowerCase();
  const period: Period =
    /yesterday/.test(s) ? "yesterday" : /today/.test(s) ? "today" : /last week|previous week/.test(s) ? "last_week" : /this week/.test(s) ? "this_week"
    : /last month/.test(s) ? "last_month" : /this month|month/.test(s) ? "this_month" : /7 days|seven days/.test(s) ? "last_7_days" : /30 days/.test(s) ? "last_30_days" : "all";
  if (/compare|vs|versus|last two weeks|last 2 weeks/.test(s)) return [{ name: "compare_periods", args: { a: "last_week", b: "week_before_last" } }];
  if (/worst|biggest loss|largest loss/.test(s)) return [{ name: "list_trades", args: { period, sort: "worst", limit: Number(s.match(/\b(\d{1,2})\b/)?.[1]) || 5 } }];
  if (/best trade|top trade/.test(s)) return [{ name: "list_trades", args: { period, sort: "best", limit: Number(s.match(/\b(\d{1,2})\b/)?.[1]) || 5 } }];
  if (/strateg/.test(s)) return [{ name: "strategy_breakdown", args: { period } }];
  if (/charge|brokerage|fee|cost|stt|tax/.test(s)) return [{ name: "cost_breakdown", args: { period } }];
  if (/overtrad|mistake|repeat|discipline|risk management|consisten|behavio/.test(s)) return [{ name: "behavior_report", args: { period } }];
  if (/why.*(lose|lost|loss)/.test(s)) return [{ name: "get_performance", args: { period } }, { name: "list_trades", args: { period, sort: "worst", limit: 3, outcome: "loss" } }, { name: "behavior_report", args: { period } }];
  return [{ name: "get_performance", args: { period } }];
}
