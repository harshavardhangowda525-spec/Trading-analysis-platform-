import "server-only";
import { demoCandles, INTERVAL_MIN, type Candle } from "@/lib/demo/generate";
import type { ClosedTrade } from "@/lib/engine/types";
import { addDays, localDate } from "@/lib/engine/time";
import { serverEnv } from "@/lib/env";
import { KiteApiError, KiteClient } from "@/lib/kite/client";
import { decryptSecret } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type Interval = keyof typeof INTERVAL_MIN;
export const INTERVALS: Interval[] = ["1minute", "5minute", "15minute", "30minute", "day"];

export interface CandleResult {
  candles: Candle[] | null;
  source: "licensed" | "synthetic_demo" | "none";
  reason?: string;
}

/**
 * Historical candles for a trade. Demo trades get clearly labelled synthetic candles.
 * Live trades use Kite's historical API (requires the paid historical-data add-on);
 * if unavailable we return null with a reason — never fabricated candles.
 */
export async function candlesForTrade(t: ClosedTrade, interval: Interval, userId: string | null): Promise<CandleResult> {
  if (t.isDemo) return { candles: demoCandles(t.entryAt, t.exitAt, t.avgEntry, t.avgExit, interval, t.tradeKey + interval), source: "synthetic_demo" };
  const env = serverEnv();
  if (!userId || !env.serviceRoleKey || !env.kiteApiKey) return { candles: null, source: "none", reason: "Zerodha connection or server configuration not available for historical data." };
  try {
    const admin = createAdminClient();
    const [{ data: exec }, { data: conn }] = await Promise.all([
      admin.from("raw_executions").select("payload").eq("user_id", userId).eq("exchange", t.exchange).eq("tradingsymbol", t.tradingsymbol).not("payload->instrument_token", "is", null).limit(1).maybeSingle(),
      admin.from("broker_connections").select("id, status").eq("user_id", userId).eq("broker", "zerodha").maybeSingle(),
    ]);
    const token = Number((exec?.payload as { instrument_token?: number } | null)?.instrument_token);
    if (!token) return { candles: null, source: "none", reason: "Instrument token unknown for this symbol (CSV imports do not include it)." };
    if (!conn || !["connected", "updated", "partial"].includes(conn.status)) return { candles: null, source: "none", reason: "Reconnect Zerodha to load historical candles." };
    const { data: secret } = await admin.from("broker_secrets").select("access_token_enc").eq("connection_id", conn.id).maybeSingle();
    if (!secret) return { candles: null, source: "none", reason: "Reconnect Zerodha to load historical candles." };
    const kite = new KiteClient(env.kiteApiKey, decryptSecret(secret.access_token_enc));
    const pad = interval === "day" ? 40 : 1;
    const from = `${addDays(localDate(t.entryAt), -pad)} 09:15:00`;
    const to = `${addDays(localDate(t.exitAt), interval === "day" ? 10 : 0)} 15:30:00`;
    const kiteInterval = interval === "1minute" ? "minute" : interval;
    const data = await kite.historical(token, kiteInterval, from, to);
    return {
      candles: data.candles.map(([ts, o, h, l, c, v]) => ({ time: Math.floor(Date.parse(ts) / 1000), open: o, high: h, low: l, close: c, volume: v })),
      source: "licensed",
    };
  } catch (e) {
    if (e instanceof KiteApiError && (e.errorType === "PermissionException" || e.status === 403))
      return { candles: null, source: "none", reason: "Historical data is not enabled for this Kite Connect app (requires the historical data add-on)." };
    return { candles: null, source: "none", reason: `Historical data unavailable: ${(e as Error).message}` };
  }
}
