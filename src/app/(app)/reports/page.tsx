import Link from "next/link";
import { Download } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { buildWeeklyReport, listWeeks, tradesInWeek } from "@/lib/engine/weekly";
import { breakdowns } from "@/lib/engine/metrics";
import { calendarWeek } from "@/lib/engine/time";
import { PnlBars } from "@/components/charts/Charts";
import { EmailReportButton } from "@/components/reports/EmailReportButton";
import { Badge, Empty, PageTitle, Panel, PanelHeader, Pnl, Provenance, buttonClass } from "@/components/ui/primitives";
import { cn, inr, pct } from "@/lib/utils";

export const metadata = { title: "Weekly Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const current = calendarWeek(new Date(), ws.tz, ws.weekStart).start;
  const weeks = [...new Set([current, ...listWeeks(ws.trades, ws.tz, ws.weekStart)])].sort().reverse();
  const week = weeks.includes(sp.week ?? "") ? sp.week! : weeks[0];
  const r = buildWeeklyReport(ws.trades, ws.journal, week, ws.tz);
  const m = r.metrics;
  const daily = breakdowns(tradesInWeek(ws.trades, week, ws.tz), ws.tz).daily;

  return (
    <>
      <PageTitle kicker="Calendar-week performance" title="Weekly Reports">
        <div className="flex gap-2">
          <a href={`/api/reports/weekly?week=${week}`} className={buttonClass("primary")}><Download className="size-4" /> PDF</a>
          {ws.mode === "live" && <EmailReportButton week={week} />}
        </div>
      </PageTitle>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4">
        {weeks.slice(0, 16).map((w) => (
          <Link key={w} href={`/reports?week=${w}`} className={cn("num h-9 shrink-0 rounded-xl border px-3 text-xs font-semibold leading-9", w === week ? "border-brass/40 bg-brass/10 text-brass" : "border-line text-text-3")}>
            {w === current ? "This week" : w.slice(5)}
          </Link>
        ))}
      </div>
      <p className="mb-4 text-xs text-text-3">
        Week of <span className="num text-text-2">{r.weekStart}</span> to <span className="num text-text-2">{r.weekEnd}</span> in {r.timezone}. This is a calendar week, never a rolling seven-day window. {!m.costsAllVerified && m.tradeCount > 0 && <Provenance kind="estimated" />}
      </p>
      {m.tradeCount === 0 ? (
        <Panel><Empty title="No trades closed in this week" /></Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-2">
            <PanelHeader title="Weekly overview" />
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <S k="Net P&L" v={<Pnl value={m.netPnl} size="lg" />} />
              <S k="Gross P&L" v={<Pnl value={m.grossPnl} />} />
              <S k="Charges" v={<span className="num">{inr(m.totalCosts)}</span>} />
              <S k="Profit factor" v={<span className="num">{m.profitFactor ?? "∞"}</span>} />
              <S k="Trades" v={<span className="num">{m.tradeCount}</span>} />
              <S k="W / L / BE" v={<span className="num">{m.wins} / {m.losses} / {m.breakevens}</span>} />
              <S k="Win rate" v={<span className="num">{pct(m.winRate)}</span>} />
              <S k="Avg gain / loss" v={<span className="num text-[13px]">{inr(m.avgWin)} / {m.avgLoss == null ? "—" : inr(-m.avgLoss)}</span>} />
              <S k="Best trade" v={m.bestTrade ? <span className="text-[13px]">{m.bestTrade.tradingsymbol} <Pnl value={m.bestTrade.netPnl} size="sm" /></span> : "—"} />
              <S k="Worst trade" v={m.worstTrade ? <span className="text-[13px]">{m.worstTrade.tradingsymbol} <Pnl value={m.worstTrade.netPnl} size="sm" /></span> : "—"} />
            </div>
            <div className="px-3 pb-4"><PnlBars data={daily.map((d) => ({ label: d.key.slice(5), netPnl: d.netPnl, trades: d.trades, winRate: d.winRate }))} height={180} /></div>
          </Panel>
          <Panel>
            <PanelHeader title="Behavior review" />
            <ul className="space-y-3 p-5 text-[13px]">
              <li><p className="text-[10.5px] uppercase tracking-wider text-text-3">Most used strategy</p>{r.mostUsedStrategy ? `${r.mostUsedStrategy.name} (${r.mostUsedStrategy.count})` : <span className="text-text-3">None recorded</span>}</li>
              <li><p className="text-[10.5px] uppercase tracking-wider text-text-3">Most successful strategy</p>{r.bestStrategy ? <>{r.bestStrategy.name} <Pnl value={r.bestStrategy.netPnl} size="sm" /></> : <span className="text-text-3">—</span>}</li>
              <li><p className="text-[10.5px] uppercase tracking-wider text-text-3">Repeated mistakes</p>{r.repeatedMistakes.length ? r.repeatedMistakes.map((x) => <Badge key={x.mistake} tone="neg" className="mr-1">{x.mistake} ×{x.count}</Badge>) : <span className="text-text-3">None recorded twice</span>}</li>
              <li><p className="text-[10.5px] uppercase tracking-wider text-text-3">Risk management consistency</p>Journal coverage <span className="num">{r.journalCoverage}%</span> · planned stops <span className="num">{r.stopCoverage}%</span></li>
            </ul>
          </Panel>
          <Panel className="lg:col-span-3">
            <PanelHeader title="Review" subtitle="Rule-based from recorded data. The PDF adds an LLM summary when configured (grounding-checked)." />
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Q title="What went well?" items={r.wentWell} />
              <Q title="What went wrong?" items={r.wentWrong} />
              <Q title="Which patterns repeated?" items={r.repeatedMistakes.map((x) => `${x.mistake} — ${x.count} times`)} />
              <Q title="What can be improved next week?" items={r.improvementAreas} />
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

function S({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wider text-text-3">{k}</p>
      <div className="mt-1 font-semibold">{v}</div>
    </div>
  );
}
function Q({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3.5">
      <p className="mb-2 text-[13px] font-semibold">{title}</p>
      {items.length ? <ul className="space-y-1.5 text-xs leading-relaxed text-text-2">{items.map((i, k) => <li key={k}>• {i}</li>)}</ul> : <p className="text-xs text-text-3">Nothing to report from recorded data.</p>}
    </div>
  );
}
