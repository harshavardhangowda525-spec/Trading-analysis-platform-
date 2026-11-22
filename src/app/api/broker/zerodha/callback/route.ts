import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp, requireUser } from "@/lib/api";
import { env, serverEnv } from "@/lib/env";
import { audit } from "@/lib/data/pipeline";
import { KiteApiError, KiteClient } from "@/lib/kite/client";
import { syncUser, tokenExpiry } from "@/lib/kite/sync";
import { encryptSecret, safeEqual } from "@/lib/security/crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const back = (q: string) => NextResponse.redirect(new URL(`/broker?${q}`, env.appUrl));

/** Step 2: Kite redirects here with a one-time request_token, exchanged server-side. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const store = await cookies();
  const expected = store.get("kite_oauth_state")?.value ?? "";
  store.delete({ name: "kite_oauth_state", path: "/api/broker/zerodha" });
  const state = u.searchParams.get("state") ?? "";
  if (!expected || !state || !safeEqual(expected, state)) return back("error=invalid_state");
  if (u.searchParams.get("status") !== "success") return back("error=login_cancelled");
  const requestToken = u.searchParams.get("request_token");
  if (!requestToken || !/^[A-Za-z0-9]{8,64}$/.test(requestToken)) return back("error=missing_token");

  const a = await requireUser();
  if ("res" in a) return NextResponse.redirect(new URL("/login", env.appUrl));
  const { kiteApiKey, kiteApiSecret } = serverEnv();

  try {
    const session = await new KiteClient(kiteApiKey, null).generateSession(requestToken, kiteApiSecret);
    const kite = new KiteClient(kiteApiKey, session.access_token);
    const profile = await kite.profile(); // validates the account/session
    const q = db();
    const uid = a.user.userId;
    const [conn] = await q`insert into broker_connections (user_id, broker, broker_user_id, broker_user_name, status, last_error, token_expires_at, connected_at, disconnected_at, updated_at)
      values (${uid}, 'zerodha', ${profile.user_id}, ${profile.user_name}, 'connected', null, ${tokenExpiry(new Date())}, now(), null, now())
      on conflict (user_id, broker) do update set broker_user_id = excluded.broker_user_id, broker_user_name = excluded.broker_user_name,
        status = 'connected', last_error = null, token_expires_at = excluded.token_expires_at, connected_at = now(), disconnected_at = null, updated_at = now()
      returning id`;
    await q`insert into broker_secrets (connection_id, user_id, access_token_enc, updated_at) values (${conn.id}, ${uid}, ${encryptSecret(session.access_token)}, now())
            on conflict (connection_id) do update set access_token_enc = excluded.access_token_enc, updated_at = now()`;
    await audit(uid, "broker.connected", { broker: "zerodha", broker_user_id: profile.user_id }, "broker_connections", conn.id, clientIp(req));
    after(() => syncUser(uid, "connect").catch(() => undefined));
    return back("connected=1");
  } catch (e) {
    await audit(a.user.userId, "broker.connect_failed", { message: (e as Error).message });
    return back(`error=${e instanceof KiteApiError ? "kite_" + e.errorType : "exchange_failed"}`);
  }
}
