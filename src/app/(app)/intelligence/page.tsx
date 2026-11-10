import Link from "next/link";
import { BrainCircuit, MessageSquareText, ShieldAlert } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { filterTrades, parseRange } from "@/lib/data/range";
import { buildReview, deterministicNarrative } from "@/lib/ai/review";
import { llmAvailable } from "@/lib/ai/groq";
import { Coach } from "@/components/intelligence/Coach";
import { Badge, PageTitle, Panel, PanelHeader, Pnl, Provenance } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "AI Intelligence" };

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const trades = filterTrades(ws.trades, parseRange(sp.range), ws.tz, ws.weekStart);
  const losers = [...trades].filter((t) => t.outcome === "loss").sort((a, b) => b.exitAt.localeCompare(a.exitAt)).slice(0, 12);
  const llm = llmAvailable();

  return (
    <>
      <PageTitle kicker="TRADEOS Intelligence" title="AI Intelligence">
        <Badge tone={llm ? "pos" : "neutral"}>{llm ? "Groq LLM connected" : "Deterministic mode (no LLM key)"}</Badge>
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="flex flex-col lg:sticky lg:top-20 lg:col-span-3 lg:h-[calc(100dvh-140px)] lg:self-start">
          <PanelHeader icon={<MessageSquareText className="size-4" />} title="TRADEOS Coach" subtitle="Grounded in your stored trades — sources and periods shown for every answer" />
          <Coach llm={llm} />
        </Panel>
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <PanelHeader icon={<BrainCircuit className="size-4" />} title="Loss reviews" subtitle="Evidence-based reviews of your recent losing trades" />
            <ul className="space-y-2 px-3 pb-4 pt-2">
              {losers.length === 0 && <li className="px-2 text-xs text-text-3">No losing trades in this range.</li>}
              {losers.map((t) => {
                const r = buildReview(t, ws.journal.get(t.tradeKey) ?? null, ws.trades, null, "none", ws.risk.maxTradesPerDay);
                return (
                  <li key={t.tradeKey}>
                    <Link href={`/journal/${encodeURIComponent(t.tradeKey)}`} className="block rounded-xl border border-line bg-white/[0.02] p-3 hover:border-line-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold">{t.tradingsymbol} <span className="num text-[11px] font-normal text-text-3">{fmtDateTime(t.exitAt, ws.tz)}</span></span>
                        <Pnl value={t.netPnl} size="sm" />
                      </div>
                      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-text-2">{deterministicNarrative(t, r)}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge tone="pos">{r.verifiedFacts.length} facts</Badge>
                        <Badge tone="warn">{r.possibleFactors.length} hypotheses</Badge>
                        <Badge tone="neutral">{r.missingInformation.length} gaps</Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Panel className="p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold"><ShieldAlert className="size-4 text-brass" /> Integrity rules</p>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-text-2">
              <li>• Metrics are computed by deterministic code, never by the language model.</li>
              <li>• Reviews separate <Provenance kind="verified" /> facts from hypotheses and missing data.</li>
              <li>• Any LLM output containing a number not in the source data is discarded.</li>
              <li>• A losing trade is not assumed to be a bad trade. No future-profit promises or trade signals.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
