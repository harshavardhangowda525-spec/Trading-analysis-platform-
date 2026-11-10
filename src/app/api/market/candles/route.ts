import { fail, json, withWorkspace } from "@/lib/api";
import { findTrade } from "@/lib/data/workspace";
import { candlesForTrade, INTERVALS, type CandleResult, type Interval } from "@/lib/market/candles";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; v: CandleResult }>();

/**
 * Replay candles. The response contains ONLY candles up to `count` (the replay
 * cursor) so future price action is never sent to the client during an exercise.
 */
export async function GET(req: Request) {
  const r = await withWorkspace();
  if ("res" in r) return r.res;
  const u = new URL(req.url);
  const key = u.searchParams.get("trade") ?? "";
  const interval = (u.searchParams.get("interval") ?? "15minute") as Interval;
  if (!INTERVALS.includes(interval)) return fail("Unsupported interval");
  const t = findTrade(r.ws, key);
  if (!t) return fail("Trade not found", 404);

  const ck = `${r.ws.userId ?? "demo"}|${key}|${interval}`;
  let res = cache.get(ck);
  if (!res || Date.now() - res.at > 10 * 60_000) {
    res = { at: Date.now(), v: await candlesForTrade(t, interval, r.ws.userId) };
    cache.set(ck, res);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  const all = res.v.candles;
  if (!all) return json({ candles: [], total: 0, source: res.v.source, reason: res.v.reason ?? "No historical data available." });

  const entryT = Date.parse(t.entryAt) / 1000;
  const exitT = Date.parse(t.exitAt) / 1000;
  let entryIndex = 0;
  let exitIndex = 0;
  all.forEach((c, i) => {
    if (c.time <= entryT) entryIndex = i;
    if (c.time <= exitT) exitIndex = i;
  });
  const start = Math.max(1, entryIndex - 3);
  const count = Math.min(all.length, Math.max(start, Number(u.searchParams.get("count")) || start));
  return json({
    candles: all.slice(0, count),
    total: all.length,
    entryIndex,
    exitIndex: Math.max(exitIndex, entryIndex),
    start,
    source: res.v.source,
  });
}
