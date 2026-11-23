import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Neon Postgres over HTTPS (serverless driver). All queries are parameterised via
 * tagged templates. Data isolation is enforced in application code: every query on
 * user-owned tables filters by the authenticated user's id.
 */
let client: NeonQueryFunction<false, false> | null = null;

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  client ??= neon(url);
  return client;
}

export const isDbConfigured = () => Boolean(process.env.DATABASE_URL);

/** Normalise driver values: timestamps -> ISO strings. */
export const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/**
 * Atomically claim a named job if it hasn't run within `minutes`.
 * Returns true for exactly one caller per window (safe across instances).
 */
export async function claimJob(name: string, minutes: number): Promise<boolean> {
  const rows = await db()`insert into job_runs (name, last_run_at) values (${name}, now())
                          on conflict (name) do update set last_run_at = now()
                          where job_runs.last_run_at < now() - make_interval(mins => ${minutes})
                          returning name`;
  return rows.length > 0;
}
