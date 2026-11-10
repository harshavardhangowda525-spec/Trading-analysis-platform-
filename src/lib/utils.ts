import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export function inr(n: number | null | undefined, opts: { sign?: boolean; compact?: boolean; decimals?: number } = {}) {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  const d = opts.decimals ?? (opts.compact && a >= 1000 ? 1 : 2);
  let body: string;
  if (opts.compact && a >= 1e7) body = `${(a / 1e7).toFixed(d)}Cr`;
  else if (opts.compact && a >= 1e5) body = `${(a / 1e5).toFixed(d)}L`;
  else if (opts.compact && a >= 1e3) body = `${(a / 1e3).toFixed(d)}K`;
  else body = a.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}₹${body}`;
}

export const pct = (n: number | null | undefined, d = 1, sign = false) =>
  n == null || Number.isNaN(n) ? "—" : `${n < 0 ? "−" : sign && n > 0 ? "+" : ""}${Math.abs(n).toFixed(d)}%`;

export function duration(s: number | null | undefined) {
  if (s == null) return "—";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export function fmtDateTime(iso: string, tz = "Asia/Kolkata") {
  return new Date(iso).toLocaleString("en-IN", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function fmtDate(iso: string, tz = "Asia/Kolkata") {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: tz, day: "2-digit", month: "short", year: "numeric" });
}
export function relTime(iso: string | null) {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
