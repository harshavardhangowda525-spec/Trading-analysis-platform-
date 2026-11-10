import Link from "next/link";
import { BrainCircuit, CalendarDays, Gauge, LineChart, ListOrdered, Sparkles, Trophy, Wallet } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { filterTrades, parseRange, RANGES } from "@/lib/data/range";
import { breakdowns, computeMetrics, drawdownSeries } from "@/lib/engine/metrics";
import { riskStatus } from "@/lib/engine/risk";
import { buildWeeklyReport } from "@/lib/engine/weekly";
import { calendarWeek, localDate } from "@/lib/engine/time";
import { buildInsights } from "@/lib/insights";
import { Badge, Empty, PageTitle, Panel, PanelHeader, Pnl, Provenance, buttonClass } from "@/components/ui/primitives";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { DashboardGrid, type Widget } from "@/components/dashboard/DashboardGrid";
import { EquityCurve, PnlBars, PnlCalendar, WinLossDonut } from "@/components/charts/Charts";
import { TradeRow, toLite } from "@/components/journal/TradeRow";
import { cn, duration, fmtDate, inr, pct } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const range = parseRange(sp.range);
  const trades = filterTrades(ws.trades, range, ws.tz, ws.weekStart);
  const m = computeMetrics(trades, { tz: ws.tz, startingCapital: ws.risk.startingCapital, journal: ws.journal });
  const eq = drawdownSeries(trades, ws.risk.startingCapital, ws.tz);
  const b = breakdowns(trades, ws.tz, ws.weekStart, ws.journal);
  const risk = riskStatus(ws.trades, ws.journal, ws.risk, new Date(), ws.tz, ws.weekStart);
  const insights = buildInsights(trades, ws.journal, ws.risk, ws.tz);
  const thisWeek = calendarWeek(new Date(), ws.tz, ws.weekStart);
  const weekly = buildWeeklyReport(ws.trades, ws.journal, thisWeek.start, ws.tz);
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? range;
  const cal: Record<string, { pnl: number; trades: number }> = {};
  for (const d of b.daily) cal[d.key] = { pnl: d.netPnl, trades: d.trades };
  const lastMonth = (b.daily[b.daily.length - 1]?.key ?? localDate(new Date(), ws.tz)).slice(0, 7);
  const costLabel = m.costsAllVerified ? "verified" : "estimated";

  if (!ws.trades.length) {
    return (
      <>
        <PageTitle kicker="Mission control" title="Overview" />
        <Panel>
          <Empty
            icon={<Wallet className="size-8" />}
            title="No trades yet"
            body="Connect Zerodha for daily automatic collection, or import your Console tradebook CSV to rebuild your history."
            action={<Link href="/broker" className={buttonClass("primary")}>Connect or import</Link>}
          />
        </Panel>
      </>
    );
  }

  const widgets: Widget[] = [
    {
      id: "equity",
      title: "Equity curve",
      span: "twoThirds",
      node: (
        <Panel className="h-full">
          <PanelHeader icon={<LineChart className="size-4" />} title="Equity curve" subtitle={`Realized net P&L · ${rangeLabel} · ${costLabel} charges`} />
          <div className="px-3 pb-4 sm:px-4">{eq.length ? <EquityCurve data={eq} startingCapital={ws.risk.startingCapital} /> : <Empty title="No closed trades in this range" />}</div>
        </Panel>
      ),
    },
    {
      id: "winloss",
      title: "Win / loss distribution",
      node: (
        <Panel className="h-full">
          <PanelHeader title="Win / loss distribution" subtitle="Outcome on net P&L; breakeven = |net| < ₹1" />
          <div className="px-4 pb-5 pt-3 sm:px-5">
            <WinLossDonut wins={m.wins} losses={m.losses} breakevens={m.breakevens} />
            <div className="hairline my-4" />
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-text-3">Expectancy / trade</p>
                <Pnl value={m.expectancy} />
              </div>
              <div>
                <p className="text-text-3">Best trade</p>
                <Pnl value={m.bestTrade?.netPnl} />
              </div>
            </div>
          </div>
        </Panel>
      ),
    },
    {
      id: "weekly",
      title: "Weekly performance",
      span: "half",
      node: (
        <Panel className="h-full">
          <PanelHeader title="Weekly performance" subtitle="Net P&L per calendar week (Mon–Sun, IST)" />
          <div className="px-3 pb-4 sm:px-4">
            <PnlBars data={b.weekly.slice(-14).map((w) => ({ label: w.key.slice(5), netPnl: w.netPnl, trades: w.trades, winRate: w.winRate }))} minWidth={360} />
          </div>
        </Panel>
      ),
    },
    {
      id: "calendar",
      title: "P&L calendar",
      span: "half",
      node: (
        <Panel className="h-full">
          <PanelHeader icon={<CalendarDays className="size-4" />} title="P&L calendar" subtitle="Daily realized net P&L by exit date" />
          <div className="px-4 pb-4 sm:px-5">
            <PnlCalendar days={cal} initialMonth={lastMonth} />
          </div>
        </Panel>
      ),
    },
    {
      id: "strategies",
      title: "Strategy leaderboard",
      node: (
        <Panel className="h-full">
          <PanelHeader icon={<Trophy className="size-4" />} title="Strategy leaderboard" subtitle="From your journal tags" />
          <ol className="space-y-1 px-3 pb-4 pt-2">
            {b.strategy.slice(0, 6).map((s, i) => (
              <li key={s.key} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]">
                <span className={cn("num grid size-6 place-items-center rounded-lg text-[11px] font-bold", i === 0 ? "bg-brass/20 text-brass" : "bg-white/5 text-text-3")}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{s.label}</p>
                  <p className="num text-[11px] text-text-3">{s.trades} trades · WR {pct(s.winRate, 0)} · PF {s.profitFactor ?? "—"}</p>
                </div>
                <Pnl value={s.netPnl} compact />
              </li>
            ))}
          </ol>
        </Panel>
      ),
    },
    {
      id: "recent",
      title: "Recent trade activity",
      node: (
        <Panel className="h-full">
          <PanelHeader icon={<ListOrdered className="size-4" />} title="Recent trades" action={<Link href="/journal" className="text-xs text-text-3 hover:text-text">View all</Link>} />
          <div className="px-1 pb-3 pt-1">
            {[...trades].reverse().slice(0, 6).map((t) => <TradeRow key={t.tradeKey} t={toLite(t, ws.journal.get(t.tradeKey))} tz={ws.tz} />)}
          </div>
        </Panel>
      ),
    },
    {
      id: "insights",
      title: "AI performance insights",
      node: (
        <Panel className="h-full">
          <PanelHeader icon={<Sparkles className="size-4" />} title="Performance insights" subtitle="Rule-based findings from your records" action={<Link href="/intelligence" className="text-xs text-text-3 hover:text-text">Intelligence</Link>} />
          <ul className="space-y-2 px-4 pb-4 pt-3 sm:px-5">
            {insights.length === 0 && <li className="text-xs text-text-3">Not enough trades in this range for reliable findings.</li>}
            {insights.map((x) => (
              <li key={x.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                <p className="flex items-start gap-2 text-[13px] font-semibold">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", x.tone === "pos" ? "bg-pos" : x.tone === "neg" ? "bg-neg" : "bg-warn")} aria-hidden />
                  {x.title}
                </p>
                <p className="mt-1 pl-3.5 text-xs leading-relaxed text-text-2">{x.body}</p>
                <p className="mt-1 pl-3.5 text-[10.5px] text-text-3">Evidence: {x.evidence}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ),
    },
    {
      id: "risk",
      title: "Risk management score",
      node: (
        <Panel className="h-full">
          <PanelHeader icon={<Gauge className="size-4" />} title="Risk management score" subtitle="Transparent rules — see Risk Center" action={<Link href="/risk" className="text-xs text-text-3 hover:text-text">Details</Link>} />
          <div className="flex items-center gap-5 px-5 pb-5 pt-3">
            <ScoreRing score={risk.score} />
            <ul className="flex-1 space-y-1.5 text-[11px]">
              {risk.scoreBreakdown.map((s) => (
                <li key={s.label}>
                  <div className="flex justify-between text-text-3"><span className="truncate pr-2">{s.label}</span><span className="num text-text-2">{s.points}/{s.max}</span></div>
                  <div className="mt-0.5 h-1 rounded-full bg-white/5"><div className="h-1 rounded-full bg-brass/70" style={{ width: `${(s.points / s.max) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </div>
          {risk.alerts.length > 0 && (
            <div className="mx-4 mb-4 rounded-xl border border-warn/25 bg-warn/[0.07] p-3 text-xs text-warn" role="status">
              {risk.alerts[0].message}
            </div>
          )}
        </Panel>
      ),
    },
    {
      id: "summary",
      title: "Weekly trading summary",
      node: (
        <Panel className="h-full">
          <PanelHeader icon={<BrainCircuit className="size-4" />} title="This week" subtitle={`${fmtDate(thisWeek.start + "T06:00:00Z")} – ${fmtDate(thisWeek.end + "T06:00:00Z")} (calendar week)`} action={<Link href="/reports" className="text-xs text-text-3 hover:text-text">Report</Link>} />
          <div className="grid grid-cols-3 gap-3 px-5 pb-3 pt-3 text-xs">
            <Stat k="Net" v={<Pnl value={weekly.metrics.netPnl} compact />} />
            <Stat k="Trades" v={<span className="num font-semibold">{weekly.metrics.tradeCount}</span>} />
            <Stat k="Win rate" v={<span className="num font-semibold">{pct(weekly.metrics.winRate)}</span>} />
          </div>
          <ul className="space-y-1.5 px-5 pb-5 text-xs text-text-2">
            {[...weekly.wentWell.slice(0, 1), ...weekly.wentWrong.slice(0, 1), ...weekly.improvementAreas.slice(0, 1)].map((s, i) => <li key={i}>• {s}</li>)}
            {weekly.metrics.tradeCount === 0 && <li className="text-text-3">No trades closed this week yet.</li>}
          </ul>
        </Panel>
      ),
    },
  ];

  return (
    <>
      <PageTitle kicker="Mission control" title="Overview">
        <div className="flex items-center gap-2">
          {ws.mode === "demo" && <Provenance kind="demo" />}
          <Badge tone="neutral">{rangeLabel}</Badge>
        </div>
      </PageTitle>

      <section aria-label="Key metrics" className="mb-5">
        <div className="glass mb-3 flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-3">Net realized P&L</p>
            <Pnl value={m.netPnl} size="xl" className="mt-1" />
            <p className="mt-1 text-xs text-text-3">
              Gross <span className="num text-text-2">{inr(m.grossPnl, { sign: true })}</span> − charges <span className="num text-text-2">{inr(m.totalCosts)}</span> <Provenance kind={m.costsAllVerified ? "verified" : "estimated"} />
            </p>
          </div>
          <p className="max-w-xs text-[11px] leading-relaxed text-text-3">Realized only. Open positions ({ws.openPositions.length}) are excluded and shown separately in the journal.</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-8">
          <MetricCard label="Gross realized" value={<Pnl value={m.grossPnl} compact />} hint="Sum of realized P&L before charges." />
          <MetricCard label="Charges" value={<span className="num">{inr(m.totalCosts, { compact: true })}</span>} badge={<Provenance kind={m.costsAllVerified ? "verified" : "estimated"} />} hint="Brokerage, STT, exchange txn, SEBI, GST, stamp duty, DP. Estimated unless verified by contract notes." />
          <MetricCard label="Trades" value={<span className="num">{m.tradeCount}</span>} sub={`${m.breakevens} breakeven`} hint="Completed round trips (flat → position → flat)." />
          <MetricCard label="Winning" value={<span className="num text-pos">{m.wins}</span>} tone="pos" />
          <MetricCard label="Losing" value={<span className="num text-neg">{m.losses}</span>} tone="neg" />
          <MetricCard label="Win rate" value={<span className="num">{pct(m.winRate)}</span>} sub={`incl. BE ${pct(m.winRateInclBreakeven)}`} hint="Wins ÷ (wins + losses). Breakeven trades are excluded from the denominator." />
          <MetricCard label="Avg win" value={<Pnl value={m.avgWin} compact showIcon={false} />} />
          <MetricCard label="Avg loss" value={<Pnl value={m.avgLoss == null ? null : -m.avgLoss} compact showIcon={false} />} />
          <MetricCard label="Profit factor" value={<span className="num">{m.profitFactor ?? "∞"}</span>} sub={m.profitFactorNote ?? undefined} hint="Gross profits ÷ |gross losses| on net P&L." />
          <MetricCard label="Avg R:R" value={<span className="num">{m.avgRR == null ? "—" : `${m.avgRR}R`}</span>} sub={`${m.rrSampleSize} with planned stop`} hint="Realized net P&L ÷ planned risk. Only trades with a valid recorded stop are included." />
          <MetricCard label="Max drawdown" value={<span className="num text-neg">{inr(-m.maxDrawdown, { compact: true })}</span>} sub={m.maxDrawdownPct == null ? undefined : pct(-m.maxDrawdownPct)} hint="Peak-to-trough on cumulative realized net P&L from starting capital. No mark-to-market." />
          <MetricCard label="Best day" value={<Pnl value={m.bestDay?.pnl} compact showIcon={false} />} sub={m.bestDay?.date} />
          <MetricCard label="Worst day" value={<Pnl value={m.worstDay?.pnl} compact showIcon={false} />} sub={m.worstDay?.date} />
          <MetricCard label="Streak" value={<span className={cn("num", m.currentStreak.type === "win" ? "text-pos" : m.currentStreak.type === "loss" ? "text-neg" : "")}>{m.currentStreak.count} {m.currentStreak.type === "none" ? "" : m.currentStreak.type === "win" ? "W" : "L"}</span>} sub="current, BE skipped" />
          <MetricCard label="Avg hold" value={<span className="num">{duration(m.avgHoldingSeconds)}</span>} />
          <MetricCard label="Expectancy" value={<Pnl value={m.expectancy} compact showIcon={false} />} hint="P(win)·avg win − P(loss)·avg loss, over all closed trades." />
        </div>
      </section>

      <DashboardGrid widgets={widgets} initial={ws.dashboardLayout} mode={ws.mode} />
    </>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wider text-text-3">{k}</p>
      <div className="mt-0.5">{v}</div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-[88px] shrink-0" role="img" aria-label={`Risk score ${score} out of 100`}>
      <svg viewBox="0 0 80 80" className="-rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="url(#sr)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
        <defs>
          <linearGradient id="sr"><stop offset="0" stopColor="#f4e7cc" /><stop offset="1" stopColor="#a8875a" /></linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="num text-2xl font-bold">{score}</span>
      </div>
    </div>
  );
}
