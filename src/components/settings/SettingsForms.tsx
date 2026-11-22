"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";

export function PreferencesForm({ tz, weekStart, dataMode }: { tz: string; weekStart: number; dataMode: "live" | "demo" }) {
  const [s, setS] = useState({ timezone: tz, week_start: weekStart, data_mode: dataMode });
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const zones = (() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["Asia/Kolkata", "UTC"];
    }
  })();
  const save = async () => {
    setState("saving");
    setErr(null);
    const res = await fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    if (res.ok) {
      setState("saved");
      router.refresh();
    } else {
      setState("idle");
      setErr((await res.json().catch(() => ({}))).error ?? "Save failed");
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <Label>Reporting timezone</Label>
          <Select value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })}>{zones.map((z) => <option key={z}>{z}</option>)}</Select>
        </label>
        <label className="block">
          <Label>Week starts on</Label>
          <Select value={s.week_start} onChange={(e) => setS({ ...s, week_start: Number(e.target.value) })}>
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
            <option value={6}>Saturday</option>
          </Select>
        </label>
        <label className="block">
          <Label>Data source</Label>
          <Select value={s.data_mode} onChange={(e) => setS({ ...s, data_mode: e.target.value as "live" | "demo" })}>
            <option value="live">My real records</option>
            <option value="demo">Synthetic demo dataset</option>
          </Select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={state === "saving"}>{state === "saving" ? <Loader2 className="size-4 animate-spin" /> : state === "saved" ? <Check className="size-4" /> : null}{state === "saved" ? "Saved" : "Save preferences"}</Button>
        {err && <span className="text-xs text-neg">{err}</span>}
      </div>
      <p className="text-[11px] text-text-3">Demo data is never written to your account; switching only changes what is displayed.</p>
    </div>
  );
}

export function MfaCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enroll, setEnroll] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async (body: object) => {
    const res = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "Request failed");
    return d;
  };
  useEffect(() => {
    fetch("/api/auth/mfa").then((r) => r.json()).then((d) => setEnabled(!!d.enabled)).catch(() => setEnabled(false));
  }, []);

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setEnroll(await post({ action: "enroll" }));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const confirmCode = async () => {
    setBusy(true);
    try {
      await post({ action: "confirm", code });
      setEnroll(null);
      setCode("");
      setEnabled(true);
      setMsg("Two-factor authentication enabled.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    const c = prompt("Enter a current 6-digit code to disable two-factor authentication");
    if (!c) return;
    try {
      await post({ action: "disable", code: c.trim() });
      setEnabled(false);
      setMsg("Two-factor authentication disabled.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-brass" />
        <span className="text-[13px] font-semibold">Authenticator app (TOTP)</span>
        {enabled != null && <Badge tone={enabled ? "pos" : "warn"}>{enabled ? "Enabled" : "Not enabled"}</Badge>}
      </div>
      {enabled && (
        <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-xs">
          <span className="flex items-center gap-2"><Smartphone className="size-3.5" />Authenticator app</span>
          <button onClick={disable} className="text-neg hover:underline">Disable</button>
        </div>
      )}
      {enabled === false && !enroll && <Button onClick={start} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}Enable two-factor authentication</Button>}
      {enroll && (
        <div className="space-y-3 rounded-xl border border-line-2 p-4">
          <p className="text-xs text-text-2">Scan with Google Authenticator, 1Password, Authy or similar, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="TOTP QR code" className="size-40 rounded-lg bg-white p-2" />
          <p className="num break-all text-[11px] text-text-3">Secret: {enroll.secret}</p>
          <div className="flex gap-2">
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="max-w-40" />
            <Button variant="primary" onClick={confirmCode} disabled={code.length !== 6 || busy}>Verify</Button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-text-2" role="status">{msg}</p>}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="danger"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut className="size-4" /> Sign out
    </Button>
  );
}
