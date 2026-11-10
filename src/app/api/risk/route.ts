import { z } from "zod";
import { fail, json, requireUser } from "@/lib/api";

const Body = z.object({
  startingCapital: z.number().positive().max(1e11),
  maxRiskPerTradePct: z.number().positive().max(100),
  maxDailyLoss: z.number().nonnegative().max(1e10),
  maxWeeklyLoss: z.number().nonnegative().max(1e10),
  maxDrawdownPct: z.number().positive().max(100),
  maxTradesPerDay: z.number().int().positive().max(1000),
  preferredRR: z.number().positive().max(100),
});

export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail(b.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const s = b.data;
  const { error } = await a.sb.from("risk_settings").upsert({
    user_id: a.user.id,
    starting_capital: s.startingCapital,
    max_risk_per_trade_pct: s.maxRiskPerTradePct,
    max_daily_loss: s.maxDailyLoss,
    max_weekly_loss: s.maxWeeklyLoss,
    max_drawdown_pct: s.maxDrawdownPct,
    max_trades_per_day: s.maxTradesPerDay,
    preferred_rr: s.preferredRR,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}
