import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env, serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — use ONLY for broker secrets, scheduled jobs
 * and audit logging, always scoping queries by an explicit, verified user_id.
 */
export function createAdminClient() {
  const key = serverEnv().serviceRoleKey;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(env.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
