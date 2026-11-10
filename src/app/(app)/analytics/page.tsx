import Link from "next/link";
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { filterTrades, parseRange } from "@/lib/data/range";
import { behaviorAnalysis, breakdowns, computeMetrics, drawdownSeries, histogram, plannedRisk, type Bucket } from "@/lib/engine/metrics";
import { CategoryBars, DrawdownChart, EquityCurve, Histogram, HorizontalPnl, MonthlyHeatmap, PnlBars, PnlCalendar, RRScatter } from "@/components/charts/Charts";
import { Badge, Empty, PageTitle, Panel, PanelHeader, Pnl } from "@/components/ui/primitives";
import { cn, duration, inr, pct } from "@/lib/utils";

export const metadata = { title: "Analytics Lab" };

const TABS = [
  { id: "charts", label: "Charts" },
  { id: "time", label: "Time" },
  { id: "instruments", label: "Instruments" },
  { id: "strategy", label: "Strategy" },
  { id: "behavior", label: "Behavior" },
] as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const range = parseRange(sp.range);
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "charts";
  const trades = filterTrades(ws.trades, range, ws.tz, ws.weekStart);
  const b = breakdowns(trades, ws.tz, ws.weekStart, ws.journal);
  const q = (t: string) => `/analytics?tab=${t}${sp.range ? `&range=${sp.range}` : ""}`;

  return (
    <>
      <PageTitle kicker="Performance laboratory" title="Analytics Lab" />
      <nav className="no-scrollbar -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4" aria-label="Analytics sections">
        {TABS.map((t) => (
          <Link key={t.id} href={q(t.id)} aria-current={tab === t.id ? "page" : undefined} className={cn("h-9 shrink-0 rounded-xl border px-4 text-[13px] font-semibold leading-9", tab === t.id ? "border-brass/40 bg-brass/10 text-brass" : "border-line text-text-3 hover:text-text")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {!trades.length ? (
        <Panel><Empty title="No closed trades in this range" body="Choose a wider date range." /></Panel>
      ) : tab === "charts" ? (
        <ChartsTab />
      ) : tab === "time" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="lg:col-span-2"><PanelHeader title="Daily performance" subtitle="Net P&L per trading day (IST)" /><div className="px-3 pb-4"><PnlBars data={b.daily.map((d) => ({ label: d.key.slice(5), netPnl: d.netPnl, trades: d.trades, winRate: d.winRate }))} minWidth={Math.max(360, b.daily.length * 14)} /></div></Panel>
          <Panel><PanelHeader title="Weekly" subtitle="Calendar weeks" /><div className="px-3 pb-4"><PnlBars data={b.weekly.map((d) => ({ label: d.key.slice(5), netPnl: d.netPnl, trades: d.trades, winRate: d.winRate }))} /></div></Panel>
          <Panel><PanelHeader title="Monthly" /><div className="px-3 pb-4"><PnlBars data={b.monthly.map((d) => ({ label: d.key, netPnl: d.netPnl, trades: d.trades, winRate: d.winRate }))} /></div></Panel>
          <Panel><PanelHeader title="Day of week" subtitle="By entry day" /><div className="px-3 pb-4"><PnlBars data={b.dayOfWeek} /></div><BucketTable rows={b.dayOfWeek} /></Panel>
          <Panel><PanelHeader title="Time of day" subtitle="By entry hour (IST)" /><div className="px-3 pb-4"><PnlBars data={b.hourOfDay} /></div><BucketTable rows={b.hourOfDay} /></Panel>
          <Panel className="lg:col-span-2"><PanelHeader title="Session performance" subtitle="Opening 09:15–10:30 · Midday 10:30–13:30 · Closing 13:30–15:30" /><BucketTable rows={b.session} /></Panel>
        </div>
      ) : tab === "instruments" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="lg:col-span-2"><PanelHeader title="Instrument contribution" subtitle="Net P&L by symbol" /><div className="px-3 pb-4"><HorizontalPnl data={b.symbol.slice(0, 15).map((s) => ({ label: s.label, netPnl: s.netPnl, trades: s.trades }))} /></div></Panel>
          <Panel><PanelHeader title="By symbol" /><BucketTable rows={b.symbol} /></Panel>
          <div className="space-y-4">
            <Panel><PanelHeader title="By category" subtitle="Stock / ETF / derivative" /><BucketTable rows={b.category} /></Panel>
            <Panel><PanelHeader title="By exchange" /><BucketTable rows={b.exchange} /></Panel>
            <Panel><PanelHeader title="By direction" /><BucketTable rows={b.direction} /></Panel>
          </div>
        </div>
      ) : tab === "strategy" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel><PanelHeader title="Win rate by strategy" subtitle="Breakevens excluded" /><div className="px-3 pb-4"><CategoryBars data={b.strategy.map((s) => ({ label: s.label.split(" ").map((w) => w[0]).join(""), full: s.label, winRate: s.winRate ?? 0, trades: s.trades }))} valueKey="winRate" format={(v) => `${Math.round(v)}%`} /></div></Panel>
          <Panel><PanelHeader title="Net P&L by strategy" /><div className="px-3 pb-4"><HorizontalPnl data={b.strategy.map((s) => ({ label: s.label, netPnl: s.netPnl, trades: s.trades }))} /></div></Panel>
          <Panel className="lg:col-span-2">
            <PanelHeader title="Strategy consistency" subtitle="Consistency = share of calendar weeks with positive net P&L for that strategy" />
            <StrategyTable trades={trades} ws={ws} />
          </Panel>
        </div>
      ) : (
        <BehaviorTab />
      )}
    </>
  );

  function ChartsTab() {
    const eq = drawdownSeries(trades, ws.risk.startingCapital, ws.tz);
    const m = computeMetrics(trades, { tz: ws.tz, journal: ws.journal });
    const cal: Record<string, { pnl: number; trades: number }> = {};
    for (const d of b.daily) cal[d.key] = { pnl: d.netPnl, trades: d.trades };
    const rr = trades.flatMap((t) => {
      const r = plannedRisk(t, ws.journal.get(t.tradeKey));
      return r ? [{ risk: Math.round(r * 100) / 100, pnl: t.netPnl, symbol: t.tradingsymbol, r: t.netPnl / r }] : [];
    });
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="lg:col-span-2"><PanelHeader title="Equity curve & cumulative P&L" subtitle="Realized net, by exit time" /><div className="px-3 pb-4"><EquityCurve data={eq} startingCapital={ws.risk.startingCapital} /></div></Panel>
        <Panel><PanelHeader title="Drawdown" subtitle="Peak-to-trough on realized equity" /><div className="px-3 pb-4"><DrawdownChart data={eq} /></div></Panel>
        <Panel><PanelHeader title="P&L distribution" subtitle="Net P&L per trade" /><div className="px-3 pb-4"><Histogram data={histogram(trades, 14)} /></div></Panel>
        <Panel className="lg:col-span-2"><PanelHeader title="Monthly return heatmap" subtitle="Net realized P&L per month" /><div className="px-4 pb-4"><MonthlyHeatmap months={b.monthly} /></div></Panel>
        <Panel><PanelHeader title="Calendar" /><div className="px-4 pb-4"><PnlCalendar days={cal} initialMonth={(b.daily[b.daily.length - 1]?.key ?? "").slice(0, 7)} /></div></Panel>
        <Panel>
          <PanelHeader title="Risk vs reward" subtitle={`${rr.length} trades with a recorded planned stop`} />
          <div className="px-3 pb-4">{rr.length ? <RRScatter data={rr} /> : <Empty title="No planned stops recorded" body="Add planned stops in the journal to unlock this chart." />}</div>
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader title="Win / loss comparison" />
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <Cmp k="Wins" v={<span className="num text-pos">{m.wins}</span>} />
            <Cmp k="Losses" v={<span className="num text-neg">{m.losses}</span>} />
            <Cmp k="Avg win" v={<Pnl value={m.avgWin} />} />
            <Cmp k="Avg loss" v={<Pnl value={m.avgLoss == null ? null : -m.avgLoss} />} />
            <Cmp k="Largest win" v={<Pnl value={m.bestTrade?.netPnl} />} />
            <Cmp k="Largest loss" v={<Pnl value={m.worstTrade?.netPnl} />} />
            <Cmp k="Avg hold (wins)" v={<span className="num">{duration(avg(trades.filter((t) => t.outcome === "win").map((t) => t.holdingSeconds)))}</span>} />
            <Cmp k="Avg hold (losses)" v={<span className="num">{duration(avg(trades.filter((t) => t.outcome === "loss").map((t) => t.holdingSeconds)))}</span>} />
          </div>
        </Panel>
      </div>
    );
  }

  function BehaviorTab() {
    const f = behaviorAnalysis(trades, ws.journal, ws.risk, ws.tz);
    const coverage = trades.length ? Math.round((trades.filter((t) => ws.journal.has(t.tradeKey)).length / trades.length) * 100) : 0;
    return (
      <div className="space-y-3">
        <p className="text-xs text-text-3">Behavioural findings require journal evidence. Journal coverage for this range: <span className="num text-text-2">{coverage}%</span>. Findings without enough evidence are marked as insufficient data rather than guessed.</p>
        {f.map((x) => (
          <Panel key={x.id} className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              {x.status === "flag" ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" /> : x.status === "ok" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-pos" /> : <HelpCircle className="mt-0.5 size-5 shrink-0 text-text-3" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{x.title}</p>
                  <Badge tone={x.status === "flag" ? "warn" : x.status === "ok" ? "pos" : "neutral"}>{x.status === "flag" ? "Flagged" : x.status === "ok" ? "OK" : "Insufficient data"}</Badge>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-text-2">{x.detail}</p>
                {x.evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {x.evidence.slice(0, 8).map((k) => {
                      const t = trades.find((tt) => tt.tradeKey === k);
                      return t ? <Link key={k} href={`/journal/${encodeURIComponent(k)}`} className="num rounded-lg border border-line px-2 py-1 text-[11px] text-text-2 hover:text-text">{t.tradingsymbol} {inr(t.netPnl, { sign: true, compact: true })}</Link> : null;
                    })}
                    {x.evidence.length > 8 && <span className="px-1 py-1 text-[11px] text-text-3">+{x.evidence.length - 8} more</span>}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        ))}
      </div>
    );
  }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function Cmp({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wider text-text-3">{k}</p>
      <div className="mt-1 text-base font-semibold">{v}</div>
    </div>
  );
}

function BucketTable({ rows }: { rows: Bucket[] }) {
  return (
    <div className="scroll-x px-4 pb-4">
      <table className="w-full min-w-[460px] text-[12.5px]">
        <thead className="text-left text-[10.5px] uppercase tracking-wider text-text-3">
          <tr>{["", "Trades", "Win rate", "PF", "Avg return", "Avg hold", "Net P&L"].map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line/60">
              <td className="py-2 pr-3 font-semibold">{r.label}</td>
              <td className="num pr-3">{r.trades}</td>
              <td className="num pr-3">{pct(r.winRate)}</td>
              <td className="num pr-3">{r.profitFactor ?? "—"}</td>
              <td className={cn("num pr-3", (r.avgReturnPct ?? 0) >= 0 ? "text-pos" : "text-neg")}>{pct(r.avgReturnPct, 2, true)}</td>
              <td className="num pr-3 text-text-2">{duration(r.avgHoldingSeconds)}</td>
              <td className="pr-3"><Pnl value={r.netPnl} size="sm" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StrategyTable({ trades, ws }: { trades: import("@/lib/engine/types").ClosedTrade[]; ws: Awaited<ReturnType<typeof getWorkspace>> }) {
  const b = breakdowns(trades, ws.tz, ws.weekStart, ws.journal);
  return (
    <div className="scroll-x px-4 pb-4">
      <table className="w-full min-w-[560px] text-[12.5px]">
        <thead className="text-left text-[10.5px] uppercase tracking-wider text-text-3">
          <tr>{["Strategy", "Trades", "Win rate", "PF", "Avg return", "Avg hold", "Consistency", "Net P&L"].map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {b.strategy.map((s) => {
            const st = trades.filter((t) => (ws.journal.get(t.tradeKey)?.strategy || "Unassigned") === s.label);
            const weeks = breakdowns(st, ws.tz, ws.weekStart).weekly;
            const cons = weeks.length ? (weeks.filter((w) => w.netPnl > 0).length / weeks.length) * 100 : null;
            return (
              <tr key={s.key} className="border-t border-line/60">
                <td className="py-2 pr-3 font-semibold">{s.label}</td>
                <td className="num pr-3">{s.trades}</td>
                <td className="num pr-3">{pct(s.winRate)}</td>
                <td className="num pr-3">{s.profitFactor ?? "—"}</td>
                <td className={cn("num pr-3", (s.avgReturnPct ?? 0) >= 0 ? "text-pos" : "text-neg")}>{pct(s.avgReturnPct, 2, true)}</td>
                <td className="num pr-3 text-text-2">{duration(s.avgHoldingSeconds)}</td>
                <td className="num pr-3">{pct(cons, 0)} <span className="text-text-3">of {weeks.length}w</span></td>
                <td className="pr-3"><Pnl value={s.netPnl} size="sm" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
