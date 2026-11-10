import type { ClosedTrade } from "@/lib/engine/types";
import { addDays, calendarWeek, localDate, DEFAULT_TZ } from "@/lib/engine/time";

export const RANGES = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "month", label: "This month" },
  { id: "90d", label: "90D" },
  { id: "ytd", label: "YTD" },
  { id: "all", label: "All" },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

export function parseRange(v: string | string[] | undefined): RangeId {
  const s = Array.isArray(v) ? v[0] : v;
  return (RANGES.find((r) => r.id === s)?.id ?? "90d") as RangeId;
}

/** Inclusive local-date bounds. "week"/"month" are CALENDAR periods; "7d"/"30d" are rolling. */
export function rangeBounds(range: RangeId, now = new Date(), tz = DEFAULT_TZ, weekStart = 1): { from: string | null; to: string } {
  const today = localDate(now, tz);
  switch (range) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: calendarWeek(now, tz, weekStart).start, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: null, to: today };
  }
}

export function filterTrades(trades: ClosedTrade[], range: RangeId, tz = DEFAULT_TZ, weekStart = 1, now = new Date()) {
  const { from, to } = rangeBounds(range, now, tz, weekStart);
  return trades.filter((t) => {
    const d = localDate(t.exitAt, tz);
    return (!from || d >= from) && d <= to;
  });
}
