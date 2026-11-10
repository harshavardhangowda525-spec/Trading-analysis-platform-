/**
 * Core domain types for the deterministic TRADEOS accounting engine.
 * All money values are in INR. Times are ISO-8601 strings (UTC instants).
 */

export const CALC_VERSION = "fifo-v1";

export type Side = "BUY" | "SELL";
export type Direction = "LONG" | "SHORT";
export type Product = "MIS" | "CNC" | "NRML" | "UNKNOWN";
export type InstrumentCategory = "stock" | "etf" | "index" | "derivative" | "unknown";
export type ExecutionSource = "kite_api" | "csv" | "demo";

/** A single broker fill. Original records are preserved; never mutated by the engine. */
export interface Execution {
  id: string; // stable id (db uuid or `${exchange}:${trade_id}`)
  brokerTradeId: string;
  brokerOrderId: string | null;
  exchange: string; // NSE | BSE | NFO ...
  tradingsymbol: string;
  product: Product;
  side: Side;
  quantity: number;
  price: number;
  executedAt: string; // ISO
  source: ExecutionSource;
  isDemo: boolean;
}

export type CostComponent =
  | "brokerage"
  | "stt"
  | "exchange_txn"
  | "sebi"
  | "gst"
  | "stamp_duty"
  | "dp"
  | "other";

export interface CostLine {
  component: CostComponent;
  amount: number;
  source: "estimated" | "verified";
}

/** A fill (or a slice of a fill) that participates in a trade. */
export interface TradeLeg {
  executionId: string;
  brokerOrderId: string | null;
  side: Side;
  quantity: number;
  price: number;
  executedAt: string;
  role: "entry" | "exit";
}

export type Outcome = "win" | "loss" | "breakeven";

/**
 * A round trip: position goes flat -> non-zero -> flat for one instrument/product.
 * Supports scaling in/out, partial fills and multiple entries/exits.
 */
export interface ClosedTrade {
  tradeKey: string;
  calcVersion: string;
  isDemo: boolean;
  exchange: string;
  tradingsymbol: string;
  category: InstrumentCategory;
  product: Product;
  /** Product used for cost estimation (UNKNOWN resolved by same-day rule). */
  costProduct: "intraday" | "delivery";
  direction: Direction;
  quantity: number; // total entry quantity
  avgEntry: number;
  avgExit: number;
  entryAt: string;
  exitAt: string;
  grossPnl: number;
  estCosts: number;
  verifiedCosts: number | null;
  netPnl: number;
  costStatus: "estimated" | "verified";
  costs: CostLine[];
  returnPct: number; // gross return on entry value, %
  holdingSeconds: number;
  outcome: Outcome;
  legs: TradeLeg[];
  executionIds: string[];
}

export interface OpenPosition {
  exchange: string;
  tradingsymbol: string;
  product: Product;
  direction: Direction;
  openQuantity: number;
  avgCost: number;
  openedAt: string;
  /** Realized gross P&L from partial exits of the still-open round trip. */
  realizedSoFar: number;
  legs: TradeLeg[];
}

export interface ReconstructionResult {
  closedTrades: ClosedTrade[];
  openPositions: OpenPosition[];
  warnings: string[];
}

export interface JournalEntry {
  tradeKey: string;
  strategy: string | null;
  entryRationale: string | null;
  exitRationale: string | null;
  plannedStop: number | null;
  plannedTarget: number | null;
  followedPlan: boolean | null;
  mistakes: string[];
  lessons: string | null;
  emotionalState: string | null;
  confidence: number | null;
  tags: string[];
  notes: string | null;
  updatedAt?: string;
}

export interface RiskSettings {
  startingCapital: number;
  maxRiskPerTradePct: number;
  maxDailyLoss: number;
  maxWeeklyLoss: number;
  maxDrawdownPct: number;
  maxTradesPerDay: number;
  preferredRR: number;
}

export const DEFAULT_RISK: RiskSettings = {
  startingCapital: 100000,
  maxRiskPerTradePct: 1,
  maxDailyLoss: 2000,
  maxWeeklyLoss: 5000,
  maxDrawdownPct: 10,
  maxTradesPerDay: 5,
  preferredRR: 2,
};
