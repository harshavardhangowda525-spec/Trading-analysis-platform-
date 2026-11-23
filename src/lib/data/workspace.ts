import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { generateDemoExecutions, demoJournalFor } from "@/lib/demo/generate";
import { reconstruct } from "@/lib/engine/reconstruct";
import { localDate } from "@/lib/engine/time";
import { CALC_VERSION, DEFAULT_RISK, type ClosedTrade, type CostLine, type JournalEntry, type OpenPosition, type RiskSettings } from "@/lib/engine/types";
import { db, iso, isDbConfigured } from "@/lib/db";
import { getSession, isFullyAuthenticated } from "@/lib/auth/session";
import { rowToJournal, rowToPosition, rowToRisk, rowToTrade } from "./mappers";

export type ConnectionStatus = "connected" | "synchronizing" | "updated" | "reconnect_required" | "partial" | "sync_failed" | "disconnected";

export interface Connection {
  status: ConnectionStatus;
  brokerUserId: string | null;
  brokerUserName: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  tokenExpiresAt: string | null;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
  href?: string;
}

export interface DataQuality {
  status: "complete" | "partial" | "awaiting_verification" | "empty";
  executions: number;
  closedTrades: number;
  openPositions: number;
  estimatedCostTrades: number;
  verifiedCostTrades: number;
  journalCoverage: number;
  warnings: string[];
  batches: { id: string; source: string; fileName: string | null; createdAt: string; inserted: number; duplicates: number; errors: number; status: string }[];
  lastSync: { status: string; startedAt: string; error: string | null } | null;
}

export interface Workspace {
  mode: "demo" | "live";
  userId: string | null;
  email: string | null;
  tz: string;
  weekStart: number;
  trades: ClosedTrade[];
  openPositions: OpenPosition[];
  journal: Map<string, JournalEntry>;
  risk: RiskSettings;
  connection: Connection;
  notifications: AppNotification[];
  strategies: string[];
  dashboardLayout: string[];
  dataQuality: DataQuality;
  setup: { kiteApp: boolean; totp: boolean; riskCustomized: boolean };
}

export const DEMO_COOKIE = "tradeos_demo";

const demoCache = new Map<string, Workspace>();

function buildDemo(): Workspace {
  const today = localDate(new Date());
  const hit = demoCache.get(today);
  if (hit) return hit;
  const executions = generateDemoExecutions(today);
  const { closedTrades, openPositions, warnings } = reconstruct(executions);
  const journal = new Map<string, JournalEntry>();
  for (const t of closedTrades) {
    const j = demoJournalFor(t.tradeKey, t);
    if (j) journal.set(t.tradeKey, j);
  }
  const recent = [...closedTrades].reverse().slice(0, 4);
  const notifications: AppNotification[] = recent.map((t) => ({
    id: `n-${t.tradeKey}`,
    type: "trade_closed",
    title: `Trade closed: ${t.tradingsymbol}`,
    body: `Gross P&L: ${t.grossPnl < 0 ? "−" : ""}₹${Math.abs(t.grossPnl).toFixed(2)}. AI review available.`,
    createdAt: t.exitAt,
    readAt: null,
    href: `/journal/trade?key=${encodeURIComponent(t.tradeKey)}`,
  }));
  notifications.push({ id: "n-demo", type: "weekly_report_ready", title: "Weekly report ready", body: "Your calendar-week report has been prepared.", createdAt: new Date().toISOString(), readAt: null, href: "/reports" });
  const ws: Workspace = {
    mode: "demo",
    userId: null,
    email: null,
    tz: "Asia/Kolkata",
    weekStart: 1,
    trades: closedTrades,
    openPositions,
    journal,
    risk: DEFAULT_RISK,
    connection: { status: "disconnected", brokerUserId: null, brokerUserName: null, lastSyncedAt: null, lastError: null, tokenExpiresAt: null },
    notifications,
    strategies: [...new Set([...journal.values()].map((j) => j.strategy).filter(Boolean) as string[])],
    dashboardLayout: [],
    setup: { kiteApp: false, totp: false, riskCustomized: false },
    dataQuality: {
      status: "partial",
      executions: executions.length,
      closedTrades: closedTrades.length,
      openPositions: openPositions.length,
      estimatedCostTrades: closedTrades.length,
      verifiedCostTrades: 0,
      journalCoverage: closedTrades.length ? Math.round((journal.size / closedTrades.length) * 100) : 0,
      warnings: ["Demo mode: all records are synthetic and isolated from real data.", "All charges are estimated (no contract notes imported).", ...warnings],
      batches: [{ id: "demo", source: "demo", fileName: "synthetic-dataset", createdAt: new Date().toISOString(), inserted: executions.length, duplicates: 0, errors: 0, status: "completed" }],
      lastSync: null,
    },
  };
  demoCache.clear();
  demoCache.set(today, ws);
  return ws;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function buildLive(userId: string, email: string | null): Promise<Workspace> {
  const q = db();
  const [tradesR, costsR, journalR, posR, riskR, prefsR, connR, notifR, stratR, batchR, syncR, execCountR, setupR] = await Promise.all([
    q`select * from closed_trades where user_id = ${userId} and calc_version = ${CALC_VERSION} and is_demo = false order by exit_at asc limit 20000`,
    q`select c.closed_trade_id, c.component, c.amount, c.source from trade_costs c where c.user_id = ${userId}`,
    q`select j.*, s.name as strategy_name from journal_entries j left join trade_strategies s on s.id = j.strategy_id where j.user_id = ${userId}`,
    q`select * from reconstructed_positions where user_id = ${userId} and calc_version = ${CALC_VERSION}`,
    q`select * from risk_settings where user_id = ${userId}`,
    q`select * from user_preferences where user_id = ${userId}`,
    q`select * from broker_connections where user_id = ${userId} and broker = 'zerodha'`,
    q`select * from notifications where user_id = ${userId} order by created_at desc limit 30`,
    q`select name from trade_strategies where user_id = ${userId} order by name`,
    q`select * from broker_import_batches where user_id = ${userId} order by created_at desc limit 10`,
    q`select * from broker_sync_runs where user_id = ${userId} order by started_at desc limit 1`,
    q`select count(*)::int as n from raw_executions where user_id = ${userId} and is_demo = false`,
    q`select u.totp_enabled, exists(select 1 from kite_apps k where k.user_id = u.id) as kite_app,
             coalesce((select r.updated_at > r_created.created_at + interval '1 second' from risk_settings r cross join (select created_at from users where id = ${userId}) r_created where r.user_id = ${userId}), false) as risk_customized
      from users u where u.id = ${userId}`,
  ]);
  const costsBy = new Map<string, CostLine[]>();
  for (const c of costsR as any[]) {
    const arr = costsBy.get(c.closed_trade_id) ?? [];
    arr.push({ component: c.component, amount: Number(c.amount), source: c.source });
    costsBy.set(c.closed_trade_id, arr);
  }
  const trades = (tradesR as any[]).map((r) => rowToTrade(r, costsBy.get(r.id) ?? []));
  const journal = new Map<string, JournalEntry>((journalR as any[]).map((r) => [r.trade_key, rowToJournal({ ...r, trade_strategies: r.strategy_name ? { name: r.strategy_name } : null })]));
  const c: any = connR[0];
  const prefs: any = prefsR[0];
  const execCount = (execCountR[0] as any)?.n ?? 0;
  const est = trades.filter((t) => t.costStatus === "estimated").length;
  const journalCoverage = trades.length ? Math.round((trades.filter((t) => journal.has(t.tradeKey)).length / trades.length) * 100) : 0;
  const warnings: string[] = [];
  if (est) warnings.push(`${est} trade(s) use estimated charges. Import contract notes to verify.`);
  if (c?.status === "reconnect_required") warnings.push("Zerodha session expired — reconnect to resume daily collection.");
  const lastSync: any = syncR[0];
  if (lastSync?.status === "failed") warnings.push(`Last sync failed: ${lastSync.error ?? "unknown error"}`);
  const status: DataQuality["status"] = !trades.length && !execCount ? "empty" : warnings.length ? (est === trades.length ? "awaiting_verification" : "partial") : "complete";

  return {
    mode: "live",
    userId,
    email,
    tz: prefs?.timezone ?? "Asia/Kolkata",
    weekStart: prefs?.week_start ?? 1,
    trades,
    openPositions: (posR as any[]).map((p) => rowToPosition({ ...p, opened_at: iso(p.opened_at) })),
    journal,
    risk: rowToRisk(riskR[0] ?? null),
    connection: {
      // A stored session past Zerodha's daily 06:00 IST logout is shown as "reconnect required"
      status: (c && ["connected", "updated", "partial", "synchronizing"].includes(c.status) && c.token_expires_at && new Date(c.token_expires_at).getTime() < Date.now()
        ? "reconnect_required"
        : (c?.status as ConnectionStatus)) ?? "disconnected",
      brokerUserId: c?.broker_user_id ?? null,
      brokerUserName: c?.broker_user_name ?? null,
      lastSyncedAt: iso(c?.last_synced_at),
      lastError: c?.last_error ?? null,
      tokenExpiresAt: iso(c?.token_expires_at),
    },
    notifications: (notifR as any[]).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, createdAt: iso(n.created_at)!, readAt: iso(n.read_at), href: n.data?.href })),
    strategies: (stratR as any[]).map((x) => x.name),
    dashboardLayout: prefs?.dashboard_layout ?? [],
    setup: {
      kiteApp: Boolean((setupR[0] as any)?.kite_app) || Boolean(process.env.KITE_API_KEY && process.env.KITE_API_SECRET),
      totp: Boolean((setupR[0] as any)?.totp_enabled),
      riskCustomized: Boolean((setupR[0] as any)?.risk_customized),
    },
    dataQuality: {
      status,
      executions: execCount,
      closedTrades: trades.length,
      openPositions: posR.length,
      estimatedCostTrades: est,
      verifiedCostTrades: trades.length - est,
      journalCoverage,
      warnings,
      batches: (batchR as any[]).map((b) => ({ id: b.id, source: b.source, fileName: b.file_name, createdAt: iso(b.created_at)!, inserted: b.inserted_count, duplicates: b.duplicate_count, errors: b.error_count, status: b.status })),
      lastSync: lastSync ? { status: lastSync.status, startedAt: iso(lastSync.started_at)!, error: lastSync.error } : null,
    },
  };
}

/** Resolve the current user's workspace. Cached per request. */
export const getWorkspace = cache(async (): Promise<Workspace> => {
  if (!isDbConfigured()) return buildDemo();
  const session = await getSession();
  if (session && !isFullyAuthenticated(session)) throw new Error("MFA_REQUIRED");
  if (!session) {
    if ((await cookies()).get(DEMO_COOKIE)?.value === "1") return buildDemo();
    throw new Error("UNAUTHENTICATED");
  }
  const prefs = await db()`select data_mode from user_preferences where user_id = ${session.userId}`;
  if ((prefs[0] as { data_mode?: string } | undefined)?.data_mode === "demo") return { ...buildDemo(), userId: session.userId, email: session.email };
  return buildLive(session.userId, session.email);
});

export function findTrade(ws: Workspace, key: string) {
  return ws.trades.find((t) => t.tradeKey === key) ?? null;
}
