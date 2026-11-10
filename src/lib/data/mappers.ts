import type { ClosedTrade, CostLine, JournalEntry, OpenPosition, RiskSettings } from "@/lib/engine/types";
import { DEFAULT_RISK, CALC_VERSION } from "@/lib/engine/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const n = (v: any) => (v == null ? null : Number(v));

export function rowToTrade(r: any, costs: CostLine[] = []): ClosedTrade {
  return {
    tradeKey: r.trade_key,
    calcVersion: r.calc_version,
    isDemo: r.is_demo,
    exchange: r.exchange,
    tradingsymbol: r.tradingsymbol,
    category: r.instrument_category ?? "unknown",
    product: r.product ?? "UNKNOWN",
    costProduct: "intraday",
    direction: r.direction,
    quantity: Number(r.quantity),
    avgEntry: Number(r.avg_entry),
    avgExit: Number(r.avg_exit),
    entryAt: new Date(r.entry_at).toISOString(),
    exitAt: new Date(r.exit_at).toISOString(),
    grossPnl: Number(r.gross_pnl),
    estCosts: Number(r.est_costs),
    verifiedCosts: n(r.verified_costs),
    netPnl: Number(r.net_pnl),
    costStatus: r.cost_status,
    costs,
    returnPct: Number(r.return_pct ?? 0),
    holdingSeconds: Number(r.holding_seconds),
    outcome: r.outcome,
    legs: [],
    executionIds: r.execution_ids ?? [],
  };
}

export function tradeToRow(t: ClosedTrade) {
  return {
    trade_key: t.tradeKey,
    is_demo: t.isDemo,
    exchange: t.exchange,
    tradingsymbol: t.tradingsymbol,
    instrument_category: t.category,
    product: t.product,
    direction: t.direction,
    quantity: t.quantity,
    avg_entry: t.avgEntry,
    avg_exit: t.avgExit,
    entry_at: t.entryAt,
    exit_at: t.exitAt,
    gross_pnl: t.grossPnl,
    est_costs: t.estCosts,
    verified_costs: t.verifiedCosts,
    net_pnl: t.netPnl,
    cost_status: t.costStatus,
    return_pct: t.returnPct,
    holding_seconds: t.holdingSeconds,
    outcome: t.outcome,
    execution_ids: t.executionIds,
  };
}

export function rowToPosition(r: any): OpenPosition {
  return {
    exchange: r.exchange,
    tradingsymbol: r.tradingsymbol,
    product: r.product,
    direction: r.direction,
    openQuantity: Number(r.open_quantity),
    avgCost: Number(r.avg_cost),
    openedAt: r.opened_at,
    realizedSoFar: 0,
    legs: [],
  };
}

export function rowToJournal(r: any): JournalEntry {
  return {
    tradeKey: r.trade_key,
    strategy: r.trade_strategies?.name ?? null,
    entryRationale: r.entry_rationale,
    exitRationale: r.exit_rationale,
    plannedStop: n(r.planned_stop),
    plannedTarget: n(r.planned_target),
    followedPlan: r.followed_plan,
    mistakes: r.mistakes ?? [],
    lessons: r.lessons,
    emotionalState: r.emotional_state,
    confidence: r.confidence,
    tags: r.tags ?? [],
    notes: r.notes,
    updatedAt: r.updated_at,
  };
}

export function rowToRisk(r: any | null): RiskSettings {
  if (!r) return DEFAULT_RISK;
  return {
    startingCapital: Number(r.starting_capital),
    maxRiskPerTradePct: Number(r.max_risk_per_trade_pct),
    maxDailyLoss: Number(r.max_daily_loss),
    maxWeeklyLoss: Number(r.max_weekly_loss),
    maxDrawdownPct: Number(r.max_drawdown_pct),
    maxTradesPerDay: Number(r.max_trades_per_day),
    preferredRR: Number(r.preferred_rr),
  };
}

export { CALC_VERSION };
