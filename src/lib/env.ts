/** Central, typed access to configuration. Secrets are only read server-side. */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export const isSupabaseConfigured = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);

export function serverEnv() {
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    kiteApiKey: process.env.KITE_API_KEY ?? "",
    kiteApiSecret: process.env.KITE_API_SECRET ?? "",
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
    groqApiKey: process.env.GROQ_API_KEY ?? "",
    groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    cronSecret: process.env.CRON_SECRET ?? "",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    reportFromEmail: process.env.REPORT_FROM_EMAIL ?? "",
  };
}

export function integrationStatus() {
  const s = serverEnv();
  return {
    supabase: isSupabaseConfigured(),
    serviceRole: Boolean(s.serviceRoleKey),
    kite: Boolean(s.kiteApiKey && s.kiteApiSecret && s.tokenEncryptionKey),
    groq: Boolean(s.groqApiKey),
    email: Boolean(s.resendApiKey && s.reportFromEmail),
    cron: Boolean(s.cronSecret),
  };
}
