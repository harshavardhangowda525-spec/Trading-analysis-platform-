import { fail, json, withWorkspace } from "@/lib/api";
import { buildWeeklyReport, tradesInWeek } from "@/lib/engine/weekly";
import { weekStartOf } from "@/lib/engine/time";
import { weeklyReportPdf } from "@/lib/reports/pdf";
import { weeklyNarrative } from "@/lib/reports/weeklyNarrative";
import { serverEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";

export const dynamic = "force-dynamic";

function weekParam(req: Request, weekStart: number) {
  const w = new URL(req.url).searchParams.get("week") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) return null;
  return weekStartOf(w, weekStart);
}

/** GET → PDF download of a calendar-week report. */
export async function GET(req: Request) {
  const r = await withWorkspace();
  if ("res" in r) return r.res;
  const { ws } = r;
  const week = weekParam(req, ws.weekStart);
  if (!week) return fail("week=YYYY-MM-DD required");
  const report = buildWeeklyReport(ws.trades, ws.journal, week, ws.tz);
  const narrative = await weeklyNarrative(report);
  const bytes = await weeklyReportPdf(report, tradesInWeek(ws.trades, week, ws.tz), { demo: ws.mode === "demo", narrative });
  if (ws.mode === "live") {
    const sb = await createClient();
    const path = `${ws.userId}/weekly-${week}.pdf`;
    await sb.storage.from("reports").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    await sb.from("weekly_reports").upsert(
      { user_id: ws.userId, week_start: week, week_end: report.weekEnd, timezone: ws.tz, metrics: { ...report.metrics, bestTrade: undefined, worstTrade: undefined }, ai_review: { wentWell: report.wentWell, wentWrong: report.wentWrong, improvements: report.improvementAreas, narrative }, storage_path: path },
      { onConflict: "user_id,week_start" }
    );
  }
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="tradeos-week-${week}.pdf"`, "Cache-Control": "no-store" },
  });
}

/** POST → optional email summary (requires RESEND_API_KEY + REPORT_FROM_EMAIL). */
export async function POST(req: Request) {
  const r = await withWorkspace();
  if ("res" in r) return r.res;
  const { ws } = r;
  if (ws.mode !== "live" || !ws.email) return fail("Email summaries require a signed-in live account");
  const env = serverEnv();
  if (!env.resendApiKey || !env.reportFromEmail) return fail("Email delivery is not configured on the server", 501);
  const week = weekParam(req, ws.weekStart);
  if (!week) return fail("week=YYYY-MM-DD required");
  const rep = buildWeeklyReport(ws.trades, ws.journal, week, ws.tz);
  const m = rep.metrics;
  const html = `<h2>TRADEOS weekly report</h2><p>Calendar week ${rep.weekStart} – ${rep.weekEnd} (${rep.timezone})</p>
<ul><li>Trades: ${m.tradeCount} (${m.wins}W / ${m.losses}L / ${m.breakevens}BE)</li><li>Win rate: ${m.winRate?.toFixed(1) ?? "—"}%</li>
<li>Net P&amp;L: ${inr(m.netPnl, { sign: true })} (charges ${inr(m.totalCosts)}${m.costsAllVerified ? "" : ", estimated"})</li>
<li>Profit factor: ${m.profitFactor ?? m.profitFactorNote}</li></ul>
<p><b>Improve next week:</b> ${rep.improvementAreas.map((x) => x.replace(/</g, "&lt;")).join(" ")}</p><p style="color:#888">Analytics only — not investment advice.</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.reportFromEmail, to: [ws.email], subject: `TRADEOS weekly report ${rep.weekStart}`, html }),
  });
  if (!res.ok) return fail("Email provider rejected the request", 502);
  return json({ ok: true });
}
