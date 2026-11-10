import { describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { assertAllowed, KiteApiError, KiteClient, KiteReadOnlyViolation, loginUrl, postbackChecksum, sessionChecksum } from "@/lib/kite/client";
import { normalizeKiteTrades } from "@/lib/kite/normalize";
import { tokenExpiry } from "@/lib/kite/sync";
import { decryptSecret, encryptSecret, redact } from "@/lib/security/crypto";

describe("read-only enforcement", () => {
  it.each([
    ["POST", "/orders/regular"],
    ["PUT", "/orders/regular/123"],
    ["DELETE", "/orders/regular/123"],
    ["POST", "/gtt/triggers"],
    ["POST", "/orders/amo"],
    ["POST", "/mf/orders"],
  ])("blocks %s %s", (m, p) => expect(() => assertAllowed(m, p)).toThrow(KiteReadOnlyViolation));
  it.each([
    ["GET", "/trades"],
    ["GET", "/orders"],
    ["GET", "/portfolio/holdings"],
    ["GET", "/instruments/historical/408065/15minute"],
    ["POST", "/session/token"],
  ])("allows %s %s", (m, p) => expect(() => assertAllowed(m, p)).not.toThrow());
  it("exposes no order-placement method", () => {
    const names = Object.getOwnPropertyNames(KiteClient.prototype);
    expect(names.some((n) => /place|modify|cancel|order(?!s$)/i.test(n))).toBe(false);
  });
});

describe("session handling", () => {
  it("computes the official checksums", () => {
    expect(sessionChecksum("k", "r", "s")).toBe(createHash("sha256").update("krs").digest("hex"));
    expect(postbackChecksum("o1", "2026-11-02 10:00:00", "s")).toBe(createHash("sha256").update("o12026-11-02 10:00:00s").digest("hex"));
  });
  it("builds the official login URL with CSRF state", () => {
    const u = new URL(loginUrl("abc", "xyz"));
    expect(u.host).toBe("kite.zerodha.com");
    expect(u.searchParams.get("api_key")).toBe("abc");
    expect(u.searchParams.get("redirect_params")).toBe("state=xyz");
  });
  it("flags TokenException as reconnect-required (token expiration)", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "error", error_type: "TokenException", message: "Token is invalid or has expired." }), { status: 403 }));
    const c = new KiteClient("k", "t", fetchImpl as unknown as typeof fetch);
    const err = await c.trades().catch((e) => e);
    expect(err).toBeInstanceOf(KiteApiError);
    expect(err.requiresReconnect).toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("token k:t");
  });
  it("handles unexpected non-JSON broker responses", async () => {
    const c = new KiteClient("k", "t", (async () => new Response("<html>gateway</html>", { status: 502 })) as unknown as typeof fetch);
    await expect(c.orders()).rejects.toMatchObject({ errorType: "DataException" });
  });
  it("expires tokens at the next 06:00 IST", () => {
    expect(tokenExpiry(new Date("2026-11-02T04:00:00Z"))).toBe("2026-11-03T00:30:00.000Z"); // 09:30 IST -> next day 06:00 IST
    expect(tokenExpiry(new Date("2026-11-02T23:00:00Z"))).toBe("2026-11-03T00:30:00.000Z"); // 04:30 IST -> same day 06:00 IST
  });
});

describe("normalization", () => {
  it("normalizes fills and rejects malformed rows", () => {
    const r = normalizeKiteTrades([
      { trade_id: "1", order_id: "o", exchange: "NSE", tradingsymbol: "INFY", instrument_token: 408065, product: "MIS", average_price: 1500, quantity: 5, transaction_type: "BUY", fill_timestamp: "2026-11-02 09:20:11", exchange_timestamp: null, order_timestamp: null },
      { trade_id: "2", exchange: "NSE", tradingsymbol: "INFY", transaction_type: "HOLD", quantity: 1, average_price: 1 },
      { exchange: "NSE" },
    ]);
    expect(r.executions).toHaveLength(1);
    expect(r.executions[0]).toMatchObject({ id: "NSE:1", executedAt: "2026-11-02T03:50:11.000Z", source: "kite_api", product: "MIS" });
    expect(r.rejected).toHaveLength(2);
  });
});

describe("token encryption & redaction", () => {
  const key = randomBytes(32);
  it("round-trips with AES-256-GCM and detects tampering", () => {
    const blob = encryptSecret("access-token-123", key);
    expect(blob).not.toContain("access-token-123");
    expect(decryptSecret(blob, key)).toBe("access-token-123");
    const parts = blob.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
  });
  it("redacts sensitive fields from logs", () => {
    expect(redact({ access_token: "x", nested: { api_key: "y", ok: 1 }, msg: "Authorization: token abc:def" })).toEqual({ access_token: "[REDACTED]", nested: { api_key: "[REDACTED]", ok: 1 }, msg: "Authorization: token [REDACTED]" });
  });
});
