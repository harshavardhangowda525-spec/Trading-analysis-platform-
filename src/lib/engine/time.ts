/**
 * Timezone helpers. All reporting buckets are computed in the user's timezone
 * (default Asia/Kolkata) using Intl, never the server's local timezone.
 */

export const DEFAULT_TZ = "Asia/Kolkata";

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(iso: string | Date, tz = DEFAULT_TZ): Parts {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(d)) p[x.type] = x.value;
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    weekday: WD[p.weekday],
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar date (YYYY-MM-DD) of an instant in tz. */
export function localDate(iso: string | Date, tz = DEFAULT_TZ): string {
  const p = zonedParts(iso, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localMonth(iso: string | Date, tz = DEFAULT_TZ): string {
  return localDate(iso, tz).slice(0, 7);
}

/** Pure calendar arithmetic on YYYY-MM-DD strings (timezone independent). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Start (YYYY-MM-DD) of the calendar week containing `date`. weekStart: 0=Sun,1=Mon. */
export function weekStartOf(date: string, weekStart = 1): string {
  const wd = weekdayOf(date);
  const diff = (wd - weekStart + 7) % 7;
  return addDays(date, -diff);
}

/** Calendar week (not rolling 7 days) of the instant, in tz. */
export function calendarWeek(iso: string | Date, tz = DEFAULT_TZ, weekStart = 1) {
  const start = weekStartOf(localDate(iso, tz), weekStart);
  return { start, end: addDays(start, 6) };
}

/** Convert a local wall-clock time in tz to a UTC ISO string. */
export function zonedToUtc(date: string, time = "00:00:00", tz = DEFAULT_TZ): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
  // offset = local(guess) - guess
  const p = zonedParts(new Date(guess), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, ss || 0);
  const offset = asUtc - guess;
  return new Date(guess - offset).toISOString();
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** NSE cash session buckets in IST. */
export function sessionOf(iso: string, tz = DEFAULT_TZ): "Opening" | "Midday" | "Closing" | "Off-hours" {
  const p = zonedParts(iso, tz);
  const mins = p.hour * 60 + p.minute;
  if (mins >= 555 && mins < 630) return "Opening"; // 09:15-10:30
  if (mins >= 630 && mins < 810) return "Midday"; // 10:30-13:30
  if (mins >= 810 && mins <= 930) return "Closing"; // 13:30-15:30
  return "Off-hours";
}
