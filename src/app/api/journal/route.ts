import { z } from "zod";
import { fail, json, requireUser } from "@/lib/api";

const money = z.number().finite().nonnegative().max(1e9).nullable();
const text = (n: number) => z.string().max(n).nullable();
const Entry = z.object({
  tradeKey: z.string().min(3).max(200),
  strategy: z.string().trim().max(80).nullable(),
  entryRationale: text(4000),
  exitRationale: text(4000),
  plannedStop: money,
  plannedTarget: money,
  followedPlan: z.boolean().nullable(),
  mistakes: z.array(z.string().max(60)).max(20),
  lessons: text(4000),
  emotionalState: z.string().max(40).nullable(),
  confidence: z.number().int().min(1).max(5).nullable(),
  tags: z.array(z.string().max(40)).max(20),
  notes: text(8000),
});

export async function POST(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const parsed = Entry.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const e = parsed.data;
  // trade must belong to the user (RLS restricts the select to own rows)
  const { data: trade } = await a.sb.from("closed_trades").select("id").eq("trade_key", e.tradeKey).limit(1).maybeSingle();
  if (!trade) return fail("Trade not found", 404);
  let strategyId: string | null = null;
  if (e.strategy) {
    const { data: s, error } = await a.sb.from("trade_strategies").upsert({ user_id: a.user.id, name: e.strategy }, { onConflict: "user_id,name" }).select("id").single();
    if (error) return fail(error.message, 500);
    strategyId = s.id;
  }
  const { error } = await a.sb.from("journal_entries").upsert(
    {
      user_id: a.user.id,
      trade_key: e.tradeKey,
      strategy_id: strategyId,
      entry_rationale: e.entryRationale,
      exit_rationale: e.exitRationale,
      planned_stop: e.plannedStop,
      planned_target: e.plannedTarget,
      followed_plan: e.followedPlan,
      mistakes: e.mistakes,
      lessons: e.lessons,
      emotional_state: e.emotionalState,
      confidence: e.confidence,
      tags: e.tags,
      notes: e.notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,trade_key" }
  );
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}
