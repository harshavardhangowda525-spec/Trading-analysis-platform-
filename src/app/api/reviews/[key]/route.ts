import { z } from "zod";
import { fail, json, withWorkspace } from "@/lib/api";
import { generateTradeReview } from "@/lib/ai/reviewService";
import type { TradeReview } from "@/lib/ai/review";
import { findTrade } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const demoCache = new Map<string, TradeReview>();

/* eslint-disable @typescript-eslint/no-explicit-any */
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

  const sb = await createClient();
  const { data: row } = await sb.from("ai_trade_reviews").select("*, ai_review_feedback(item_key, verdict, correction)").eq("trade_key", key).maybeSingle();
  const feedback = Object.fromEntries(((row as any)?.ai_review_feedback ?? []).map((f: any) => [f.item_key, { verdict: f.verdict, correction: f.correction }]));
  const stale = row && j?.updatedAt && Date.parse(j.updatedAt) > Date.parse(row.updated_at);
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
      marketDataUsed: (row.verified_facts as any)?.marketDataUsed ?? "none",
      feedback,
    });
  }
  try {
    const review = await generateTradeReview(t, j, ws.trades, ws.userId, ws.risk.maxTradesPerDay);
    const { data: saved } = await sb
      .from("ai_trade_reviews")
      .upsert(
        {
          user_id: ws.userId,
          trade_key: key,
          status: "complete",
          model: review.narrativeSource === "llm" ? review.model : null,
          verified_facts: review.verifiedFacts,
          possible_factors: review.possibleFactors,
          missing_information: review.missingInformation,
          improvements: review.improvements,
          narrative: review.narrative,
          error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,trade_key" }
      )
      .select("id")
      .single();
    if (!row || row.status !== "complete")
      await sb.from("notifications").upsert(
        { user_id: ws.userId, type: "ai_review_ready", title: `AI review ready: ${t.tradingsymbol}`, body: review.narrative.slice(0, 140), data: { href: `/journal/${encodeURIComponent(key)}` }, dedupe_key: `review:${key}` },
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
      );
    return json({ ...review, reviewId: saved?.id ?? null, feedback });
  } catch (e) {
    await sb.from("ai_trade_reviews").upsert({ user_id: ws.userId, trade_key: key, status: "failed", error: (e as Error).message }, { onConflict: "user_id,trade_key" });
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
  const sb = await createClient();
  const { data: review } = await sb.from("ai_trade_reviews").select("id").eq("trade_key", key).maybeSingle();
  if (!review) return fail("Review not found", 404);
  const { error } = await sb.from("ai_review_feedback").upsert(
    { user_id: r.ws.userId, review_id: review.id, item_key: body.data.itemKey, verdict: body.data.verdict, correction: body.data.correction ?? null },
    { onConflict: "review_id,item_key" }
  );
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}
