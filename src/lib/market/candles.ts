import "server-only";
import { demoCandles, INTERVAL_MIN, type Candle } from "@/lib/demo/generate";
import type { ClosedTrade } from "@/lib/engine/types";
import { addDays, localDate } from "@/lib/engine/time";
import { serverEnv } from "@/lib/env";
import { KiteApiError, KiteClient } from "@/lib/kite/client";
import { decryptSecret } from "@/lib/security/crypto";
import { db } from "@/lib/db";
import { getKiteCreds } from "@/lib/kite/credentials";

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
  const creds = userId ? await getKiteCreds(userId) : null;
  if (!userId || !env.databaseUrl || !creds) return { candles: null, source: "none", reason: "Zerodha connection or server configuration not available for historical data." };
  try {
    const q = db();
    const [[exec], [conn]] = await Promise.all([
      q`select instrument_token from raw_executions where user_id = ${userId} and exchange = ${t.exchange} and tradingsymbol = ${t.tradingsymbol} and instrument_token is not null limit 1`,
      q`select id, status from broker_connections where user_id = ${userId} and broker = 'zerodha'`,
    ]);
    const token = Number(exec?.instrument_token);
    if (!token) return { candles: null, source: "none", reason: "Instrument token unknown for this symbol (CSV imports do not include it)." };
    if (!conn || !["connected", "updated", "partial"].includes(conn.status)) return { candles: null, source: "none", reason: "Reconnect Zerodha to load historical candles." };
    const [secret] = await q`select access_token_enc from broker_secrets where connection_id = ${conn.id} and user_id = ${userId}`;
    if (!secret) return { candles: null, source: "none", reason: "Reconnect Zerodha to load historical candles." };
    const kite = new KiteClient(creds.apiKey, decryptSecret(secret.access_token_enc));
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
      return { candles: null, source: "none", reason: "Historical candles are not included in the free Kite Connect Personal plan (the paid Connect plan includes them)." };
    return { candles: null, source: "none", reason: `Historical data unavailable: ${(e as Error).message}` };
  }
}
