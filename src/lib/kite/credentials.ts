import "server-only";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { decryptSecret } from "@/lib/security/crypto";

export interface KiteCreds {
  apiKey: string;
  apiSecret: string;
  source: "user" | "server";
}

/** The user's own Kite Connect app (preferred), else the server-wide app from env. */
export async function getKiteCreds(userId: string): Promise<KiteCreds | null> {
  const env = serverEnv();
  if (!env.tokenEncryptionKey) return null;
  const [row] = await db()`select api_key, api_secret_enc from kite_apps where user_id = ${userId}`;
  if (row) return { apiKey: row.api_key, apiSecret: decryptSecret(row.api_secret_enc), source: "user" };
  if (env.kiteApiKey && env.kiteApiSecret) return { apiKey: env.kiteApiKey, apiSecret: env.kiteApiSecret, source: "server" };
  return null;
}

/** Credentials for an incoming postback, located via the Zerodha client id in the payload. */
export async function getKiteCredsByBrokerUser(brokerUserId: string): Promise<{ userId: string; status: string; creds: KiteCreds } | null> {
  const [conn] = await db()`select user_id, status from broker_connections where broker = 'zerodha' and broker_user_id = ${brokerUserId}`;
  if (!conn) return null;
  const creds = await getKiteCreds(conn.user_id);
  return creds ? { userId: conn.user_id, status: conn.status, creds } : null;
}
