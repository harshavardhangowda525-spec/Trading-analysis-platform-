import Link from "next/link";
import { getWorkspace } from "@/lib/data/workspace";
import { integrationStatus } from "@/lib/env";
import { db, isDbConfigured } from "@/lib/db";
import { MfaCard, PreferencesForm, SignOutButton } from "@/components/settings/SettingsForms";
import { Badge, PageTitle, Panel, PanelHeader, buttonClass } from "@/components/ui/primitives";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ws = await getWorkspace();
  const integ = integrationStatus();
  let dataMode: "live" | "demo" = ws.mode;
  if (ws.userId) {
    const [p] = await db()`select data_mode from user_preferences where user_id = ${ws.userId}`;
    dataMode = (p?.data_mode as "live" | "demo") ?? "live";
  }
  return (
    <>
      <PageTitle kicker="Account & security" title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Profile" />
          <div className="space-y-3 p-5 text-[13px]">
            {ws.userId ? (
              <>
                <p><span className="text-text-3">Signed in as</span> <span className="font-semibold">{ws.email}</span></p>
                <SignOutButton />
              </>
            ) : (
              <>
                <p className="text-text-2">You are exploring the synthetic demo without an account.</p>
                {isDbConfigured() && <Link href="/login" className={buttonClass("primary")}>Sign in or create account</Link>}
              </>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Two-factor authentication" subtitle="Protects access to your financial records" />
          <div className="p-5">{ws.userId ? <MfaCard /> : <p className="text-xs text-text-3">Sign in to enable MFA.</p>}</div>
        </Panel>
        {ws.userId && (
          <Panel className="lg:col-span-2">
            <PanelHeader title="Preferences" subtitle="Reporting week and timezone drive every calendar bucket" />
            <div className="p-5"><PreferencesForm tz={ws.tz} weekStart={ws.weekStart} dataMode={dataMode} /></div>
          </Panel>
        )}
        <Panel className="lg:col-span-2">
          <PanelHeader title="Server integrations" subtitle="Configured through environment variables — values are never shown" />
          <ul className="grid gap-2 p-5 text-[13px] sm:grid-cols-3">
            {[
              ["Neon Postgres (database & auth)", integ.database],
              ["Token encryption key", integ.encryption],
              ["Zerodha Kite Connect", integ.kite],
              ["Groq LLM", integ.groq],
              ["Email (Resend)", integ.email],
              ["Scheduled sync secret", integ.cron],
            ].map(([k, v]) => (
              <li key={k as string} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                <span className="text-text-2">{k}</span>
                <Badge tone={v ? "pos" : "neutral"}>{v ? "Configured" : "Not set"}</Badge>
              </li>
            ))}
          </ul>
          <p className="px-5 pb-5 text-[11px] text-text-3">TRADEOS operates in analytics-only mode. No order placement, modification or cancellation endpoints exist in this application.</p>
        </Panel>
      </div>
    </>
  );
}
