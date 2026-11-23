import { Suspense } from "react";
import { redirect } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { FlaskConical, Link2 } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { claimJob, isDbConfigured } from "@/lib/db";
import { syncUser } from "@/lib/kite/sync";
import { zonedParts } from "@/lib/engine/time";
import { BottomDock, Sidebar } from "@/components/shell/Navigation";
import { TopBar } from "@/components/shell/TopBar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ws;
  try {
    ws = await getWorkspace();
  } catch (e) {
    if ((e as Error).message === "UNAUTHENTICATED") redirect("/login");
    if ((e as Error).message === "MFA_REQUIRED") redirect("/login/mfa");
    throw e;
  }
  // Auto-sync on visit (throttled to once per 10 minutes per user, trading hours only)
  const live = ws.mode === "live" && ws.userId;
  const syncable = live && ["connected", "updated", "partial"].includes(ws.connection.status);
  const istHour = zonedParts(new Date()).hour;
  if (syncable && istHour >= 9 && istHour <= 23) {
    const uid = ws.userId!;
    after(async () => {
      if (await claimJob(`autosync:${uid}`, 10)) await syncUser(uid, "manual").catch(() => undefined);
    });
  }
  const needsReconnect = live && ws.connection.status === "reconnect_required";

  return (
    <div className="flex min-h-dvh">
      <Suspense>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense>
          <TopBar
            mode={ws.mode}
            email={ws.email}
            connection={ws.connection}
            notifications={ws.notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt, readAt: n.readAt, href: n.href }))}
          />
        </Suspense>
        {needsReconnect && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-brass/25 bg-brass/[0.08] px-4 py-2.5 text-[12.5px] text-brass sm:px-6" role="status">
            <span><strong>Reconnect Zerodha for today.</strong> Zerodha logs API sessions out every morning at 06:00 IST, so your trades can&apos;t be recorded until you reconnect.</span>
            <a href="/api/broker/zerodha/login" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brass/90 px-3 text-xs font-semibold text-black hover:bg-brass"><Link2 className="size-3.5" />Reconnect</a>
          </div>
        )}
        {ws.mode === "demo" && (
          <div className="border-b border-warn/20 bg-warn/[0.07] px-4 py-2 text-[12px] text-warn sm:px-6">
            <FlaskConical className="mr-1.5 inline size-3.5 -translate-y-px" aria-hidden />
            <strong>Demo mode — synthetic data.</strong> All trades shown are generated samples, isolated from real records.{" "}
            {isDbConfigured() ? (
              <Link href={ws.userId ? "/settings" : "/login"} className="underline underline-offset-2">
                {ws.userId ? "Switch to live data" : "Sign in to use your real account"}
              </Link>
            ) : (
              <span>Configure DATABASE_URL to enable sign-in and live data.</span>
            )}
          </div>
        )}
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-32 pt-5 sm:px-6 lg:pb-12">{children}</main>
      </div>
      <Suspense>
        <BottomDock />
      </Suspense>
    </div>
  );
}
