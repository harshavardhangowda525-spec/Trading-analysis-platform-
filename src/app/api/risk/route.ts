import { z } from "zod";
import { fail, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

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
  await db()`insert into risk_settings (user_id, starting_capital, max_risk_per_trade_pct, max_daily_loss, max_weekly_loss, max_drawdown_pct, max_trades_per_day, preferred_rr, updated_at)
             values (${a.user.userId}, ${s.startingCapital}, ${s.maxRiskPerTradePct}, ${s.maxDailyLoss}, ${s.maxWeeklyLoss}, ${s.maxDrawdownPct}, ${s.maxTradesPerDay}, ${s.preferredRR}, now())
             on conflict (user_id) do update set starting_capital = excluded.starting_capital, max_risk_per_trade_pct = excluded.max_risk_per_trade_pct,
               max_daily_loss = excluded.max_daily_loss, max_weekly_loss = excluded.max_weekly_loss, max_drawdown_pct = excluded.max_drawdown_pct,
               max_trades_per_day = excluded.max_trades_per_day, preferred_rr = excluded.preferred_rr, updated_at = now()`;
  return json({ ok: true });
}
