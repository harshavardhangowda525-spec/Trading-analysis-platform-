import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { isSupabaseConfigured } from "@/lib/env";
import { BottomDock, Sidebar } from "@/components/shell/Navigation";
import { TopBar } from "@/components/shell/TopBar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ws;
  try {
    ws = await getWorkspace();
  } catch (e) {
    if ((e as Error).message === "UNAUTHENTICATED") redirect("/login");
    throw e;
  }
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
        {ws.mode === "demo" && (
          <div className="border-b border-warn/20 bg-warn/[0.07] px-4 py-2 text-[12px] text-warn sm:px-6">
            <FlaskConical className="mr-1.5 inline size-3.5 -translate-y-px" aria-hidden />
            <strong>Demo mode — synthetic data.</strong> All trades shown are generated samples, isolated from real records.{" "}
            {isSupabaseConfigured() ? (
              <Link href={ws.userId ? "/settings" : "/login"} className="underline underline-offset-2">
                {ws.userId ? "Switch to live data" : "Sign in to use your real account"}
              </Link>
            ) : (
              <span>Configure Supabase to enable sign-in and live data.</span>
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
