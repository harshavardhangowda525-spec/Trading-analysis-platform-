/**
 * Zerodha Kite Connect v3 client — ANALYTICS-ONLY.
 * Docs: https://kite.trade/docs/connect/v3/
 *
 * Kite Connect does not offer a technically enforceable read-only scope: an access
 * token can place orders. TRADEOS therefore enforces read-only behaviour in its own
 * backend. Every request passes through `assertAllowed`, which permits only the
 * endpoints listed in READ_ONLY_ALLOWLIST. No order placement, modification,
 * cancellation, GTT or basket endpoint is implemented or reachable.
 */
import { createHash } from "node:crypto";

export const KITE_API = "https://api.kite.trade";
export const KITE_LOGIN = "https://kite.zerodha.com/connect/login";

const READ_ONLY_ALLOWLIST: { method: string; pattern: RegExp }[] = [
  { method: "POST", pattern: /^\/session\/token$/ }, // request_token -> access_token exchange
  { method: "DELETE", pattern: /^\/session\/token$/ }, // invalidate our own session (disconnect)
  { method: "GET", pattern: /^\/user\/profile$/ },
  { method: "GET", pattern: /^\/orders$/ },
  { method: "GET", pattern: /^\/trades$/ },
  { method: "GET", pattern: /^\/portfolio\/positions$/ },
  { method: "GET", pattern: /^\/portfolio\/holdings$/ },
  { method: "GET", pattern: /^\/instruments(\/[A-Z]+)?$/ },
  { method: "GET", pattern: /^\/instruments\/historical\/\d+\/(minute|3minute|5minute|10minute|15minute|30minute|60minute|day)$/ },
];

export class KiteReadOnlyViolation extends Error {}

export function assertAllowed(method: string, path: string) {
  const ok = READ_ONLY_ALLOWLIST.some((r) => r.method === method.toUpperCase() && r.pattern.test(path));
  if (!ok) throw new KiteReadOnlyViolation(`Blocked non-allowlisted Kite request: ${method} ${path}`);
}

export type KiteErrorType = "TokenException" | "PermissionException" | "InputException" | "NetworkException" | "DataException" | "GeneralException" | string;

export class KiteApiError extends Error {
  constructor(public status: number, public errorType: KiteErrorType, message: string) {
    super(message);
  }
  /** Session expired / revoked — user must reconnect through the official login. */
  get requiresReconnect() {
    return this.errorType === "TokenException" || this.status === 403;
  }
}

export function loginUrl(apiKey: string, state: string) {
  const u = new URL(KITE_LOGIN);
  u.searchParams.set("v", "3");
  u.searchParams.set("api_key", apiKey);
  // redirect_params are echoed back to the redirect URL (CSRF state)
  u.searchParams.set("redirect_params", new URLSearchParams({ state }).toString());
  return u.toString();
}

export const sessionChecksum = (apiKey: string, requestToken: string, apiSecret: string) =>
  createHash("sha256").update(apiKey + requestToken + apiSecret).digest("hex");

export const postbackChecksum = (orderId: string, orderTimestamp: string, apiSecret: string) =>
  createHash("sha256").update(orderId + orderTimestamp + apiSecret).digest("hex");

type Fetch = typeof fetch;

export class KiteClient {
  constructor(private apiKey: string, private accessToken: string | null, private fetchImpl: Fetch = fetch) {}

  private async request<T>(method: string, path: string, body?: URLSearchParams, query?: Record<string, string>): Promise<T> {
    assertAllowed(method, path);
    const url = new URL(KITE_API + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "X-Kite-Version": "3" };
    if (this.accessToken) headers.Authorization = `token ${this.apiKey}:${this.accessToken}`;
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body, cache: "no-store", signal: AbortSignal.timeout(20000) });
    } catch (e) {
      throw new KiteApiError(0, "NetworkException", `Network error contacting Kite: ${(e as Error).message}`);
    }
    if (path.startsWith("/instruments") && !path.includes("historical") && res.ok) return (await res.text()) as T;
    let json: { status?: string; data?: T; error_type?: string; message?: string };
    try {
      json = await res.json();
    } catch {
      throw new KiteApiError(res.status, "DataException", `Unexpected non-JSON response from Kite (HTTP ${res.status})`);
    }
    if (!res.ok || json.status !== "success") {
      throw new KiteApiError(res.status, json.error_type ?? "GeneralException", json.message ?? `Kite error HTTP ${res.status}`);
    }
    return json.data as T;
  }

  generateSession(requestToken: string, apiSecret: string) {
    return this.request<KiteSession>(
      "POST",
      "/session/token",
      new URLSearchParams({ api_key: this.apiKey, request_token: requestToken, checksum: sessionChecksum(this.apiKey, requestToken, apiSecret) })
    );
  }
  invalidateSession() {
    if (!this.accessToken) return Promise.resolve(true);
    return this.request<boolean>("DELETE", "/session/token", undefined, { api_key: this.apiKey, access_token: this.accessToken });
  }
  profile() {
    return this.request<KiteProfile>("GET", "/user/profile");
  }
  orders() {
    return this.request<KiteOrder[]>("GET", "/orders");
  }
  trades() {
    return this.request<KiteTrade[]>("GET", "/trades");
  }
  positions() {
    return this.request<{ net: KitePosition[]; day: KitePosition[] }>("GET", "/portfolio/positions");
  }
  holdings() {
    return this.request<KiteHolding[]>("GET", "/portfolio/holdings");
  }
  instruments(exchange?: string) {
    return this.request<string>("GET", exchange ? `/instruments/${exchange}` : "/instruments");
  }
  /** Requires the Kite historical data add-on subscription. */
  historical(instrumentToken: number, interval: string, from: string, to: string) {
    return this.request<{ candles: [string, number, number, number, number, number][] }>("GET", `/instruments/historical/${instrumentToken}/${interval}`, undefined, { from, to });
  }
}

export interface KiteSession {
  user_id: string;
  user_name: string;
  user_shortname: string;
  email: string;
  broker: string;
  access_token: string;
  public_token: string;
  login_time: string;
}
export interface KiteProfile {
  user_id: string;
  user_name: string;
  email: string;
  broker: string;
  exchanges: string[];
  products: string[];
}
export interface KiteOrder {
  order_id: string;
  status: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: "BUY" | "SELL";
  product: string;
  quantity: number;
  filled_quantity: number;
  average_price: number;
  order_timestamp: string | null;
  exchange_timestamp: string | null;
  [k: string]: unknown;
}
export interface KiteTrade {
  trade_id: string;
  order_id: string;
  exchange: string;
  tradingsymbol: string;
  instrument_token: number;
  product: string;
  average_price: number;
  quantity: number;
  transaction_type: "BUY" | "SELL";
  fill_timestamp: string | null;
  exchange_timestamp: string | null;
  order_timestamp: string | null;
  [k: string]: unknown;
}
export interface KitePosition {
  tradingsymbol: string;
  exchange: string;
  product: string;
  quantity: number;
  average_price: number;
  pnl: number;
  realised: number;
  unrealised: number;
  last_price: number;
  [k: string]: unknown;
}
export interface KiteHolding {
  tradingsymbol: string;
  exchange: string;
  isin: string;
  quantity: number;
  t1_quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  [k: string]: unknown;
}
