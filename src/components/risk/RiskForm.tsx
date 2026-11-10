"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import type { RiskSettings } from "@/lib/engine/types";
import { Button, Input, Label } from "@/components/ui/primitives";

const FIELDS: { k: keyof RiskSettings; label: string; hint: string; step: string }[] = [
  { k: "startingCapital", label: "Starting capital", hint: "₹", step: "1000" },
  { k: "maxRiskPerTradePct", label: "Max risk per trade", hint: "% of capital", step: "0.1" },
  { k: "maxDailyLoss", label: "Max daily loss", hint: "₹", step: "100" },
  { k: "maxWeeklyLoss", label: "Max weekly loss", hint: "₹ (calendar week)", step: "100" },
  { k: "maxDrawdownPct", label: "Max preferred drawdown", hint: "%", step: "0.5" },
  { k: "maxTradesPerDay", label: "Max trades per day", hint: "count", step: "1" },
  { k: "preferredRR", label: "Preferred reward : risk", hint: "R", step: "0.1" },
];

export function RiskForm({ initial, mode }: { initial: RiskSettings; mode: "demo" | "live" }) {
  const [s, setS] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const save = async () => {
    if (mode === "demo") {
      setErr("Demo mode uses default risk settings. Sign in to save your own.");
      return;
    }
    setState("saving");
    const res = await fetch("/api/risk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    if (res.ok) {
      setState("saved");
      router.refresh();
    } else {
      setState("error");
      setErr((await res.json().catch(() => ({}))).error ?? "Save failed");
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.k} className="block">
            <Label hint={f.hint}>{f.label}</Label>
            <Input type="number" inputMode="decimal" min="0" step={f.step} value={s[f.k]} onChange={(e) => { setS({ ...s, [f.k]: Number(e.target.value) }); setState("idle"); }} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={state === "saving"}>
          {state === "saving" ? <Loader2 className="size-4 animate-spin" /> : state === "saved" ? <Check className="size-4" /> : null}
          {state === "saved" ? "Saved" : "Save limits"}
        </Button>
        {err && <p className="text-xs text-warn" role="alert">{err}</p>}
      </div>
      <p className="text-[11px] text-text-3">Limits drive informational alerts only. TRADEOS never places, modifies, cancels or liquidates positions.</p>
    </div>
  );
}
