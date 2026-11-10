import { z } from "zod";
import { fail, json, withWorkspace } from "@/lib/api";
import { runCoach } from "@/lib/ai/coachService";

export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().trim().min(2).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12).default([]),
});

export async function POST(req: Request) {
  const r = await withWorkspace();
  if ("res" in r) return r.res;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail("Invalid question");
  const { ws } = r;
  const ans = await runCoach({ trades: ws.trades, journal: ws.journal, risk: ws.risk, tz: ws.tz, weekStart: ws.weekStart, now: new Date() }, b.data.question, b.data.history);
  return json(ans);
}
