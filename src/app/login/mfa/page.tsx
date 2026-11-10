"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button, Input } from "@/components/ui/primitives";

export default function MfaPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const sb = createClient();
    const { data } = await sb.auth.mfa.listFactors();
    const f = data?.totp.find((x) => x.status === "verified");
    if (!f) {
      setBusy(false);
      return setErr("No authenticator is enrolled on this account.");
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    setBusy(false);
    if (error) return setErr(error.message);
    router.push("/");
    router.refresh();
  };
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={verify} className="glass w-full max-w-sm rounded-3xl p-7 text-center">
        <ShieldCheck className="mx-auto size-8 text-brass" />
        <h1 className="mt-3 text-xl font-bold">Two-factor verification</h1>
        <p className="mt-1 text-xs text-text-3">Enter the 6-digit code from your authenticator app.</p>
        <Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="num mt-5 text-center text-lg tracking-[0.4em]" aria-label="Authentication code" />
        <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" disabled={code.length !== 6 || busy}>{busy && <Loader2 className="size-4 animate-spin" />}Verify</Button>
        {err && <p className="mt-3 text-xs text-neg" role="alert">{err}</p>}
      </form>
    </div>
  );
}
