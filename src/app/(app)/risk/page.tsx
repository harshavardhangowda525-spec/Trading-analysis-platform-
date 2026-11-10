import Link from "next/link";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { riskStatus } from "@/lib/engine/risk";
import { RiskForm } from "@/components/risk/RiskForm";
import { Badge, PageTitle, Panel, PanelHeader, Pnl } from "@/components/ui/primitives";
import { cn, inr, pct } from "@/lib/utils";

export const metadata = { title: "Risk Center" };

export default async function RiskPage() {
  const ws = await getWorkspace();
  const s = riskStatus(ws.trades, ws.journal, ws.risk, new Date(), ws.tz, ws.weekStart);
  const dailyUsed = Math.min(100, Math.max(0, (-Math.min(0, s.todayPnl) / ws.risk.maxDailyLoss) * 100));
  const weeklyUsed = Math.min(100, Math.max(0, (-Math.min(0, s.weekPnl) / ws.risk.maxWeeklyLoss) * 100));
  const within = s.riskPerTrade.filter((r) => r.withinLimit).length;

  return (
    <>
      <PageTitle kicker="Discipline, measured" title="Risk Center" />
      {s.alerts.length > 0 && (
        <div className="mb-4 space-y-2" role="status">
          {s.alerts.map((a) => (
            <div key={a.id} className={cn("flex items-start gap-2.5 rounded-2xl border p-3.5 text-[13px]", a.level === "breach" ? "border-neg/30 bg-neg/[0.08] text-neg" : a.level === "warning" ? "border-warn/30 bg-warn/[0.08] text-warn" : "border-line-2 bg-white/[0.03] text-text-2")}>
              {a.level === "breach" ? <AlertOctagon className="mt-0.5 size-4 shrink-0" /> : a.level === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
              <span><strong className="mr-1 uppercase tracking-wide">{a.level}</strong>{a.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Budget title="Today's loss budget" used={dailyUsed} pnl={s.todayPnl} remaining={s.dailyBudgetRemaining} limit={ws.risk.maxDailyLoss} sub={`${s.todayTrades} trades closed today (${s.today})`} />
            <Budget title="This week's loss budget" used={weeklyUsed} pnl={s.weekPnl} remaining={s.weeklyBudgetRemaining} limit={ws.risk.maxWeeklyLoss} sub="Calendar week, not rolling 7 days" />
          </div>
          <Panel>
            <PanelHeader title="Risk monitoring" />
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <KV k="Current drawdown" v={<span className="num text-neg">{pct(s.currentDrawdownPct == null ? null : -s.currentDrawdownPct, 2)}</span>} sub={`limit ${ws.risk.maxDrawdownPct}%`} />
              <KV k="Max drawdown" v={<span className="num text-neg">{pct(s.maxDrawdownPct == null ? null : -s.maxDrawdownPct, 2)}</span>} />
              <KV k="Largest loss" v={<Pnl value={s.largestLoss} />} />
              <KV k="Consecutive losses" v={<span className="num">{s.consecutiveLosses}</span>} />
              <KV k="Risk-per-trade checks" v={<span className="num">{s.riskPerTrade.length ? `${within}/${s.riskPerTrade.length}` : "—"}</span>} sub={`within ${ws.risk.maxRiskPerTradePct}% of capital`} />
              <KV k="Discipline score" v={<span className="num metal-text text-xl">{s.score}</span>} sub="out of 100" />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Risk per completed trade" subtitle="Only trades with a recorded planned stop can be measured" />
            <div className="scroll-x px-4 pb-4">
              {s.riskPerTrade.length === 0 ? (
                <p className="py-3 text-xs text-text-3">No planned stops recorded yet. <Link href="/journal?filter=unjournaled" className="underline">Add them in the journal.</Link></p>
              ) : (
                <div className="flex min-w-[480px] items-end gap-[2px] pt-4" style={{ height: 140 }} role="img" aria-label="Risk per trade as percent of capital">
                  {s.riskPerTrade.slice(-80).map((r) => {
                    const max = Math.max(ws.risk.maxRiskPerTradePct * 2, ...s.riskPerTrade.map((x) => x.riskPct));
                    return <div key={r.tradeKey} title={`${r.riskPct}% of capital`} className="flex-1 rounded-t-[3px]" style={{ height: `${(r.riskPct / max) * 100}%`, background: r.withinLimit ? "#2f86d6" : "#d9532f" }} />;
                  })}
                </div>
              )}
              {s.riskPerTrade.length > 0 && <p className="mt-2 text-[11px] text-text-3"><span className="mr-1 inline-block size-2 rounded-sm bg-[#2f86d6]" /> within limit <span className="ml-3 mr-1 inline-block size-2 rounded-sm bg-[#d9532f]" /> above {ws.risk.maxRiskPerTradePct}% limit</p>}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Exposure concentration" subtitle="Share of total traded entry value" />
            <ul className="space-y-2.5 p-5">
              {s.concentration.map((c) => (
                <li key={c.symbol}>
                  <div className="flex justify-between text-xs"><span className="font-semibold">{c.symbol}</span><span className="num text-text-2">{c.sharePct}%</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-white/5"><div className="h-1.5 rounded-full bg-[#2f86d6]" style={{ width: `${c.sharePct}%` }} /></div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Your limits" subtitle="Used for alerts and the discipline score" />
            <div className="p-5"><RiskForm initial={ws.risk} mode={ws.mode} /></div>
          </Panel>
          <Panel>
            <PanelHeader title="Score breakdown" />
            <ul className="space-y-2 p-5 text-xs">
              {s.scoreBreakdown.map((b) => (
                <li key={b.label} className="flex justify-between gap-2"><span className="text-text-2">{b.label}</span><span className="num">{b.points}/{b.max}</span></li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Budget({ title, used, pnl, remaining, limit, sub }: { title: string; used: number; pnl: number; remaining: number; limit: number; sub: string }) {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">{title}</p>
        <Badge tone={used >= 100 ? "neg" : used >= 75 ? "warn" : "pos"}>{used >= 100 ? "Exceeded" : `${Math.round(used)}% used`}</Badge>
      </div>
      <div className="mt-2 flex items-baseline gap-2"><Pnl value={pnl} size="lg" /><span className="text-xs text-text-3">of −{inr(limit)}</span></div>
      <div className="mt-3 h-2 rounded-full bg-white/5"><div className={cn("h-2 rounded-full", used >= 100 ? "bg-[#d9532f]" : used >= 75 ? "bg-warn" : "bg-[#22a37a]")} style={{ width: `${used}%` }} /></div>
      <p className="mt-2 text-[11px] text-text-3">Remaining <span className="num text-text-2">{inr(remaining)}</span> · {sub}</p>
    </Panel>
  );
}

function KV({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wider text-text-3">{k}</p>
      <div className="mt-1 text-base font-semibold">{v}</div>
      {sub && <p className="text-[10.5px] text-text-3">{sub}</p>}
    </div>
  );
}
