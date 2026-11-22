import { z } from "zod";
import { fail, json, withWorkspace } from "@/lib/api";
import { generateTradeReview } from "@/lib/ai/reviewService";
import type { TradeReview } from "@/lib/ai/review";
import { findTrade } from "@/lib/data/workspace";
import { db } from "@/lib/db";
import { notify } from "@/lib/data/pipeline";

export const dynamic = "force-dynamic";
const demoCache = new Map<string, TradeReview>();

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const r = await withWorkspace();
  if ("res" in r) return r.res;
  const { ws } = r;
  const key = decodeURIComponent((await params).key);
  const t = findTrade(ws, key);
  if (!t) return fail("Trade not found", 404);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const j = ws.journal.get(key) ?? null;

  if (ws.mode === "demo") {
    const ck = `${key}|${JSON.stringify(j)}`;
    if (!refresh && demoCache.has(ck)) return json(demoCache.get(ck));
    const review = await generateTradeReview(t, j, ws.trades, null, ws.risk.maxTradesPerDay);
    demoCache.set(ck, review);
    return json(review);
  }

  const q = db();
  const uid = ws.userId!;
  const [row] = await q`select * from ai_trade_reviews where user_id = ${uid} and trade_key = ${key}`;
  const fbRows = row ? await q`select item_key, verdict, correction from ai_review_feedback where user_id = ${uid} and review_id = ${row.id}` : [];
  const feedback = Object.fromEntries(fbRows.map((f) => [f.item_key, { verdict: f.verdict, correction: f.correction }]));
  const stale = row && j?.updatedAt && Date.parse(j.updatedAt) > new Date(row.updated_at).getTime();
  if (row?.status === "complete" && !refresh && !stale) {
    return json({
      tradeKey: key,
      reviewId: row.id,
      verifiedFacts: row.verified_facts,
      possibleFactors: row.possible_factors,
      missingInformation: row.missing_information,
      improvements: row.improvements,
      narrative: row.narrative,
      narrativeSource: row.model ? "llm" : "deterministic",
      model: row.model,
      marketDataUsed: "none",
      feedback,
    });
  }
  try {
    const review = await generateTradeReview(t, j, ws.trades, uid, ws.risk.maxTradesPerDay);
    const [saved] = await q`insert into ai_trade_reviews (user_id, trade_key, status, model, verified_facts, possible_factors, missing_information, improvements, narrative, error, updated_at)
      values (${uid}, ${key}, 'complete', ${review.narrativeSource === "llm" ? review.model : null}, ${JSON.stringify(review.verifiedFacts)}::jsonb,
              ${JSON.stringify(review.possibleFactors)}::jsonb, ${JSON.stringify(review.missingInformation)}::jsonb, ${JSON.stringify(review.improvements)}::jsonb,
              ${review.narrative}, null, now())
      on conflict (user_id, trade_key) do update set status = 'complete', model = excluded.model, verified_facts = excluded.verified_facts,
        possible_factors = excluded.possible_factors, missing_information = excluded.missing_information, improvements = excluded.improvements,
        narrative = excluded.narrative, error = null, updated_at = now()
      returning id`;
    if (!row || row.status !== "complete")
      await notify(uid, "ai_review_ready", `AI review ready: ${t.tradingsymbol}`, review.narrative.slice(0, 140), `/journal/trade?key=${encodeURIComponent(key)}`, `review:${key}`);
    return json({ ...review, reviewId: saved?.id ?? null, feedback });
  } catch (e) {
    await q`insert into ai_trade_reviews (user_id, trade_key, status, error) values (${uid}, ${key}, 'failed', ${(e as Error).message})
            on conflict (user_id, trade_key) do update set status = 'failed', error = excluded.error, updated_at = now()`;
    return fail("Review generation failed. Try again shortly.", 500);
  }
}

const Feedback = z.object({ itemKey: z.string().min(1).max(64), verdict: z.enum(["accept", "reject", "correct"]), correction: z.string().max(1000).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const r = await withWorkspace();
  if ("res" in r) return r.res;
  if (r.ws.mode !== "live") return fail("Feedback is stored locally in demo mode", 400);
  const key = decodeURIComponent((await params).key);
  const body = Feedback.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("Invalid feedback");
  const q = db();
  const uid = r.ws.userId!;
  const [review] = await q`select id from ai_trade_reviews where user_id = ${uid} and trade_key = ${key}`;
  if (!review) return fail("Review not found", 404);
  await q`insert into ai_review_feedback (user_id, review_id, item_key, verdict, correction)
          values (${uid}, ${review.id}, ${body.data.itemKey}, ${body.data.verdict}, ${body.data.correction ?? null})
          on conflict (review_id, item_key) do update set verdict = excluded.verdict, correction = excluded.correction`;
  return json({ ok: true });
}
