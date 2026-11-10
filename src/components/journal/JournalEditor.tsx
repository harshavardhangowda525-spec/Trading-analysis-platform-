"use client";
import { useEffect, useState } from "react";
import { Check, ImagePlus, Loader2, Save } from "lucide-react";
import type { JournalEntry } from "@/lib/engine/types";
import { Button, Input, Label, Provenance, Select, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const MISTAKES = ["Moved stop-loss", "FOMO entry", "Exited too early", "Oversized position", "Revenge trade", "Ignored plan", "Late entry", "No stop-loss"];
const EMOTIONS = ["Calm", "Focused", "Confident", "Anxious", "Impatient", "Frustrated", "Euphoric", "Tired"];

export function JournalEditor({ tradeKey, initial, strategies, mode, attachments }: { tradeKey: string; initial: JournalEntry | null; strategies: string[]; mode: "demo" | "live"; attachments: { path: string; url: string | null }[] }) {
  const storageKey = `tradeos.demo.journal.${tradeKey}`;
  const empty: JournalEntry = { tradeKey, strategy: null, entryRationale: null, exitRationale: null, plannedStop: null, plannedTarget: null, followedPlan: null, mistakes: [], lessons: null, emotionalState: null, confidence: null, tags: [], notes: null };
  const [j, setJ] = useState<JournalEntry>(initial ?? empty);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState(attachments);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (mode !== "demo") return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setJ(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [mode, storageKey]);

  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => {
    setJ((p) => ({ ...p, [k]: v }));
    setState("idle");
  };

  const save = async () => {
    setState("saving");
    setError(null);
    if (mode === "demo") {
      try {
        localStorage.setItem(storageKey, JSON.stringify(j));
      } catch {
        /* ignore */
      }
      setState("saved");
      return;
    }
    const res = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(j) });
    if (res.ok) setState("saved");
    else {
      setState("error");
      setError((await res.json().catch(() => ({}))).error ?? "Save failed");
    }
  };

  const upload = async (f: File) => {
    if (mode === "demo") {
      setFiles((x) => [...x, { path: f.name, url: URL.createObjectURL(f) }]);
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("tradeKey", tradeKey);
    const res = await fetch("/api/journal/attachments", { method: "POST", body: fd });
    setUploading(false);
    if (res.ok) {
      const d = await res.json();
      setFiles((x) => [...x, { path: d.path, url: d.url }]);
    } else setError((await res.json().catch(() => ({}))).error ?? "Upload failed");
  };

  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Provenance kind="user" />
        {mode === "demo" && <span className="text-[11px] text-text-3">Demo: saved in this browser only</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Strategy</Label>
          <Input list="strategies" value={j.strategy ?? ""} onChange={(e) => set("strategy", e.target.value || null)} placeholder="e.g. VWAP Pullback" maxLength={80} />
          <datalist id="strategies">{strategies.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="block">
          <Label>Followed plan?</Label>
          <Select value={j.followedPlan == null ? "" : j.followedPlan ? "yes" : "no"} onChange={(e) => set("followedPlan", e.target.value === "" ? null : e.target.value === "yes")}>
            <option value="">Not recorded</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </label>
        <label className="block">
          <Label hint="₹ per unit">Planned stop-loss</Label>
          <Input type="number" inputMode="decimal" step="0.05" min="0" value={j.plannedStop ?? ""} onChange={(e) => set("plannedStop", num(e.target.value))} />
        </label>
        <label className="block">
          <Label hint="₹ per unit">Planned target</Label>
          <Input type="number" inputMode="decimal" step="0.05" min="0" value={j.plannedTarget ?? ""} onChange={(e) => set("plannedTarget", num(e.target.value))} />
        </label>
      </div>
      <label className="block">
        <Label>Entry rationale</Label>
        <Textarea value={j.entryRationale ?? ""} onChange={(e) => set("entryRationale", e.target.value || null)} maxLength={4000} placeholder="Why did you enter? What was the setup?" />
      </label>
      <label className="block">
        <Label>Exit rationale</Label>
        <Textarea value={j.exitRationale ?? ""} onChange={(e) => set("exitRationale", e.target.value || null)} maxLength={4000} />
      </label>
      <div>
        <Label>Mistakes</Label>
        <div className="flex flex-wrap gap-1.5">
          {MISTAKES.map((m) => {
            const on = j.mistakes.includes(m);
            return (
              <button key={m} type="button" aria-pressed={on} onClick={() => set("mistakes", on ? j.mistakes.filter((x) => x !== m) : [...j.mistakes, m])} className={cn("h-8 rounded-full border px-3 text-xs font-medium", on ? "border-neg/40 bg-neg/10 text-neg" : "border-line-2 text-text-2")}>
                {on && <Check className="mr-1 inline size-3" />}
                {m}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Emotional state</Label>
          <Select value={j.emotionalState ?? ""} onChange={(e) => set("emotionalState", e.target.value || null)}>
            <option value="">Not recorded</option>
            {EMOTIONS.map((e) => <option key={e}>{e}</option>)}
          </Select>
        </label>
        <div>
          <Label>Confidence</Label>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Confidence 1 to 5">
            {[1, 2, 3, 4, 5].map((c) => (
              <button key={c} type="button" role="radio" aria-checked={j.confidence === c} onClick={() => set("confidence", j.confidence === c ? null : c)} className={cn("num h-10 flex-1 rounded-xl border text-sm font-semibold", j.confidence === c ? "border-brass/50 bg-brass/15 text-brass" : "border-line-2 text-text-3")}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="block">
        <Label>Lessons learned</Label>
        <Textarea value={j.lessons ?? ""} onChange={(e) => set("lessons", e.target.value || null)} maxLength={4000} />
      </label>
      <label className="block">
        <Label hint="comma separated">Tags</Label>
        <Input value={j.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20))} />
      </label>
      <label className="block">
        <Label>Personal notes</Label>
        <Textarea value={j.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} maxLength={8000} />
      </label>
      <div>
        <Label>Screenshots</Label>
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <a key={f.path} href={f.url ?? "#"} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-xl border border-line-2 bg-black/30">
              {f.url && (
                // eslint-disable-next-line @next/next/no-img-element -- signed/blob URLs, not optimisable
                <img src={f.url} alt="Trade screenshot" className="size-full object-cover" />
              )}
            </a>
          ))}
          <label className="grid size-20 cursor-pointer place-items-center rounded-xl border border-dashed border-line-2 text-text-3 hover:text-text">
            {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
            <span className="sr-only">Add screenshot</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      </div>
      <div className="sticky bottom-24 z-10 flex items-center gap-3 lg:static">
        <Button variant="primary" size="lg" onClick={save} disabled={state === "saving"} className="flex-1 sm:flex-none">
          {state === "saving" ? <Loader2 className="size-4 animate-spin" /> : state === "saved" ? <Check className="size-4" /> : <Save className="size-4" />}
          {state === "saved" ? "Saved" : "Save journal"}
        </Button>
        {error && <p className="text-xs text-neg" role="alert">{error}</p>}
      </div>
    </div>
  );
}
