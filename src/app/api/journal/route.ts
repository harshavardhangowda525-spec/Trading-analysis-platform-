import { z } from "zod";
import { fail, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

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
  const uid = a.user.userId;
  const parsed = Entry.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const e = parsed.data;
  const q = db();
  const [trade] = await q`select id from closed_trades where user_id = ${uid} and trade_key = ${e.tradeKey} limit 1`;
  if (!trade) return fail("Trade not found", 404);
  let strategyId: string | null = null;
  if (e.strategy) {
    const [s] = await q`insert into trade_strategies (user_id, name) values (${uid}, ${e.strategy})
                        on conflict (user_id, name) do update set name = excluded.name returning id`;
    strategyId = s.id;
  }
  await q`insert into journal_entries (user_id, trade_key, strategy_id, entry_rationale, exit_rationale, planned_stop, planned_target, followed_plan,
            mistakes, lessons, emotional_state, confidence, tags, notes, updated_at)
          values (${uid}, ${e.tradeKey}, ${strategyId}, ${e.entryRationale}, ${e.exitRationale}, ${e.plannedStop}, ${e.plannedTarget}, ${e.followedPlan},
            ${e.mistakes}::text[], ${e.lessons}, ${e.emotionalState}, ${e.confidence}, ${e.tags}::text[], ${e.notes}, now())
          on conflict (user_id, trade_key) do update set strategy_id = excluded.strategy_id, entry_rationale = excluded.entry_rationale,
            exit_rationale = excluded.exit_rationale, planned_stop = excluded.planned_stop, planned_target = excluded.planned_target,
            followed_plan = excluded.followed_plan, mistakes = excluded.mistakes, lessons = excluded.lessons, emotional_state = excluded.emotional_state,
            confidence = excluded.confidence, tags = excluded.tags, notes = excluded.notes, updated_at = now()`;
  return json({ ok: true });
}
