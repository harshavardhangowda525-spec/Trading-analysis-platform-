"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUp, BrainCircuit, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: { source: string; model: string | null; tools: { tool: string; period: string }[]; tradeIds: string[] };
}

const SUGGESTIONS = ["What was my win rate last week?", "Why did I lose money yesterday?", "Which strategy performed best this month?", "How much did I lose to transaction charges?", "Am I overtrading?", "What mistakes do I repeat?", "Show my worst five trades.", "Compare my last two weeks."];

export function Coach({ llm }: { llm: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [msgs, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setQ("");
    setBusy(true);
    try {
      const res = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history }) });
      const d = await res.json();
      setMsgs((m) => [...m, res.ok ? { role: "assistant", content: d.answer, meta: { source: d.source, model: d.model, tools: d.tools, tradeIds: d.tradeIds } } : { role: "assistant", content: d.error ?? "Something went wrong." }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Network error — please retry." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-[520px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-2 sm:px-5" aria-live="polite">
        {msgs.length === 0 && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl border border-brass/30 bg-brass/10"><BrainCircuit className="size-6 text-brass" /></div>
            <p className="text-sm font-semibold">Ask about your trading history</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-text-3">Every number comes from deterministic queries over your stored trades. {llm ? "The language model only explains the results." : "No LLM key configured — answers are composed deterministically."}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border border-line-2 px-3 py-1.5 text-xs text-text-2 hover:border-brass/40 hover:text-text">{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed", m.role === "user" ? "bg-brass/15 text-text" : "border border-line bg-white/[0.03]")}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.meta && (
                <div className="mt-2 space-y-1.5 border-t border-line pt-2 text-[10.5px] text-text-3">
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={m.meta.source === "llm" ? "warn" : "neutral"}>{m.meta.source === "llm" ? `Explained by ${m.meta.model}` : "Deterministic"}</Badge>
                    {m.meta.tools.map((t, k) => <Badge key={k} tone="signal">{t.tool}</Badge>)}
                  </div>
                  <p>Period: {[...new Set(m.meta.tools.map((t) => t.period))].join("; ")}</p>
                  {m.meta.tradeIds.length > 0 && (
                    <details>
                      <summary className="cursor-pointer">Source trades ({m.meta.tradeIds.length})</summary>
                      <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                        {m.meta.tradeIds.slice(0, 60).map((id) => <Link key={id} href={`/journal/${encodeURIComponent(id)}`} className="num rounded border border-line px-1.5 py-0.5 hover:text-text">{id.split(":")[1]}·{id.split(":").pop()?.slice(-6)}</Link>)}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {busy && <p className="flex items-center gap-2 text-xs text-text-3"><Loader2 className="size-3.5 animate-spin" /> Querying your records…</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-line-2 bg-black/30 p-1.5 focus-within:border-brass/40">
          <textarea value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); } }} rows={1} maxLength={1000} placeholder="e.g. How consistent is my risk management?" className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm placeholder:text-text-3 focus:outline-none" aria-label="Ask TRADEOS Coach" />
          <button type="submit" disabled={busy || !q.trim()} className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-[#ecd4a2] to-[#b48f5a] text-black disabled:opacity-40" aria-label="Send">
            <ArrowUp className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10.5px] text-text-3">Historical analysis and education only — no buy/sell signals.</p>
      </form>
    </div>
  );
}
