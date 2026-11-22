/** Central, typed access to configuration. Secrets are only read server-side. */
export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export function serverEnv() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
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
    database: Boolean(s.databaseUrl),
    encryption: Boolean(s.tokenEncryptionKey),
    kite: Boolean(s.kiteApiKey && s.kiteApiSecret && s.tokenEncryptionKey && s.databaseUrl),
    groq: Boolean(s.groqApiKey),
    email: Boolean(s.resendApiKey && s.reportFromEmail),
    cron: Boolean(s.cronSecret),
  };
}
