import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, Pnl } from "@/components/ui/primitives";
import { cn, duration, fmtDateTime, inr, pct } from "@/lib/utils";

export interface TradeLite {
  tradeKey: string;
  tradingsymbol: string;
  exchange: string;
  direction: "LONG" | "SHORT";
  product: string;
  quantity: number;
  avgEntry: number;
  avgExit: number;
  entryAt: string;
  exitAt: string;
  grossPnl: number;
  netPnl: number;
  returnPct: number;
  holdingSeconds: number;
  outcome: "win" | "loss" | "breakeven";
  costStatus: "estimated" | "verified";
  isDemo: boolean;
  strategy?: string | null;
  journaled?: boolean;
}

export function OutcomeBadge({ outcome }: { outcome: TradeLite["outcome"] }) {
  return <Badge tone={outcome === "win" ? "pos" : outcome === "loss" ? "neg" : "neutral"}>{outcome === "win" ? "Win" : outcome === "loss" ? "Loss" : "Breakeven"}</Badge>;
}

export function TradeRow({ t, tz = "Asia/Kolkata" }: { t: TradeLite; tz?: string }) {
  return (
    <Link href={`/journal/${encodeURIComponent(t.tradeKey)}`} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.035]">
      <div className={cn("grid size-9 shrink-0 place-items-center rounded-xl border text-[10px] font-bold", t.direction === "LONG" ? "border-signal/20 bg-signal/10 text-signal" : "border-brass/25 bg-brass/10 text-brass")} aria-label={t.direction}>
        {t.direction === "LONG" ? "L" : "S"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold">{t.tradingsymbol}</span>
          <span className="text-[10.5px] text-text-3">{t.exchange} · {t.product}</span>
        </div>
        <p className="num truncate text-[11px] text-text-3">
          {t.quantity} × {inr(t.avgEntry)} → {inr(t.avgExit)} · {duration(t.holdingSeconds)} · {fmtDateTime(t.exitAt, tz)}
        </p>
      </div>
      <div className="text-right">
        <Pnl value={t.netPnl} />
        <p className={cn("num text-[11px]", t.returnPct >= 0 ? "text-pos/80" : "text-neg/80")}>{pct(t.returnPct, 2, true)}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

export function toLite(t: import("@/lib/engine/types").ClosedTrade, j?: import("@/lib/engine/types").JournalEntry | null): TradeLite {
  return {
    tradeKey: t.tradeKey,
    tradingsymbol: t.tradingsymbol,
    exchange: t.exchange,
    direction: t.direction,
    product: t.product,
    quantity: t.quantity,
    avgEntry: t.avgEntry,
    avgExit: t.avgExit,
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    grossPnl: t.grossPnl,
    netPnl: t.netPnl,
    returnPct: t.returnPct,
    holdingSeconds: t.holdingSeconds,
    outcome: t.outcome,
    costStatus: t.costStatus,
    isDemo: t.isDemo,
    strategy: j?.strategy ?? null,
    journaled: !!j,
  };
}
