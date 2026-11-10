"use client";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, inr, pct } from "@/lib/utils";
import { VIZ, axisProps } from "./theme";

/* eslint-disable @typescript-eslint/no-explicit-any */

function Tip({ active, payload, label, render }: any) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-line-2 bg-[#0e1117]/95 px-3 py-2 text-xs shadow-xl backdrop-blur">{render ? render(payload[0].payload, label) : null}</div>;
}

const tipRow = (k: string, v: React.ReactNode) => (
  <div className="flex justify-between gap-4">
    <span className="text-text-3">{k}</span>
    <span className="num font-semibold text-text">{v}</span>
  </div>
);

/** Horizontally scrollable frame so dense charts stay legible on phones. */
export function ChartFrame({ children, minWidth = 0, height = 240, className }: { children: React.ReactNode; minWidth?: number; height?: number; className?: string }) {
  return (
    <div className={cn("scroll-x -mx-1 px-1", className)}>
      <div style={{ minWidth, height }}>{children}</div>
    </div>
  );
}

export function EquityCurve({ data, startingCapital, height = 280 }: { data: { date: string; equity: number; cumulative: number; drawdown: number }[]; startingCapital: number; height?: number }) {
  const [mode, setMode] = useState<"cumulative" | "equity">("cumulative");
  const series = useMemo(() => [{ date: "start", equity: startingCapital, cumulative: 0, drawdown: 0 }, ...data], [data, startingCapital]);
  const last = series[series.length - 1]?.cumulative ?? 0;
  const color = last >= 0 ? VIZ.pos : VIZ.neg;
  return (
    <div>
      <div className="mb-2 flex justify-end gap-1" role="tablist" aria-label="Equity view">
        {(["cumulative", "equity"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("h-7 rounded-lg px-2.5 text-[11px] font-semibold", mode === m ? "bg-white/[0.08] text-text" : "text-text-3")}>
            {m === "cumulative" ? "Cumulative P&L" : "Account equity"}
          </button>
        ))}
      </div>
      <ChartFrame height={height}>
        <ResponsiveContainer>
          <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={VIZ.grid} vertical={false} />
            <XAxis dataKey="date" {...axisProps} minTickGap={40} tickFormatter={(d) => (d === "start" ? "" : d.slice(5))} />
            <YAxis {...axisProps} width={56} tickFormatter={(v) => inr(v, { compact: true, decimals: 0 })} domain={["auto", "auto"]} />
            {mode === "cumulative" && <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />}
            <Tooltip cursor={{ stroke: "rgba(255,255,255,0.2)" }} content={<Tip render={(p: any) => (<><p className="mb-1 font-semibold">{p.date === "start" ? "Start" : p.date}</p>{tipRow("Cumulative", inr(p.cumulative, { sign: true }))}{tipRow("Equity", inr(p.equity))}{tipRow("Drawdown", inr(-p.drawdown))}</>)} />} />
            <Area type="monotone" dataKey={mode} stroke={color} strokeWidth={2} fill="url(#eqFill)" animationDuration={1100} dot={false} activeDot={{ r: 4, stroke: VIZ.surface, strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

export function DrawdownChart({ data, height = 200 }: { data: { date: string; drawdown: number; drawdownPct: number | null }[]; height?: number }) {
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer>
        <AreaChart data={data.map((d) => ({ ...d, dd: -d.drawdown }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="date" {...axisProps} minTickGap={40} tickFormatter={(d) => d.slice(5)} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => inr(v, { compact: true, decimals: 0 })} />
          <Tooltip content={<Tip render={(p: any) => (<><p className="mb-1 font-semibold">{p.date}</p>{tipRow("Drawdown", inr(-p.drawdown))}{tipRow("From peak", p.drawdownPct == null ? "—" : pct(-p.drawdownPct, 2))}</>)} />} />
          <Area type="stepAfter" dataKey="dd" stroke={VIZ.neg} strokeWidth={2} fill={VIZ.neg} fillOpacity={0.15} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Signed bars: position above/below zero is the primary encoding; color is secondary. */
export function PnlBars({ data, height = 220, minWidth = 0, labelKey = "label" }: { data: { label: string; netPnl: number; trades?: number; winRate?: number | null }[]; height?: number; minWidth?: number; labelKey?: string }) {
  return (
    <ChartFrame height={height} minWidth={minWidth}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey={labelKey} {...axisProps} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => inr(v, { compact: true, decimals: 0 })} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip render={(p: any) => (<><p className="mb-1 font-semibold">{p[labelKey]}</p>{tipRow("Net P&L", inr(p.netPnl, { sign: true }))}{p.trades != null && tipRow("Trades", p.trades)}{p.winRate != null && tipRow("Win rate", pct(p.winRate))}</>)} />} />
          <Bar dataKey="netPnl" radius={[4, 4, 4, 4]} maxBarSize={36} animationDuration={800}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.netPnl >= 0 ? VIZ.pos : VIZ.neg} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function HorizontalPnl({ data, height }: { data: { label: string; netPnl: number; trades: number }[]; height?: number }) {
  const h = height ?? Math.max(160, data.length * 30 + 20);
  return (
    <div style={{ height: h }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid stroke={VIZ.grid} horizontal={false} />
          <XAxis type="number" {...axisProps} tickFormatter={(v) => inr(v, { compact: true, decimals: 0 })} />
          <YAxis type="category" dataKey="label" {...axisProps} width={92} tick={{ fill: "#a3a9b8", fontSize: 11 }} />
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.18)" />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip render={(p: any) => (<><p className="mb-1 font-semibold">{p.label}</p>{tipRow("Net P&L", inr(p.netPnl, { sign: true }))}{tipRow("Trades", p.trades)}</>)} />} />
          <Bar dataKey="netPnl" radius={4} maxBarSize={18}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.netPnl >= 0 ? VIZ.pos : VIZ.neg} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WinLossDonut({ wins, losses, breakevens }: { wins: number; losses: number; breakevens: number }) {
  const data = [
    { name: "Wins", value: wins, fill: VIZ.pos },
    { name: "Losses", value: losses, fill: VIZ.neg },
    { name: "Breakeven", value: breakevens, fill: "#5a6273" },
  ].filter((d) => d.value > 0);
  const total = wins + losses + breakevens;
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-[132px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={44} outerRadius={62} paddingAngle={2} stroke={VIZ.surface} strokeWidth={2} cornerRadius={4} animationDuration={900}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip content={<Tip render={(p: any) => tipRow(p.name, `${p.value} (${pct((p.value / total) * 100)})`)} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="num text-lg font-bold">{total}</p>
            <p className="text-[10px] uppercase tracking-wider text-text-3">trades</p>
          </div>
        </div>
      </div>
      <ul className="space-y-1.5 text-xs">
        {[
          ["Wins", wins, VIZ.pos],
          ["Losses", losses, VIZ.neg],
          ["Breakeven", breakevens, "#5a6273"],
        ].map(([l, v, c]) => (
          <li key={l as string} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: c as string }} aria-hidden />
            <span className="w-16 text-text-2">{l}</span>
            <span className="num font-semibold">{v as number}</span>
            <span className="num text-text-3">{total ? pct(((v as number) / total) * 100, 0) : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Histogram({ data, height = 220 }: { data: { from: number; to: number; count: number }[]; height?: number }) {
  const d = data.map((b) => ({ ...b, label: inr((b.from + b.to) / 2, { compact: true, decimals: 0 }), mid: (b.from + b.to) / 2 }));
  return (
    <ChartFrame height={height} minWidth={420}>
      <ResponsiveContainer>
        <BarChart data={d} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval={1} />
          <YAxis {...axisProps} width={32} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip render={(p: any) => (<>{tipRow("Range", `${inr(p.from)} to ${inr(p.to)}`)}{tipRow("Trades", p.count)}</>)} />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {d.map((b, i) => (
              <Cell key={i} fill={b.mid >= 0 ? VIZ.pos : VIZ.neg} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function RRScatter({ data, height = 240 }: { data: { risk: number; pnl: number; symbol: string; r: number }[]; height?: number }) {
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={VIZ.grid} />
          <XAxis type="number" dataKey="risk" name="Planned risk" {...axisProps} tickFormatter={(v) => inr(v, { compact: true, decimals: 0 })} />
          <YAxis type="number" dataKey="pnl" name="Net P&L" {...axisProps} width={56} tickFormatter={(v) => inr(v, { compact: true, decimals: 0 })} />
          <ZAxis range={[64, 64]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
          <Tooltip content={<Tip render={(p: any) => (<><p className="mb-1 font-semibold">{p.symbol}</p>{tipRow("Planned risk", inr(p.risk))}{tipRow("Net P&L", inr(p.pnl, { sign: true }))}{tipRow("Result", `${p.r.toFixed(2)}R`)}</>)} />} />
          <Scatter data={data} stroke={VIZ.surface} strokeWidth={2}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.pnl >= 0 ? VIZ.pos : VIZ.neg} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Monthly calendar heatmap with value + glyph in each cell (not color-only). */
export function PnlCalendar({ days, initialMonth }: { days: Record<string, { pnl: number; trades: number }>; initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth); // YYYY-MM
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const vals = Object.entries(days).filter(([d]) => d.startsWith(month)).map(([, v]) => Math.abs(v.pnl));
  const max = Math.max(1, ...vals);
  const monthTotal = Object.entries(days).filter(([d]) => d.startsWith(month)).reduce((a, [, v]) => a + v.pnl, 0);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => shift(-1)} className="grid size-9 place-items-center rounded-xl hover:bg-white/[0.06]" aria-label="Previous month"><ChevronLeft className="size-4" /></button>
        <div className="text-center">
          <p className="text-sm font-semibold">{first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
          <p className={cn("num text-xs", monthTotal > 0 ? "text-pos" : monthTotal < 0 ? "text-neg" : "text-text-3")}>{inr(monthTotal, { sign: true })}</p>
        </div>
        <button onClick={() => shift(1)} className="grid size-9 place-items-center rounded-xl hover:bg-white/[0.06]" aria-label="Next month"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-text-3">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="pb-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Daily P&L calendar">
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const key = `${month}-${String(d).padStart(2, "0")}`;
          const v = days[key];
          const a = v ? 0.12 + 0.55 * (Math.abs(v.pnl) / max) : 0;
          const bg = v ? (v.pnl >= 0 ? `rgba(34,163,122,${a})` : `rgba(217,83,47,${a})`) : "rgba(255,255,255,0.02)";
          return (
            <div key={i} role="gridcell" title={v ? `${key}: ${inr(v.pnl, { sign: true })}, ${v.trades} trades` : key} className="flex aspect-square min-h-[38px] flex-col justify-between rounded-lg border border-white/[0.04] p-1 text-left" style={{ background: bg }}>
              <span className="text-[10px] text-text-3">{d}</span>
              {v && (
                <span className="num truncate text-[9.5px] font-semibold leading-none text-text sm:text-[10.5px]">
                  {v.pnl >= 0 ? "▲" : "▼"}
                  {inr(Math.abs(v.pnl), { compact: true, decimals: 0 }).replace("₹", "")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Monthly return heatmap (years × months) — value printed in every cell. */
export function MonthlyHeatmap({ months }: { months: { key: string; netPnl: number }[] }) {
  const years = [...new Set(months.map((m) => m.key.slice(0, 4)))].sort();
  const max = Math.max(1, ...months.map((m) => Math.abs(m.netPnl)));
  const get = (y: string, i: number) => months.find((m) => m.key === `${y}-${String(i + 1).padStart(2, "0")}`);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="text-left font-semibold text-text-3">Year</th>
            {names.map((n) => <th key={n} className="font-semibold text-text-3">{n}</th>)}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y}>
              <td className="num pr-2 font-semibold text-text-2">{y}</td>
              {names.map((_, i) => {
                const v = get(y, i);
                const a = v ? 0.15 + 0.55 * (Math.abs(v.netPnl) / max) : 0;
                return (
                  <td key={i} className="num h-10 rounded-lg text-center text-[11px] font-semibold" style={{ background: v ? (v.netPnl >= 0 ? `rgba(34,163,122,${a})` : `rgba(217,83,47,${a})`) : "rgba(255,255,255,0.02)" }}>
                    {v ? inr(v.netPnl, { compact: true, sign: true, decimals: 1 }) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  const up = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Area type="monotone" dataKey="v" stroke={up ? VIZ.pos : VIZ.neg} strokeWidth={1.5} fill={up ? VIZ.pos : VIZ.neg} fillOpacity={0.12} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBars({ data, height = 220, valueKey, unit = "pct" }: { data: Record<string, any>[]; height?: number; valueKey: string; unit?: "pct" | "inr" | "num" }) {
  const format = (v: number) => (unit === "pct" ? `${Math.round(v)}%` : unit === "inr" ? inr(v, { compact: true, decimals: 0 }) : String(v));
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} width={44} tickFormatter={(v) => format(v)} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip render={(p: any) => (<><p className="mb-1 font-semibold">{p.full ?? p.label}</p>{tipRow(valueKey === "winRate" ? "Win rate" : valueKey, format(p[valueKey]))}{p.trades != null && tipRow("Trades", p.trades)}</>)} />} />
          <Bar dataKey={valueKey} radius={[4, 4, 0, 0]} fill={VIZ.cat[0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
