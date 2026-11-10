import { getWorkspace } from "@/lib/data/workspace";
import { filterTrades, parseRange } from "@/lib/data/range";
import { JournalList } from "@/components/journal/JournalList";
import { toLite } from "@/components/journal/TradeRow";
import { Badge, PageTitle, Panel, PanelHeader } from "@/components/ui/primitives";
import { fmtDateTime, inr } from "@/lib/utils";

export const metadata = { title: "Trading Journal" };

export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const range = parseRange(sp.range);
  const trades = filterTrades(ws.trades, range, ws.tz, ws.weekStart).map((t) => toLite(t, ws.journal.get(t.tradeKey)));
  return (
    <>
      <PageTitle kicker="Every completed trade, automatically" title="Trading Journal" />
      {ws.openPositions.length > 0 && (
        <Panel className="mb-4">
          <PanelHeader title="Open positions" subtitle="Not included in realized P&L until closed" />
          <div className="scroll-x px-4 pb-4 pt-2">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead className="text-left text-[10.5px] uppercase tracking-wider text-text-3">
                <tr>{["Instrument", "Side", "Open qty", "Avg cost (FIFO)", "Opened", "Realized so far"].map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {ws.openPositions.map((p) => (
                  <tr key={`${p.exchange}${p.tradingsymbol}${p.product}`} className="border-t border-line/60">
                    <td className="py-2 pr-3 font-semibold">{p.tradingsymbol} <span className="text-[10.5px] font-normal text-text-3">{p.exchange}·{p.product}</span></td>
                    <td className="pr-3"><Badge tone={p.direction === "LONG" ? "signal" : "brass"}>{p.direction}</Badge></td>
                    <td className="num pr-3">{p.openQuantity}</td>
                    <td className="num pr-3">{inr(p.avgCost)}</td>
                    <td className="num pr-3 text-text-2">{p.openedAt ? fmtDateTime(p.openedAt, ws.tz) : "—"}</td>
                    <td className="num pr-3 text-text-2">{ws.mode === "demo" ? inr(p.realizedSoFar, { sign: true }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-text-3">Unrealized P&L is not shown: TRADEOS does not stream live prices and never mixes mark-to-market into realized metrics.</p>
          </div>
        </Panel>
      )}
      <JournalList trades={trades} strategies={ws.strategies} tz={ws.tz} initialFilter={sp.filter} />
    </>
  );
}
