import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { db, isDbConfigured } from "@/lib/db";
import { sha256Hex } from "@/lib/security/crypto";

export const SESSION_COOKIE = "tradeos_session";
const TTL_DAYS = 30;

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  totpEnabled: boolean;
  mfaPassed: boolean;
}

export async function createSession(userId: string, mfaPassed: boolean, meta: { ip?: string | null; ua?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TTL_DAYS * 86400_000);
  await db()`insert into sessions (user_id, token_hash, mfa_passed, expires_at, ip, user_agent)
             values (${userId}, ${sha256Hex(token)}, ${mfaPassed}, ${expires.toISOString()}, ${meta.ip ?? null}, ${(meta.ua ?? "").slice(0, 300)})`;
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

/** Resolve the session from the HTTP-only cookie. Cached per request. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  if (!isDbConfigured()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const rows = await db()`select s.id, s.user_id, s.mfa_passed, u.email, u.totp_enabled
                          from sessions s join users u on u.id = s.user_id
                          where s.token_hash = ${sha256Hex(token)} and s.expires_at > now()`;
  const r = rows[0];
  if (!r) return null;
  return { sessionId: r.id, userId: r.user_id, email: r.email, totpEnabled: r.totp_enabled, mfaPassed: r.mfa_passed };
});

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db()`delete from sessions where token_hash = ${sha256Hex(token)}`;
  store.delete(SESSION_COOKIE);
}

export async function markMfaPassed(sessionId: string) {
  await db()`update sessions set mfa_passed = true where id = ${sessionId}`;
}

/** A user is fully authenticated when MFA is either not enabled or passed. */
export const isFullyAuthenticated = (s: SessionUser | null): s is SessionUser => !!s && (!s.totpEnabled || s.mfaPassed);
