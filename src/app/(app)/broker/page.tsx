import Link from "next/link";
import { KeyRound, Lock, PlugZap, ShieldCheck, Upload } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { integrationStatus, env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { BrokerActions } from "@/components/broker/BrokerActions";
import { CsvImport } from "@/components/broker/CsvImport";
import { STATUS_META } from "@/components/shell/nav";
import { Badge, PageTitle, Panel, PanelHeader } from "@/components/ui/primitives";
import { fmtDateTime, relTime } from "@/lib/utils";

export const metadata = { title: "Broker Connections" };

const ERRORS: Record<string, string> = {
  invalid_state: "Security check failed (state mismatch). Please start the connection again.",
  login_cancelled: "Zerodha login was cancelled.",
  missing_token: "Zerodha did not return a request token.",
  exchange_failed: "Could not complete the token exchange. Check the API key/secret and redirect URL.",
  kite_not_configured: "Zerodha integration is not configured on the server.",
};

export default async function BrokerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const integ = integrationStatus();
  const meta = STATUS_META[ws.connection.status] ?? STATUS_META.disconnected;
  let runs: { id: string; trigger: string; status: string; started_at: string; stats: Record<string, unknown>; error: string | null }[] = [];
  if (ws.mode === "live") {
    const sb = await createClient();
    const { data } = await sb.from("broker_sync_runs").select("id, trigger, status, started_at, stats, error").order("started_at", { ascending: false }).limit(10);
    runs = data ?? [];
  }
  const err = sp.error ? ERRORS[sp.error] ?? `Connection failed (${sp.error}).` : null;

  return (
    <>
      <PageTitle kicker="Official Kite Connect integration" title="Broker Connections" />
      {sp.connected && <div className="mb-4 rounded-2xl border border-pos/25 bg-pos/[0.07] p-3.5 text-[13px] text-pos" role="status">Zerodha connected. Initial synchronization has started.</div>}
      {err && <div className="mb-4 rounded-2xl border border-neg/25 bg-neg/[0.07] p-3.5 text-[13px] text-neg" role="alert">{err}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <PanelHeader icon={<PlugZap className="size-4" />} title="Zerodha · Kite Connect" subtitle="Mode A — live daily collection" action={<Badge tone={meta.tone}>{meta.label}</Badge>} />
            <div className="space-y-4 p-5">
              <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                <D k="Account" v={ws.connection.brokerUserId ? `${ws.connection.brokerUserId}${ws.connection.brokerUserName ? ` · ${ws.connection.brokerUserName}` : ""}` : "—"} />
                <D k="Last successful sync" v={ws.connection.lastSyncedAt ? `${relTime(ws.connection.lastSyncedAt)}` : "Never"} />
                <D k="Session expires" v={ws.connection.tokenExpiresAt ? fmtDateTime(ws.connection.tokenExpiresAt, ws.tz) : "—"} />
                <D k="Mode" v="Read-only analytics" />
              </dl>
              {ws.connection.lastError && <p className="rounded-xl border border-warn/25 bg-warn/[0.06] p-3 text-xs text-warn">{ws.connection.lastError}</p>}
              <BrokerActions status={ws.connection.status} enabled={integ.kite && integ.serviceRole} signedIn={ws.mode === "live"} />
              <div className="rounded-xl border border-line bg-white/[0.02] p-3.5 text-xs leading-relaxed text-text-2">
                <p className="mb-1 font-semibold text-text">How collection works</p>
                Kite&apos;s orders and trades endpoints only cover the <strong>current trading day</strong>. TRADEOS runs a scheduled sync after market close every weekday and stores each fill permanently, so your history grows day by day. Order postbacks trigger an extra reconciliation, but an order update is never treated as an execution. Zerodha sessions expire daily around 06:00 IST — reconnect through the official login when prompted. For older trades, import Console tradebooks below.
              </div>
            </div>
          </Panel>
          <Panel>
            <PanelHeader icon={<Upload className="size-4" />} title="Historical import" subtitle="Mode B — Zerodha Console tradebook or generic CSV. Re-importing the same file never duplicates fills." />
            <div className="p-5">
              <CsvImport enabled={ws.mode === "live"} />
              <details className="mt-4 text-xs text-text-2">
                <summary className="cursor-pointer font-semibold text-text">Supported formats</summary>
                <p className="mt-2">Zerodha Console tradebook header:</p>
                <code className="num mt-1 block overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px]">symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time</code>
                <p className="mt-2">Generic CSV header (timestamps without offset are IST):</p>
                <code className="num mt-1 block overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px]">symbol,side,quantity,price,executed_at,exchange,trade_id,order_id,product</code>
                <p className="mt-2 text-text-3">Console tradebooks do not include the product type; same-day round trips are treated as intraday for charge estimation. Sells of holdings bought before your import window are reported as warnings, not as trades.</p>
              </details>
            </div>
          </Panel>
          {ws.mode === "live" && (
            <Panel>
              <PanelHeader title="Synchronization history" />
              <ul className="divide-y divide-line px-5 pb-3">
                {runs.length === 0 && <li className="py-3 text-xs text-text-3">No sync runs yet.</li>}
                {runs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                    <span className="num text-text-2">{fmtDateTime(r.started_at, ws.tz)} · {r.trigger}</span>
                    <span className="flex items-center gap-2">
                      {r.stats?.inserted != null && <span className="num text-text-3">{String(r.stats.inserted)} new · {String(r.stats.duplicates ?? 0)} dup</span>}
                      <Badge tone={r.status === "succeeded" ? "pos" : r.status === "partial" ? "warn" : r.status === "running" ? "signal" : "neg"}>{r.status}</Badge>
                    </span>
                    {r.error && <span className="w-full text-neg">{r.error}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <div className="space-y-4">
          <Panel className="p-5">
            <p className="flex items-center gap-2 text-[13px] font-semibold"><ShieldCheck className="size-4 text-pos" /> Security guarantees</p>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-text-2">
              <li className="flex gap-2"><Lock className="mt-0.5 size-3.5 shrink-0 text-text-3" /> You log in on kite.zerodha.com. TRADEOS never asks for your Zerodha password, PIN or OTP.</li>
              <li className="flex gap-2"><KeyRound className="mt-0.5 size-3.5 shrink-0 text-text-3" /> The request token is exchanged server-side; the API secret and access token never reach your browser.</li>
              <li className="flex gap-2"><Lock className="mt-0.5 size-3.5 shrink-0 text-text-3" /> Access tokens are AES-256-GCM encrypted and stored in a table only the server can read.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-text-3" /> Kite has no read-only scope, so TRADEOS enforces read-only access in code: only profile, orders, trades, positions, holdings, instruments and historical endpoints are allowed. No order placement exists.</li>
            </ul>
          </Panel>
          <Panel className="p-5 text-xs text-text-2">
            <p className="mb-2 text-[13px] font-semibold text-text">Kite developer app settings</p>
            <p>Redirect URL:</p>
            <code className="num mt-1 block break-all rounded-lg bg-black/40 p-2 text-[11px]">{env.appUrl}/api/broker/zerodha/callback</code>
            <p className="mt-2">Postback URL (optional):</p>
            <code className="num mt-1 block break-all rounded-lg bg-black/40 p-2 text-[11px]">{env.appUrl}/api/broker/zerodha/postback</code>
            <p className="mt-3"><Link href="/data-quality" className="underline">View data-quality dashboard →</Link></p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function D({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-wider text-text-3">{k}</dt>
      <dd className="mt-0.5 font-medium">{v}</dd>
    </div>
  );
}
