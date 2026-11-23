-- Per-user Kite Connect app credentials (each trader registers their own Personal app).
create table if not exists public.kite_apps (
  user_id uuid primary key references public.users(id) on delete cascade,
  api_key text not null,
  api_secret_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists broker_connections_broker_user_idx on public.broker_connections (broker, broker_user_id);
create table if not exists public.job_runs (
  name text primary key,
  last_run_at timestamptz not null
);
