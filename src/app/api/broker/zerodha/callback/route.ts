import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp, requireUser } from "@/lib/api";
import { env, serverEnv } from "@/lib/env";
import { audit } from "@/lib/data/pipeline";
import { KiteApiError, KiteClient } from "@/lib/kite/client";
import { syncUser, tokenExpiry } from "@/lib/kite/sync";
import { encryptSecret, safeEqual } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

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
    const admin = createAdminClient();
    const now = new Date();
    const { data: conn, error } = await admin
      .from("broker_connections")
      .upsert(
        {
          user_id: a.user.id,
          broker: "zerodha",
          broker_user_id: profile.user_id,
          broker_user_name: profile.user_name,
          status: "connected",
          last_error: null,
          token_expires_at: tokenExpiry(now),
          connected_at: now.toISOString(),
          disconnected_at: null,
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id,broker" }
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await admin.from("broker_secrets").upsert({ connection_id: conn.id, user_id: a.user.id, access_token_enc: encryptSecret(session.access_token), updated_at: now.toISOString() });
    await audit(a.user.id, "broker.connected", { broker: "zerodha", broker_user_id: profile.user_id }, "broker_connections", conn.id, clientIp(req));
    after(() => syncUser(admin, a.user.id, "connect").catch(() => undefined));
    return back("connected=1");
  } catch (e) {
    await audit(a.user.id, "broker.connect_failed", { message: (e as Error).message });
    return back(`error=${e instanceof KiteApiError ? "kite_" + e.errorType : "exchange_failed"}`);
  }
}
