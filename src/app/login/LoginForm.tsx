"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function LoginForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const demo = async () => {
    setBusy(true);
    await fetch("/api/demo", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enabled) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Sign-in failed");
      router.push(d.mfaRequired ? "/login/mfa" : "/");
      router.refresh();
    } catch (err) {
      setMsg({ tone: "err", text: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="glass w-full max-w-md rounded-3xl p-6 sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight">Welcome to your trading lab</h1>
      <p className="mt-1 text-sm text-text-3">Sign in to analyse your real Zerodha history.</p>
      {enabled ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-line p-1" role="tablist">
            {(["signin", "signup"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setMsg(null); }} className={cn("h-9 rounded-lg text-xs font-semibold", mode === m ? "bg-white/[0.08] text-text" : "text-text-3")}>
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block">
              <Label>Email</Label>
              <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block">
              <Label hint={mode === "signup" ? "10+ characters, letters and a number" : undefined}>Password</Label>
              <Input type="password" required autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === "signup" ? 10 : 1} />
            </label>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            {msg && <p className={cn("text-xs", msg.tone === "ok" ? "text-pos" : "text-neg")} role="alert">{msg.text}</p>}
          </form>
        </>
      ) : (
        <p className="mt-6 rounded-xl border border-warn/25 bg-warn/[0.07] p-3 text-xs text-warn">The database is not configured on this deployment, so sign-in is disabled.</p>
      )}
      <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-text-3"><span className="hairline flex-1" />or<span className="hairline flex-1" /></div>
      <Button size="lg" className="w-full" onClick={demo} disabled={busy}><FlaskConical className="size-4" /> Explore the synthetic demo</Button>
      <p className="mt-4 text-center text-[11px] leading-relaxed text-text-3">Your Zerodha credentials are never entered here. Broker access uses the official Kite Connect login after you sign in.</p>
    </motion.div>
  );
}
