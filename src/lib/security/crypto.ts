import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for broker access tokens at rest.
 * TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded (`openssl rand -base64 32`).
 * Format: v1.<iv b64>.<tag b64>.<ciphertext b64>
 */
function key(): Buffer {
  const k = process.env.TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}

export function encryptSecret(plain: string, k: Buffer = key()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(blob: string, k: Buffer = key()): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Malformed secret");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Redact secrets from anything that may be logged. */
export function redact(input: unknown): unknown {
  const SENSITIVE = /(token|secret|password|api_key|apikey|authorization|checksum|pin|otp)/i;
  if (typeof input === "string") return input.replace(/(token\s+)[^\s:]+:[^\s]+/gi, "$1[REDACTED]");
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, SENSITIVE.test(k) ? "[REDACTED]" : redact(v)]));
  }
  return input;
}
