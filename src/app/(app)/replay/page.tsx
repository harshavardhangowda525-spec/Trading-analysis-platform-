import Link from "next/link";
import { getWorkspace } from "@/lib/data/workspace";
import { ReplayChart } from "@/components/replay/ReplayChart";
import { Empty, PageTitle, Panel, PanelHeader, Pnl } from "@/components/ui/primitives";
import { cn, fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Trade Replay" };

export default async function ReplayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const recent = [...ws.trades].reverse().slice(0, 40);
  const t = ws.trades.find((x) => x.tradeKey === sp.trade) ?? recent[0];
  if (!t) return (<><PageTitle title="Trade Replay" /><Panel><Empty title="No trades to replay" /></Panel></>);
  const j = ws.journal.get(t.tradeKey);
  return (
    <>
      <PageTitle kicker="Candle-by-candle, no future leakage" title="Trade Replay" />
      <div className="grid gap-4 lg:grid-cols-4">
        <Panel className="lg:col-span-3">
          <PanelHeader title={`${t.tradingsymbol} · ${t.direction}`} subtitle={`${fmtDateTime(t.entryAt, ws.tz)} → ${fmtDateTime(t.exitAt, ws.tz)} · ${t.quantity} qty`} action={<Pnl value={t.netPnl} />} />
          <div className="p-3 sm:p-5">
            <ReplayChart
              key={t.tradeKey}
              trade={{ tradeKey: t.tradeKey, symbol: t.tradingsymbol, direction: t.direction, quantity: t.quantity, avgEntry: t.avgEntry, avgExit: t.avgExit, entryAt: t.entryAt, exitAt: t.exitAt, plannedStop: j?.plannedStop ?? null, plannedTarget: j?.plannedTarget ?? null, netPnl: t.netPnl }}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Choose a trade" />
          <ul className="max-h-[70vh] overflow-y-auto px-2 pb-3 pt-1">
            {recent.map((x) => (
              <li key={x.tradeKey}>
                <Link href={`/replay?trade=${encodeURIComponent(x.tradeKey)}`} className={cn("flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[13px] hover:bg-white/[0.04]", x.tradeKey === t.tradeKey && "bg-white/[0.06]")}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{x.tradingsymbol}</span>
                    <span className="num block text-[11px] text-text-3">{fmtDateTime(x.exitAt, ws.tz)}</span>
                  </span>
                  <Pnl value={x.netPnl} size="sm" compact />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
