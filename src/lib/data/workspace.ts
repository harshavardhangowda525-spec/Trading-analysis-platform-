import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { generateDemoExecutions, demoJournalFor } from "@/lib/demo/generate";
import { reconstruct } from "@/lib/engine/reconstruct";
import { localDate } from "@/lib/engine/time";
import { CALC_VERSION, DEFAULT_RISK, type ClosedTrade, type CostLine, type JournalEntry, type OpenPosition, type RiskSettings } from "@/lib/engine/types";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
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
    href: `/journal/${encodeURIComponent(t.tradeKey)}`,
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
  const sb = await createClient();
  const [tradesQ, costsQ, journalQ, posQ, riskQ, prefsQ, connQ, notifQ, stratQ, batchQ, syncQ, execCountQ] = await Promise.all([
    sb.from("closed_trades").select("*").eq("calc_version", CALC_VERSION).eq("is_demo", false).order("exit_at", { ascending: true }).limit(20000),
    sb.from("trade_costs").select("closed_trade_id, component, amount, source").limit(100000),
    sb.from("journal_entries").select("*, trade_strategies(name)").limit(20000),
    sb.from("reconstructed_positions").select("*").eq("calc_version", CALC_VERSION),
    sb.from("risk_settings").select("*").maybeSingle(),
    sb.from("user_preferences").select("*").maybeSingle(),
    sb.from("broker_connections").select("*").eq("broker", "zerodha").maybeSingle(),
    sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(30),
    sb.from("trade_strategies").select("name").order("name"),
    sb.from("broker_import_batches").select("*").order("created_at", { ascending: false }).limit(10),
    sb.from("broker_sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("raw_executions").select("id", { count: "exact", head: true }).eq("is_demo", false),
  ]);
  const costsBy = new Map<string, CostLine[]>();
  for (const c of costsQ.data ?? []) {
    const arr = costsBy.get(c.closed_trade_id) ?? [];
    arr.push({ component: c.component, amount: Number(c.amount), source: c.source });
    costsBy.set(c.closed_trade_id, arr);
  }
  const trades = (tradesQ.data ?? []).map((r: any) => rowToTrade(r, costsBy.get(r.id) ?? []));
  const journal = new Map<string, JournalEntry>((journalQ.data ?? []).map((r: any) => [r.trade_key, rowToJournal(r)]));
  const c: any = connQ.data;
  const est = trades.filter((t) => t.costStatus === "estimated").length;
  const journalCoverage = trades.length ? Math.round((trades.filter((t) => journal.has(t.tradeKey)).length / trades.length) * 100) : 0;
  const warnings: string[] = [];
  if (est) warnings.push(`${est} trade(s) use estimated charges. Import contract notes to verify.`);
  if (c?.status === "reconnect_required") warnings.push("Zerodha session expired — reconnect to resume daily collection.");
  const lastSync: any = syncQ.data;
  if (lastSync?.status === "failed") warnings.push(`Last sync failed: ${lastSync.error ?? "unknown error"}`);
  const status: DataQuality["status"] = !trades.length && !(execCountQ.count ?? 0) ? "empty" : warnings.length ? (est === trades.length ? "awaiting_verification" : "partial") : "complete";

  return {
    mode: "live",
    userId,
    email,
    tz: (prefsQ.data as any)?.timezone ?? "Asia/Kolkata",
    weekStart: (prefsQ.data as any)?.week_start ?? 1,
    trades,
    openPositions: (posQ.data ?? []).map(rowToPosition),
    journal,
    risk: rowToRisk(riskQ.data),
    connection: {
      status: (c?.status as ConnectionStatus) ?? "disconnected",
      brokerUserId: c?.broker_user_id ?? null,
      brokerUserName: c?.broker_user_name ?? null,
      lastSyncedAt: c?.last_synced_at ?? null,
      lastError: c?.last_error ?? null,
      tokenExpiresAt: c?.token_expires_at ?? null,
    },
    notifications: (notifQ.data ?? []).map((n: any) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      createdAt: n.created_at,
      readAt: n.read_at,
      href: n.data?.href,
    })),
    strategies: (stratQ.data ?? []).map((s: any) => s.name),
    dashboardLayout: (prefsQ.data as any)?.dashboard_layout ?? [],
    dataQuality: {
      status,
      executions: execCountQ.count ?? 0,
      closedTrades: trades.length,
      openPositions: posQ.data?.length ?? 0,
      estimatedCostTrades: est,
      verifiedCostTrades: trades.length - est,
      journalCoverage,
      warnings,
      batches: (batchQ.data ?? []).map((b: any) => ({
        id: b.id,
        source: b.source,
        fileName: b.file_name,
        createdAt: b.created_at,
        inserted: b.inserted_count,
        duplicates: b.duplicate_count,
        errors: b.error_count,
        status: b.status,
      })),
      lastSync: lastSync ? { status: lastSync.status, startedAt: lastSync.started_at, error: lastSync.error } : null,
    },
  };
}

/** Resolve the current user's workspace. Cached per request. */
export const getWorkspace = cache(async (): Promise<Workspace> => {
  if (!isSupabaseConfigured()) return buildDemo();
  const store = await cookies();
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) {
    if (store.get(DEMO_COOKIE)?.value === "1") return buildDemo();
    throw new Error("UNAUTHENTICATED");
  }
  const { data: prefs } = await sb.from("user_preferences").select("data_mode").maybeSingle();
  if ((prefs as any)?.data_mode === "demo") {
    const demo = buildDemo();
    return { ...demo, userId: data.user.id, email: data.user.email ?? null };
  }
  return buildLive(data.user.id, data.user.email ?? null);
});

export function findTrade(ws: Workspace, key: string) {
  return ws.trades.find((t) => t.tradeKey === key) ?? null;
}
