import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { base32Decode, base32Encode, totp, verifyTotp } from "@/lib/auth/totp";

describe("password hashing", () => {
  it("hashes with scrypt and a random salt, and verifies", async () => {
    const h1 = await hashPassword("Correct-horse-9");
    const h2 = await hashPassword("Correct-horse-9");
    expect(h1).not.toBe(h2);
    expect(h1.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct-horse-9", h1)).toBe(true);
    expect(await verifyPassword("wrong-password-9", h1)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("enforces a minimum password policy", () => {
    expect(passwordProblem("short1")).toMatch(/10/);
    expect(passwordProblem("onlyletterslong")).toMatch(/number/);
    expect(passwordProblem("letters-and-123")).toBeNull();
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 SHA-1 test secret "12345678901234567890"
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("round-trips base32", () => expect(base32Decode(secret).toString()).toBe("12345678901234567890"));
  it("matches the RFC test vector (T=59s -> 94287082, last 6 digits)", () => {
    expect(totp(secret, 59_000)).toBe("287082");
    expect(totp(secret, 1111111109_000)).toBe("081804");
  });
  it("accepts ±1 step of clock drift and rejects others", () => {
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });
});
