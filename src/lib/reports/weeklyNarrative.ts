import "server-only";
import type { WeeklyReport } from "@/lib/engine/weekly";
import { chat, llmAvailable } from "@/lib/ai/groq";
import { allowedNumbers, checkGrounding } from "@/lib/ai/grounding";

/** Optional LLM summary of a weekly report; rejected unless fully grounded. */
export async function weeklyNarrative(r: WeeklyReport): Promise<string | null> {
  if (!llmAvailable() || r.metrics.tradeCount === 0) return null;
  const payload = {
    week: `${r.weekStart} to ${r.weekEnd}`,
    trades: r.metrics.tradeCount,
    wins: r.metrics.wins,
    losses: r.metrics.losses,
    win_rate_pct: r.metrics.winRate == null ? null : +r.metrics.winRate.toFixed(1),
    net_pnl: r.metrics.netPnl,
    gross_pnl: r.metrics.grossPnl,
    charges: r.metrics.totalCosts,
    profit_factor: r.metrics.profitFactor,
    went_well: r.wentWell,
    went_wrong: r.wentWrong,
    repeated_mistakes: r.repeatedMistakes,
    improvement_areas: r.improvementAreas,
    journal_coverage_pct: r.journalCoverage,
  };
  try {
    const { message } = await chat(
      [
        { role: "system", content: "Summarise this weekly trading report in 3-4 sentences. Use only the JSON; restate numbers exactly; no new numbers; no predictions, promises or buy/sell advice. Plain text." },
        { role: "user", content: JSON.stringify(payload) },
      ],
      { maxTokens: 300 }
    );
    const text = (message?.content ?? "").trim();
    return text && checkGrounding(text, allowedNumbers(payload)).ok ? text : null;
  } catch {
    return null;
  }
}
