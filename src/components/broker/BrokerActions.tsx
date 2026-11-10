"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/primitives";

export function BrokerActions({ status, enabled, signedIn }: { status: string; enabled: boolean; signedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const connected = ["connected", "updated", "partial", "sync_failed", "synchronizing"].includes(status);

  const call = async (path: string, label: string) => {
    if (label === "disconnect" && !confirm("Disconnect Zerodha? Your imported history stays; the stored session token is destroyed.")) return;
    setBusy(label);
    setMsg(null);
    const res = await fetch(path, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(res.ok ? (label === "sync" ? `Sync ${d.status}${d.inserted != null ? ` · ${d.inserted} new fills, ${d.newTrades} trades closed` : ""}${d.message ? ` · ${d.message}` : ""}` : "Disconnected") : d.error ?? "Request failed");
    router.refresh();
  };

  if (!signedIn) return <p className="text-xs text-text-3">Sign in to connect a broker account.</p>;
  if (!enabled) return <p className="text-xs text-warn">The Zerodha integration is not configured on this server (KITE_API_KEY, KITE_API_SECRET, TOKEN_ENCRYPTION_KEY, SUPABASE_SERVICE_ROLE_KEY).</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {/* Plain navigation: the server redirects to the official kite.zerodha.com login */}
        <a href="/api/broker/zerodha/login" className={buttonClass(connected ? "outline" : "primary", "lg")}>
          <Link2 className="size-4" /> {connected || status === "reconnect_required" ? "Reconnect Zerodha" : "Connect Zerodha"}
        </a>
        {connected && (
          <>
            <Button size="lg" onClick={() => call("/api/broker/zerodha/sync", "sync")} disabled={!!busy}>
              {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync now
            </Button>
            <Button size="lg" variant="danger" onClick={() => call("/api/broker/zerodha/disconnect", "disconnect")} disabled={!!busy}>
              {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />} Disconnect
            </Button>
          </>
        )}
      </div>
      {msg && <p className="text-xs text-text-2" role="status">{msg}</p>}
    </div>
  );
}
