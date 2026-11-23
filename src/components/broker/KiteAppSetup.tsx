"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Badge, Button, Input, Label } from "@/components/ui/primitives";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <code className="num flex h-10 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-xl border border-line-2 bg-black/40 px-3 text-[12px]">{value}</code>
        <Button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

export function KiteAppSetup({ appUrl, configured, apiKeyHint, serverFallback }: { appUrl: string; configured: boolean; apiKeyHint: string | null; serverFallback: boolean }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(!configured && !serverFallback);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/broker/zerodha/app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, apiSecret }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: d.error ?? "Could not save" });
    setApiKey("");
    setApiSecret("");
    setEditing(false);
    setMsg({ ok: true, text: "Saved. Now click Connect Zerodha below." });
    router.refresh();
  };
  const remove = async () => {
    if (!confirm("Remove your Kite Connect app credentials? Your imported trades stay.")) return;
    await fetch("/api/broker/zerodha/app", { method: "DELETE" });
    setEditing(true);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-brass" />
        <span className="text-[13px] font-semibold">Your Kite Connect app</span>
        {configured ? <Badge tone="pos">Saved · {apiKeyHint}</Badge> : serverFallback ? <Badge tone="signal">Using server app</Badge> : <Badge tone="warn">Not set up</Badge>}
        {configured && !editing && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Replace</Button>
            <Button size="sm" variant="ghost" onClick={remove} aria-label="Remove app credentials"><Trash2 className="size-3.5" /></Button>
          </span>
        )}
      </div>

      {editing && (
        <>
          <ol className="space-y-2.5 rounded-xl border border-line bg-white/[0.02] p-4 text-[13px] leading-relaxed text-text-2">
            <li>
              <span className="font-semibold text-text">1.</span> Open{" "}
              <a href="https://developers.kite.trade/signup" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-signal underline underline-offset-2">
                developers.kite.trade <ExternalLink className="size-3" />
              </a>{" "}
              and sign in with your Zerodha account (this happens on Zerodha&apos;s site, never here).
            </li>
            <li>
              <span className="font-semibold text-text">2.</span> Create a new app and choose the <strong className="text-text">Personal</strong> type (free). It covers orders, trades, positions and holdings, which is everything TRADEOS needs to record your trades.
            </li>
            <li>
              <span className="font-semibold text-text">3.</span> Paste these two URLs into the app form:
            </li>
          </ol>
          <div className="grid gap-3">
            <CopyField label="Redirect URL" value={`${appUrl}/api/broker/zerodha/callback`} />
            <CopyField label="Postback URL (optional)" value={`${appUrl}/api/broker/zerodha/postback`} />
          </div>
          <p className="text-[13px] text-text-2"><span className="font-semibold text-text">4.</span> Save the app on Kite, then copy its API key and API secret here:</p>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <Label>API key</Label>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} required placeholder="e.g. abcd1234efgh5678" />
            </label>
            <label className="block">
              <Label>API secret</Label>
              <Input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" spellCheck={false} required />
            </label>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" variant="primary" disabled={busy || !apiKey || !apiSecret}>{busy && <Loader2 className="size-4 animate-spin" />}Save credentials</Button>
              {configured && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </form>
          <p className="text-[11px] leading-relaxed text-text-3">The secret is encrypted (AES-256-GCM) before it is stored and is only used on the server to exchange the login token. TRADEOS never asks for your Zerodha password, PIN or OTP.</p>
        </>
      )}
      {msg && <p className={msg.ok ? "text-xs text-pos" : "text-xs text-neg"} role="status">{msg.text}</p>}
    </div>
  );
}
