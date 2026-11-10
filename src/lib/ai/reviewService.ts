import "server-only";
import type { ClosedTrade, JournalEntry } from "@/lib/engine/types";
import { candlesForTrade } from "@/lib/market/candles";
import { buildReview, deterministicNarrative, REVIEW_SYSTEM_PROMPT, validateNarrative, type TradeReview } from "./review";
import { chat, llmAvailable } from "./groq";

export async function generateTradeReview(
  t: ClosedTrade,
  j: JournalEntry | null,
  history: ClosedTrade[],
  userId: string | null,
  maxTradesPerDay = 5
): Promise<TradeReview> {
  const c = await candlesForTrade(t, "15minute", userId);
  const base = buildReview(t, j, history, c.candles, c.source, maxTradesPerDay);
  if (c.reason) {
    const m = base.missingInformation.find((x) => x.key === "market");
    if (m) m.evidence = c.reason;
  }
  const fallback = deterministicNarrative(t, base);
  if (!llmAvailable()) return { ...base, narrative: fallback, narrativeSource: "deterministic", model: null };

  const payload = {
    trade: {
      symbol: t.tradingsymbol,
      direction: t.direction,
      quantity: t.quantity,
      avg_entry: t.avgEntry,
      avg_exit: t.avgExit,
      gross_pnl: t.grossPnl,
      net_pnl: t.netPnl,
      charges: t.verifiedCosts ?? t.estCosts,
      charges_status: t.costStatus,
      gross_return_pct: t.returnPct,
      outcome: t.outcome,
    },
    verified_facts: base.verifiedFacts.map((f) => f.text),
    possible_factors: base.possibleFactors.map((f) => f.text),
    missing_information: base.missingInformation.map((f) => f.text),
    market_data: c.source,
  };
  try {
    const { message, model } = await chat([
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(payload) },
    ]);
    const text = (message?.content ?? "").trim();
    const g = validateNarrative(text, payload);
    if (!text || !g.ok) return { ...base, narrative: fallback, narrativeSource: "deterministic", model };
    return { ...base, narrative: text, narrativeSource: "llm", model };
  } catch {
    return { ...base, narrative: fallback, narrativeSource: "deterministic", model: null };
  }
}
