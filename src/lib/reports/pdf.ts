import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { WeeklyReport } from "@/lib/engine/weekly";
import type { ClosedTrade } from "@/lib/engine/types";

// Standard PDF fonts cannot encode "₹", so the PDF uses "Rs".
const rs = (n: number | null | undefined) => (n == null ? "-" : `${n < 0 ? "-" : ""}Rs ${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const p = (n: number | null | undefined) => (n == null ? "-" : `${n.toFixed(1)}%`);
const ascii = (s: string) => s.replace(/₹/g, "Rs ").replace(/[−–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E]/g, "");

export async function weeklyReportPdf(r: WeeklyReport, trades: ClosedTrade[], opts: { demo: boolean; narrative?: string | null }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`TRADEOS weekly report ${r.weekStart}`);
  doc.setProducer("TRADEOS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]);
  let y = 800;
  const ink = rgb(0.1, 0.11, 0.14);
  const muted = rgb(0.42, 0.45, 0.52);
  const brass = rgb(0.66, 0.53, 0.35);

  const ensure = (h: number) => {
    if (y - h < 50) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
  };
  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = ink, pg: PDFPage = page) => pg.drawText(ascii(s), { x, y, size, font: f, color });
  const wrap = (s: string, size = 10, width = 495) => {
    const words = ascii(s).split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    for (const l of lines) {
      ensure(14);
      text(l, 50, size);
      y -= size + 4;
    }
  };
  const h2 = (s: string) => {
    ensure(30);
    y -= 10;
    text(s.toUpperCase(), 50, 9, bold, brass);
    y -= 16;
  };

  text("TRADEOS", 50, 18, bold, brass);
  text("Weekly Performance Report", 140, 14, bold);
  y -= 20;
  text(`Calendar week ${r.weekStart} to ${r.weekEnd} (${r.timezone})`, 50, 10, font, muted);
  y -= 14;
  if (opts.demo) {
    text("DEMO MODE - all figures are synthetic sample data.", 50, 10, bold, rgb(0.7, 0.45, 0.1));
    y -= 14;
  }
  text(r.metrics.costsAllVerified ? "Charges verified from contract notes." : "Charges are ESTIMATED from the fee schedule - verify with contract notes.", 50, 9, font, muted);
  y -= 10;

  h2("Weekly overview");
  const m = r.metrics;
  const rows: [string, string][] = [
    ["Completed trades", String(m.tradeCount)],
    ["Winning / losing / breakeven", `${m.wins} / ${m.losses} / ${m.breakevens}`],
    ["Win rate (breakevens excluded)", p(m.winRate)],
    ["Gross P&L", rs(m.grossPnl)],
    ["Charges", rs(m.totalCosts)],
    ["Net P&L", rs(m.netPnl)],
    ["Profit factor", m.profitFactor == null ? m.profitFactorNote ?? "-" : String(m.profitFactor)],
    ["Best trade", m.bestTrade ? `${m.bestTrade.tradingsymbol} ${rs(m.bestTrade.netPnl)}` : "-"],
    ["Worst trade", m.worstTrade ? `${m.worstTrade.tradingsymbol} ${rs(m.worstTrade.netPnl)}` : "-"],
    ["Average gain", rs(m.avgWin)],
    ["Average loss", m.avgLoss == null ? "-" : rs(-m.avgLoss)],
  ];
  for (const [k, v] of rows) {
    ensure(16);
    text(k, 50, 10, font, muted);
    text(v, 300, 10, bold);
    y -= 16;
  }

  h2("Behavior review");
  const beh: [string, string][] = [
    ["Most frequently used strategy", r.mostUsedStrategy ? `${r.mostUsedStrategy.name} (${r.mostUsedStrategy.count})` : "No strategy recorded"],
    ["Most successful recorded strategy", r.bestStrategy ? `${r.bestStrategy.name} (${rs(r.bestStrategy.netPnl)})` : "-"],
    ["Repeated mistakes", r.repeatedMistakes.length ? r.repeatedMistakes.map((x) => `${x.mistake} x${x.count}`).join(", ") : "None recorded twice"],
    ["Journal coverage", `${r.journalCoverage}%`],
    ["Trades with planned stop", `${r.stopCoverage}%`],
  ];
  for (const [k, v] of beh) {
    ensure(16);
    text(k, 50, 10, font, muted);
    text(v.slice(0, 60), 300, 10, bold);
    y -= 16;
  }

  h2("Review");
  const sec = (title: string, items: string[]) => {
    ensure(18);
    text(title, 50, 10, bold);
    y -= 14;
    if (!items.length) wrap("- Nothing to report from recorded data.", 9.5);
    for (const i of items) wrap(`- ${i}`, 9.5);
    y -= 4;
  };
  sec("What went well?", r.wentWell);
  sec("What went wrong?", r.wentWrong);
  sec("Which patterns repeated?", r.repeatedMistakes.map((x) => `${x.mistake} recorded ${x.count} times`));
  sec("What can be improved next week?", r.improvementAreas);
  if (opts.narrative) {
    ensure(18);
    text("AI summary (grounded in the figures above)", 50, 10, bold);
    y -= 14;
    wrap(opts.narrative, 9.5);
  }

  h2("Trades");
  ensure(16);
  ["Exit", "Symbol", "Side", "Qty", "Net P&L", "Outcome"].forEach((h, i) => text(h, [50, 120, 230, 280, 330, 440][i], 8.5, bold, muted));
  y -= 14;
  for (const t of trades) {
    ensure(14);
    const cols = [t.exitAt.slice(0, 10), t.tradingsymbol, t.direction, String(t.quantity), rs(t.netPnl), t.outcome];
    cols.forEach((c, i) => text(c, [50, 120, 230, 280, 330, 440][i], 8.5));
    y -= 12;
  }

  const pages = doc.getPages();
  pages.forEach((pg, i) => pg.drawText(ascii(`TRADEOS · analytics only, not investment advice · page ${i + 1}/${pages.length}`), { x: 50, y: 28, size: 7.5, font, color: muted }));
  return doc.save();
}
