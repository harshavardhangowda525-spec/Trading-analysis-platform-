"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { Badge, Input, Pnl, Select, buttonClass } from "@/components/ui/primitives";
import { cn, duration, fmtDateTime, inr, pct } from "@/lib/utils";
import { OutcomeBadge, type TradeLite } from "./TradeRow";

export function JournalList({ trades, strategies, tz, initialFilter }: { trades: TradeLite[]; strategies: string[]; tz: string; initialFilter?: string }) {
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [strategy, setStrategy] = useState("all");
  const [journal, setJournal] = useState(initialFilter === "unjournaled" ? "missing" : "all");
  const [sort, setSort] = useState("recent");
  const [open, setOpen] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toUpperCase();
    let l = trades.filter(
      (t) =>
        (!s || t.tradingsymbol.includes(s) || (t.strategy ?? "").toUpperCase().includes(s)) &&
        (outcome === "all" || t.outcome === outcome) &&
        (strategy === "all" || (strategy === "none" ? !t.strategy : t.strategy === strategy)) &&
        (journal === "all" || (journal === "missing" ? !t.journaled : t.journaled))
    );
    l = [...l].sort((a, b) => (sort === "best" ? b.netPnl - a.netPnl : sort === "worst" ? a.netPnl - b.netPnl : b.exitAt.localeCompare(a.exitAt)));
    return l;
  }, [trades, q, outcome, strategy, journal, sort]);

  const total = list.reduce((a, t) => a + t.netPnl, 0);

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" aria-hidden />
          <Input aria-label="Search trades" placeholder="Search symbol or strategy" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <button onClick={() => setShowFilters((v) => !v)} className={cn(buttonClass("outline"), "md:hidden")} aria-expanded={showFilters} aria-label="Filters">
          <SlidersHorizontal className="size-4" />
        </button>
      </div>
      <div className={cn("mb-4 grid grid-cols-2 gap-2 md:grid-cols-4", !showFilters && "hidden md:grid")}>
        <Select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="all">All outcomes</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="breakeven">Breakeven</option>
        </Select>
        <Select aria-label="Strategy" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
          <option value="all">All strategies</option>
          <option value="none">Unassigned</option>
          {strategies.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select aria-label="Journal status" value={journal} onChange={(e) => setJournal(e.target.value)}>
          <option value="all">Journaled + not</option>
          <option value="missing">Missing journal</option>
          <option value="done">Journaled</option>
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Most recent</option>
          <option value="best">Best P&L</option>
          <option value="worst">Worst P&L</option>
        </Select>
      </div>
      <p className="mb-2 px-1 text-xs text-text-3">
        {list.length} trades · net <span className={cn("num", total >= 0 ? "text-pos" : "text-neg")}>{inr(total, { sign: true })}</span>
      </p>

      {/* desktop table */}
      <div className="glass hidden overflow-hidden rounded-2xl md:block">
        <table className="w-full text-[13px]">
          <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-wider text-text-3">
            <tr>
              {["Instrument", "Side", "Entry", "Exit", "Qty", "Avg in → out", "Hold", "Strategy", "Net P&L", "Return", ""].map((h) => <th key={h} className="px-3 py-3 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 400).map((t) => (
              <tr key={t.tradeKey} className="border-b border-line/50 hover:bg-white/[0.025]">
                <td className="px-3 py-2.5">
                  <Link href={`/journal/trade?key=${encodeURIComponent(t.tradeKey)}`} className="font-semibold hover:text-brass">{t.tradingsymbol}</Link>
                  <span className="ml-1.5 text-[10.5px] text-text-3">{t.exchange}·{t.product}</span>
                </td>
                <td className="px-3"><Badge tone={t.direction === "LONG" ? "signal" : "brass"}>{t.direction}</Badge></td>
                <td className="num px-3 text-text-2">{fmtDateTime(t.entryAt, tz)}</td>
                <td className="num px-3 text-text-2">{fmtDateTime(t.exitAt, tz)}</td>
                <td className="num px-3">{t.quantity}</td>
                <td className="num px-3 text-text-2">{inr(t.avgEntry)} → {inr(t.avgExit)}</td>
                <td className="num px-3 text-text-2">{duration(t.holdingSeconds)}</td>
                <td className="px-3 text-text-2">{t.strategy ?? <span className="text-text-3">—</span>}</td>
                <td className="px-3"><Pnl value={t.netPnl} /></td>
                <td className={cn("num px-3", t.returnPct >= 0 ? "text-pos" : "text-neg")}>{pct(t.returnPct, 2, true)}</td>
                <td className="px-3">{!t.journaled && <Badge tone="warn">No notes</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 400 && <p className="p-3 text-center text-xs text-text-3">Showing 400 of {list.length}. Refine filters to see more.</p>}
      </div>

      {/* mobile expandable cards */}
      <ul className="space-y-2 md:hidden">
        {list.slice(0, 200).map((t) => {
          const isOpen = open === t.tradeKey;
          return (
            <li key={t.tradeKey} className="glass overflow-hidden rounded-2xl">
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(isOpen ? null : t.tradeKey)} aria-expanded={isOpen}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{t.tradingsymbol}</span>
                    <Badge tone={t.direction === "LONG" ? "signal" : "brass"}>{t.direction}</Badge>
                    {!t.journaled && <span className="size-1.5 rounded-full bg-warn" aria-label="Missing journal" />}
                  </div>
                  <p className="num mt-0.5 text-[11px] text-text-3">{fmtDateTime(t.exitAt, tz)} · {duration(t.holdingSeconds)}</p>
                </div>
                <div className="text-right">
                  <Pnl value={t.netPnl} />
                  <p className={cn("num text-[11px]", t.returnPct >= 0 ? "text-pos/80" : "text-neg/80")}>{pct(t.returnPct, 2, true)}</p>
                </div>
                <ChevronDown className={cn("size-4 text-text-3 transition-transform", isOpen && "rotate-180")} aria-hidden />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="grid grid-cols-2 gap-3 border-t border-line px-4 py-3 text-xs">
                      <KV k="Qty" v={t.quantity} />
                      <KV k="Outcome" v={<OutcomeBadge outcome={t.outcome} />} />
                      <KV k="Avg entry" v={inr(t.avgEntry)} />
                      <KV k="Avg exit" v={inr(t.avgExit)} />
                      <KV k="Gross" v={<Pnl value={t.grossPnl} size="sm" />} />
                      <KV k="Strategy" v={t.strategy ?? "—"} />
                    </div>
                    <div className="px-4 pb-4">
                      <Link href={`/journal/trade?key=${encodeURIComponent(t.tradeKey)}`} className={cn(buttonClass("subtle", "md"), "w-full")}>Open trade & journal</Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wider text-text-3">{k}</p>
      <div className="num mt-0.5 font-medium">{v}</div>
    </div>
  );
}
