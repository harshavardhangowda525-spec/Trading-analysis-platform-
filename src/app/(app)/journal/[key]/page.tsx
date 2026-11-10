import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BrainCircuit, PlayCircle, Receipt } from "lucide-react";
import { findTrade, getWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { plannedRisk } from "@/lib/engine/metrics";
import type { TradeLeg } from "@/lib/engine/types";
import { Badge, PageTitle, Panel, PanelHeader, Pnl, Pct, Provenance, buttonClass } from "@/components/ui/primitives";
import { JournalEditor } from "@/components/journal/JournalEditor";
import { ReviewPanel } from "@/components/intelligence/ReviewPanel";
import { OutcomeBadge } from "@/components/journal/TradeRow";
import { cn, duration, fmtDateTime, inr } from "@/lib/utils";

export const metadata = { title: "Trade" };

const COST_LABEL: Record<string, string> = { brokerage: "Brokerage", stt: "STT", exchange_txn: "Exchange txn", sebi: "SEBI fee", gst: "GST", stamp_duty: "Stamp duty", dp: "DP charges", other: "Other" };

export default async function TradePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const tradeKey = decodeURIComponent(key);
  const ws = await getWorkspace();
  const t = findTrade(ws, tradeKey);
  if (!t) notFound();
  const j = ws.journal.get(tradeKey) ?? null;

  let legs: TradeLeg[] = t.legs;
  let attachments: { path: string; url: string | null }[] = [];
  if (ws.mode === "live") {
    const sb = await createClient();
    const ids = t.executionIds.map((x) => x.split(":").slice(1).join(":"));
    const { data } = await sb.from("raw_executions").select("broker_trade_id, broker_order_id, side, quantity, price, executed_at").eq("exchange", t.exchange).in("broker_trade_id", ids).order("executed_at");
    legs = (data ?? []).map((r) => ({
      executionId: `${t.exchange}:${r.broker_trade_id}`,
      brokerOrderId: r.broker_order_id,
      side: r.side,
      quantity: Number(r.quantity),
      price: Number(r.price),
      executedAt: r.executed_at,
      role: (r.side === "BUY") === (t.direction === "LONG") ? "entry" : "exit",
    }));
    const { data: je } = await sb.from("journal_entries").select("id, journal_attachments(storage_path)").eq("trade_key", tradeKey).maybeSingle();
    const paths = ((je?.journal_attachments as { storage_path: string }[] | undefined) ?? []).map((a) => a.storage_path);
    if (paths.length) {
      const { data: signed } = await sb.storage.from("journal-attachments").createSignedUrls(paths, 3600);
      attachments = (signed ?? []).map((s) => ({ path: s.path ?? "", url: s.signedUrl }));
    }
  }
  const risk = plannedRisk(t, j);
  const costs = t.verifiedCosts ?? t.estCosts;

  const facts: [string, React.ReactNode][] = [
    ["Exchange", t.exchange],
    ["Product", t.product],
    ["Direction", <Badge key="d" tone={t.direction === "LONG" ? "signal" : "brass"}>{t.direction}</Badge>],
    ["Outcome", <OutcomeBadge key="o" outcome={t.outcome} />],
    ["Entry", fmtDateTime(t.entryAt, ws.tz)],
    ["Exit", fmtDateTime(t.exitAt, ws.tz)],
    ["Quantity", t.quantity],
    ["Holding period", duration(t.holdingSeconds)],
    ["Avg entry", inr(t.avgEntry)],
    ["Avg exit", inr(t.avgExit)],
    ["Entry value", inr(t.avgEntry * t.quantity)],
    ["Return", <Pct key="r" value={t.returnPct} />],
    ["Strategy", j?.strategy ?? "—"],
    ["Risk : reward", risk ? `${(t.netPnl / risk).toFixed(2)}R` : "Needs planned stop"],
  ];

  return (
    <>
      <Link href="/journal" className="mb-3 inline-flex items-center gap-1.5 text-xs text-text-3 hover:text-text"><ArrowLeft className="size-3.5" /> Journal</Link>
      <PageTitle kicker={`${t.exchange} · ${t.product} · ${t.direction}`} title={t.tradingsymbol}>
        <div className="flex gap-2">
          <Link href={`/replay?trade=${encodeURIComponent(t.tradeKey)}`} className={buttonClass("outline", "md")}><PlayCircle className="size-4" /> Replay</Link>
        </div>
      </PageTitle>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Panel>
            <div className="flex flex-wrap items-end justify-between gap-4 p-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Net P&L</p>
                <Pnl value={t.netPnl} size="xl" />
                <p className="mt-1 text-xs text-text-3">Gross <span className="num text-text-2">{inr(t.grossPnl, { sign: true })}</span> − charges <span className="num text-text-2">{inr(costs)}</span> <Provenance kind={t.costStatus} /></p>
              </div>
              <div className="flex gap-2">
                <Provenance kind={t.isDemo ? "demo" : "auto"} />
              </div>
            </div>
            <div className="hairline" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 sm:grid-cols-3">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10.5px] uppercase tracking-wider text-text-3">{k}</dt>
                  <dd className="num mt-0.5 text-[13px] font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title="Executions" subtitle="Original broker fills — preserved unmodified" action={<Provenance kind={t.isDemo ? "demo" : "auto"} />} />
            <div className="scroll-x px-4 pb-4 pt-2">
              <table className="w-full min-w-[480px] text-[12.5px]">
                <thead className="text-left text-[10.5px] uppercase tracking-wider text-text-3">
                  <tr>{["Time", "Role", "Side", "Qty", "Price", "Order"].map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {legs.map((l, i) => (
                    <tr key={i} className="border-t border-line/60">
                      <td className="num py-2 pr-3 text-text-2">{fmtDateTime(l.executedAt, ws.tz)}</td>
                      <td className="pr-3"><Badge tone={l.role === "entry" ? "signal" : "neutral"}>{l.role}</Badge></td>
                      <td className={cn("pr-3 font-semibold", l.side === "BUY" ? "text-signal" : "text-brass")}>{l.side}</td>
                      <td className="num pr-3">{l.quantity}</td>
                      <td className="num pr-3">{inr(l.price)}</td>
                      <td className="num pr-3 text-[11px] text-text-3">{l.brokerOrderId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel>
            <PanelHeader icon={<Receipt className="size-4" />} title="Charges" subtitle={t.costStatus === "verified" ? "From contract note" : "Estimated from fee schedule — not exact"} action={<Provenance kind={t.costStatus} />} />
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2 p-5 text-[13px] sm:grid-cols-3">
              {t.costs.map((c) => (
                <li key={c.component} className="flex justify-between gap-2">
                  <span className="text-text-3">{COST_LABEL[c.component] ?? c.component}</span>
                  <span className="num">{inr(c.amount)}</span>
                </li>
              ))}
              <li className="col-span-full mt-1 flex justify-between border-t border-line pt-2 font-semibold">
                <span>Total</span>
                <span className="num">{inr(costs)}</span>
              </li>
            </ul>
          </Panel>

          <Panel>
            <PanelHeader icon={<BrainCircuit className="size-4" />} title="TRADEOS Intelligence" subtitle="Evidence-based review — facts, hypotheses, gaps and experiments" />
            <div className="p-5">
              <ReviewPanel tradeKey={t.tradeKey} mode={ws.mode} />
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <Panel className="lg:sticky lg:top-20">
            <PanelHeader title="Your journal" subtitle="Your inputs are kept separate from automatic data" />
            <div className="p-5">
              <JournalEditor tradeKey={t.tradeKey} initial={j} strategies={ws.strategies} mode={ws.mode} attachments={attachments} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
