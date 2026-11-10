"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, type IChartApi, type ISeriesApi, type SeriesMarker, type Time } from "lightweight-charts";
import { AlertTriangle, Loader2, MessageSquarePlus, Pause, Play, RotateCcw, SkipForward, StepForward } from "lucide-react";
import { Badge, Button, Input, Pnl } from "@/components/ui/primitives";
import { cn, inr } from "@/lib/utils";

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface TradeInfo { tradeKey: string; symbol: string; direction: "LONG" | "SHORT"; quantity: number; avgEntry: number; avgExit: number; entryAt: string; exitAt: string; plannedStop: number | null; plannedTarget: number | null; netPnl: number }

/** lightweight-charts renders UTC; shift by +05:30 so the axis reads exchange (IST) time. */
const IST = 19800;
const T = (t: number) => (t + IST) as Time;

const INTERVALS = [
  { id: "1minute", label: "1m" },
  { id: "5minute", label: "5m" },
  { id: "15minute", label: "15m" },
  { id: "30minute", label: "30m" },
  { id: "day", label: "1D" },
];

export function ReplayChart({ trade }: { trade: TradeInfo }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [interval, setIntervalId] = useState("15minute");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [meta, setMeta] = useState<{ total: number; entryIndex: number; exitIndex: number; start: number; source: string } | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [notes, setNotes] = useState<{ at: number; text: string }[]>([]);
  const [note, setNote] = useState("");
  const busy = useRef(false);
  const priceLines = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
  const noteKey = `tradeos.replay.notes.${trade.tradeKey}`;

  const fetchUpTo = useCallback(
    async (count?: number) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const res = await fetch(`/api/market/candles?trade=${encodeURIComponent(trade.tradeKey)}&interval=${interval}${count ? `&count=${count}` : ""}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? "Failed to load candles");
        if (!d.candles.length) {
          setReason(d.reason ?? "Historical data unavailable.");
          setCandles([]);
          setMeta(null);
        } else {
          setReason(null);
          setCandles(d.candles);
          setMeta({ total: d.total, entryIndex: d.entryIndex, exitIndex: d.exitIndex, start: d.start, source: d.source });
        }
      } catch (e) {
        setReason((e as Error).message);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [trade.tradeKey, interval]
  );

  useEffect(() => {
    setLoading(true);
    setPlaying(false);
    fetchUpTo();
  }, [fetchUpTo]);

  useEffect(() => {
    try {
      setNotes(JSON.parse(localStorage.getItem(noteKey) ?? "[]"));
    } catch {
      /* ignore */
    }
  }, [noteKey]);

  // chart lifecycle
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a91a3", fontFamily: "var(--font-jetbrains)", fontSize: 11 },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
      localization: { timeFormatter: (t: number) => new Date(t * 1000).toLocaleString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) },
    });
    const s = c.addCandlestickSeries({ upColor: "#22a37a", downColor: "#d9532f", borderVisible: false, wickUpColor: "#22a37a", wickDownColor: "#d9532f" });
    chart.current = c;
    series.current = s;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      priceLines.current = [];
    };
  }, []);

  // data + overlays
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.setData(candles.map((c) => ({ ...c, time: T(c.time) })));
    for (const l of priceLines.current) s.removePriceLine(l);
    const lines: ReturnType<typeof s.createPriceLine>[] = [];
    if (meta && candles.length > meta.entryIndex) {
      lines.push(s.createPriceLine({ price: trade.avgEntry, color: "#7cc4ff", lineWidth: 1, lineStyle: 2, title: "Entry" }));
      if (trade.plannedStop) lines.push(s.createPriceLine({ price: trade.plannedStop, color: "#d9532f", lineWidth: 1, lineStyle: 1, title: "Stop" }));
      if (trade.plannedTarget) lines.push(s.createPriceLine({ price: trade.plannedTarget, color: "#22a37a", lineWidth: 1, lineStyle: 1, title: "Target" }));
    }
    priceLines.current = lines;
    const markers: SeriesMarker<Time>[] = [];
    if (meta && candles.length > meta.entryIndex)
      markers.push({ time: T(candles[meta.entryIndex].time), position: trade.direction === "LONG" ? "belowBar" : "aboveBar", color: "#7cc4ff", shape: trade.direction === "LONG" ? "arrowUp" : "arrowDown", text: `${trade.direction === "LONG" ? "BUY" : "SELL"} ${trade.quantity} @ ${trade.avgEntry}` });
    if (meta && candles.length > meta.exitIndex)
      markers.push({ time: T(candles[meta.exitIndex].time), position: trade.direction === "LONG" ? "aboveBar" : "belowBar", color: "#d6b77d", shape: trade.direction === "LONG" ? "arrowDown" : "arrowUp", text: `EXIT @ ${trade.avgExit}` });
    s.setMarkers(markers);
    chart.current?.timeScale().scrollToRealTime();
  }, [candles, meta, trade]);

  const step = useCallback(() => {
    if (!meta || candles.length >= meta.total) {
      setPlaying(false);
      return;
    }
    fetchUpTo(candles.length + 1);
  }, [meta, candles.length, fetchUpTo]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(step, 650);
    return () => window.clearInterval(id);
  }, [playing, step]);

  const last = candles[candles.length - 1];
  const inPosition = meta && candles.length - 1 >= meta.entryIndex && candles.length - 1 < meta.exitIndex;
  const closed = meta && candles.length - 1 >= meta.exitIndex;
  const unreal = inPosition && last ? (last.close - trade.avgEntry) * trade.quantity * (trade.direction === "LONG" ? 1 : -1) : null;

  const addNote = () => {
    if (!note.trim() || !last) return;
    const next = [...notes, { at: last.time, text: note.trim().slice(0, 500) }];
    setNotes(next);
    setNote("");
    try {
      localStorage.setItem(noteKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line-2 p-0.5" role="radiogroup" aria-label="Interval">
          {INTERVALS.map((i) => (
            <button key={i.id} role="radio" aria-checked={interval === i.id} onClick={() => setIntervalId(i.id)} className={cn("num h-8 rounded-lg px-3 text-xs font-semibold", interval === i.id ? "bg-white/[0.09] text-text" : "text-text-3", (i.id === "15minute" || i.id === "30minute") && interval !== i.id && "text-text-2")}>
              {i.label}
            </button>
          ))}
        </div>
        {meta?.source === "synthetic_demo" && <Badge tone="warn">Synthetic demo candles — not real market data</Badge>}
        {meta?.source === "licensed" && <Badge tone="pos">Kite historical data</Badge>}
      </div>

      <div className="relative">
        <div ref={el} className="h-[360px] w-full sm:h-[440px]" />
        {(loading || reason) && (
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-[#0b0d12]/80 p-6 text-center">
            {loading ? (
              <Loader2 className="size-5 animate-spin text-text-3" />
            ) : (
              <div className="max-w-sm">
                <AlertTriangle className="mx-auto mb-2 size-6 text-warn" />
                <p className="text-sm font-semibold">Historical candles unavailable</p>
                <p className="mt-1 text-xs leading-relaxed text-text-3">{reason} TRADEOS never draws fabricated candles for real trades.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {meta && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="md" variant="primary" onClick={() => setPlaying((p) => !p)} disabled={candles.length >= meta.total} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />} {playing ? "Pause" : "Play"}
            </Button>
            <Button size="md" onClick={step} disabled={candles.length >= meta.total || playing} aria-label="Next candle"><StepForward className="size-4" /> Next</Button>
            <Button size="md" variant="ghost" onClick={() => fetchUpTo(Math.min(meta.total, meta.exitIndex + 1))} disabled={playing || candles.length > meta.exitIndex} aria-label="Jump to exit"><SkipForward className="size-4" /> To exit</Button>
            <Button size="md" variant="ghost" onClick={() => { setPlaying(false); fetchUpTo(meta.start); }} aria-label="Restart"><RotateCcw className="size-4" /></Button>
            <div className="ml-auto h-1.5 w-full overflow-hidden rounded-full bg-white/5 sm:w-48" aria-label="Replay progress">
              <div className="h-full bg-brass/70 transition-all" style={{ width: `${(candles.length / meta.total) * 100}%` }} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Info k="Bar" v={<span className="num">{candles.length} / {meta.total}</span>} />
            <Info k="Last close" v={<span className="num">{last ? inr(last.close) : "—"}</span>} />
            <Info k="Status" v={closed ? <Badge tone="neutral">Closed</Badge> : inPosition ? <Badge tone="signal">In position</Badge> : <Badge tone="neutral">Before entry</Badge>} />
            <Info k={closed ? "Realized (net)" : "Unrealized (gross, at close)"} v={closed ? <Pnl value={trade.netPnl} /> : unreal != null ? <Pnl value={Math.round(unreal * 100) / 100} /> : <span className="text-text-3">—</span>} />
          </div>
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">Decision notes</p>
            <div className="flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What would you do at this candle?" maxLength={500} onKeyDown={(e) => e.key === "Enter" && addNote()} />
              <Button onClick={addNote} aria-label="Add note"><MessageSquarePlus className="size-4" /></Button>
            </div>
            <ul className="mt-2 space-y-1">
              {notes.map((n, i) => (
                <li key={i} className="text-xs text-text-2"><span className="num text-text-3">{new Date(n.at * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</span> — {n.text}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-text-3">{k}</p>
      <div className="mt-1 font-semibold">{v}</div>
    </div>
  );
}
