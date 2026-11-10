"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, Check, HelpCircle, Lightbulb, Loader2, PencilLine, RefreshCw, X } from "lucide-react";
import type { ReviewItem, TradeReview } from "@/lib/ai/review";
import { Badge, Button, Provenance, Skeleton, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Verdict = { verdict: "accept" | "reject" | "correct"; correction?: string };

export function ReviewPanel({ tradeKey, mode }: { tradeKey: string; mode: "demo" | "live" }) {
  const [review, setReview] = useState<(TradeReview & { reviewId?: string | null; feedback?: Record<string, Verdict> }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fb, setFb] = useState<Record<string, Verdict>>({});

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(tradeKey)}${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Review unavailable");
      setReview(d);
      let local: Record<string, Verdict> = {};
      if (mode === "demo") {
        try {
          local = JSON.parse(localStorage.getItem(`tradeos.demo.fb.${tradeKey}`) ?? "{}");
        } catch {
          /* ignore */
        }
      }
      setFb({ ...(d.feedback ?? {}), ...local });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeKey]);

  const give = async (key: string, v: Verdict) => {
    const next = { ...fb, [key]: v };
    setFb(next);
    if (mode === "demo") {
      try {
        localStorage.setItem(`tradeos.demo.fb.${tradeKey}`, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return;
    }
    await fetch(`/api/reviews/${encodeURIComponent(tradeKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemKey: key, ...v }) });
  };

  if (loading)
    return (
      <div className="space-y-3" aria-busy>
        <p className="flex items-center gap-2 text-xs text-text-3"><Loader2 className="size-3.5 animate-spin" /> Generating evidence-based review…</p>
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
        <Skeleton className="h-20" />
      </div>
    );
  if (error || !review)
    return (
      <div className="rounded-xl border border-neg/25 bg-neg/[0.06] p-4 text-sm text-neg" role="alert">
        {error ?? "Review unavailable"} <Button size="sm" variant="ghost" onClick={() => load()}>Retry</Button>
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-brass/20 bg-gradient-to-b from-brass/[0.07] to-transparent p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Provenance kind="ai" />
          <Badge tone="neutral">{review.narrativeSource === "llm" ? `LLM · ${review.model}` : "Deterministic summary"}</Badge>
          {review.marketDataUsed === "synthetic_demo" && <Badge tone="warn">Synthetic candles</Badge>}
          {review.marketDataUsed === "none" && <Badge tone="neutral">No market data</Badge>}
          <button onClick={() => load(true)} className="ml-auto text-text-3 hover:text-text" aria-label="Regenerate review"><RefreshCw className="size-3.5" /></button>
        </div>
        <p className="text-[13.5px] leading-relaxed text-text">{review.narrative}</p>
        <p className="mt-2 text-[10.5px] text-text-3">Narrative is checked against the facts below; any unsupported number triggers the deterministic fallback.</p>
      </div>
      <Section icon={<BadgeCheck className="size-4 text-pos" />} title="Verified facts" note="Directly supported by executions and your records" items={review.verifiedFacts} />
      <Section icon={<HelpCircle className="size-4 text-warn" />} title="Possible contributing factors" note="Hypotheses — accept, reject or correct them" items={review.possibleFactors} feedback={fb} onFeedback={give} empty="No evidence-based factors identified." />
      <Section icon={<AlertTriangle className="size-4 text-text-2" />} title="Missing information" note="Needed to verify strategy compliance" items={review.missingInformation} empty="Nothing missing." />
      <Section icon={<Lightbulb className="size-4 text-brass" />} title="Improvement opportunities" note="Specific, testable process changes — not trade signals" items={review.improvements} feedback={fb} onFeedback={give} />
    </div>
  );
}

function Section({ icon, title, note, items, feedback, onFeedback, empty }: { icon: React.ReactNode; title: string; note: string; items: ReviewItem[]; feedback?: Record<string, Verdict>; onFeedback?: (k: string, v: Verdict) => void; empty?: string }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[13px] font-semibold">{icon}{title}</p>
      <p className="mb-2 mt-0.5 text-[11px] text-text-3">{note}</p>
      {items.length === 0 ? <p className="text-xs text-text-3">{empty}</p> : (
        <ul className="space-y-1.5">
          {items.map((it) => <Item key={it.key} it={it} v={feedback?.[it.key]} onFeedback={onFeedback} />)}
        </ul>
      )}
    </div>
  );
}

function Item({ it, v, onFeedback }: { it: ReviewItem; v?: Verdict; onFeedback?: (k: string, v: Verdict) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(v?.correction ?? "");
  return (
    <li className={cn("rounded-xl border border-line bg-white/[0.02] px-3 py-2.5", v?.verdict === "reject" && "opacity-60")}>
      <p className={cn("text-[13px] leading-relaxed", v?.verdict === "reject" && "line-through")}>{it.text}</p>
      {it.evidence && <p className="mt-1 text-[10.5px] text-text-3">Evidence: {it.evidence}</p>}
      {v?.verdict === "correct" && v.correction && <p className="mt-1.5 rounded-lg bg-brass/10 px-2 py-1 text-xs text-brass">Your correction: {v.correction}</p>}
      {onFeedback && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <FbBtn on={v?.verdict === "accept"} onClick={() => onFeedback(it.key, { verdict: "accept" })} icon={<Check className="size-3" />} label="Accept" />
          <FbBtn on={v?.verdict === "reject"} onClick={() => onFeedback(it.key, { verdict: "reject" })} icon={<X className="size-3" />} label="Reject" />
          <FbBtn on={v?.verdict === "correct"} onClick={() => setEditing((e) => !e)} icon={<PencilLine className="size-3" />} label="Correct" />
        </div>
      )}
      {editing && (
        <div className="mt-2 space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What actually happened?" maxLength={1000} className="min-h-[60px]" />
          <Button size="sm" variant="subtle" onClick={() => { onFeedback?.(it.key, { verdict: "correct", correction: text }); setEditing(false); }}>Save correction</Button>
        </div>
      )}
    </li>
  );
}

function FbBtn({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cn("inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium", on ? "border-brass/40 bg-brass/10 text-brass" : "border-line text-text-3 hover:text-text")}>
      {icon}{label}
    </button>
  );
}
