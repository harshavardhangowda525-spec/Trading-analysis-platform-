-- TRADEOS schema for Neon Postgres.
-- Access control is enforced in the application: every query is scoped by the
-- authenticated user's id (see src/lib/db.ts and src/lib/auth). Raw broker data is
-- kept separate from analytical records; analytics carry calc_version.
create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  display_name text,
  totp_secret_enc text,
  totp_enabled boolean not null default false,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create unique index users_email_lower on public.users (lower(email));

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  mfa_passed boolean not null default false,
  expires_at timestamptz not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index on public.sessions (user_id);

create table public.user_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  week_start smallint not null default 1 check (week_start between 0 and 6),
  dashboard_layout jsonb not null default '[]'::jsonb,
  email_reports boolean not null default false,
  data_mode text not null default 'live' check (data_mode in ('live','demo')),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- broker
create table public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  broker text not null default 'zerodha' check (broker in ('zerodha')),
  broker_user_id text,
  broker_user_name text,
  status text not null default 'disconnected'
    check (status in ('connected','synchronizing','updated','reconnect_required','partial','sync_failed','disconnected')),
  last_synced_at timestamptz,
  last_error text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, broker)
);

create table public.broker_secrets (
  connection_id uuid primary key references public.broker_connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  access_token_enc text not null,
  updated_at timestamptz not null default now()
);

create table public.broker_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid references public.broker_connections(id) on delete set null,
  trigger text not null check (trigger in ('manual','scheduled','postback','connect')),
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index on public.broker_sync_runs (user_id, started_at desc);

create table public.broker_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('kite_api','csv','demo')),
  file_name text,
  content_sha256 text,
  row_count int not null default 0,
  inserted_count int not null default 0,
  duplicate_count int not null default 0,
  error_count int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  status text not null default 'completed' check (status in ('completed','partial','failed')),
  created_at timestamptz not null default now()
);
create index on public.broker_import_batches (user_id, created_at desc);

create table public.raw_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  batch_id uuid references public.broker_import_batches(id) on delete set null,
  broker_order_id text not null,
  status text,
  tradingsymbol text,
  exchange text,
  order_timestamp timestamptz,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (user_id, broker_order_id)
);

create table public.raw_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  batch_id uuid references public.broker_import_batches(id) on delete set null,
  source text not null check (source in ('kite_api','csv','demo')),
  is_demo boolean not null default false,
  broker_trade_id text not null,
  broker_order_id text,
  exchange text not null,
  tradingsymbol text not null,
  isin text,
  instrument_token bigint,
  segment text,
  product text,
  side text not null check (side in ('BUY','SELL')),
  quantity numeric(20,4) not null check (quantity > 0),
  price numeric(20,4) not null check (price >= 0),
  executed_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, exchange, broker_trade_id)
);
create index on public.raw_executions (user_id, executed_at);
create index on public.raw_executions (user_id, tradingsymbol);

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  instrument_token bigint,
  exchange text not null,
  tradingsymbol text not null,
  name text,
  segment text,
  instrument_type text,
  category text, -- stock | etf | index | derivative
  isin text,
  lot_size int,
  tick_size numeric(10,4),
  updated_at timestamptz not null default now(),
  unique (exchange, tradingsymbol)
);

-- ---------------------------------------------------------------- analytics
create table public.trade_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.reconstructed_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  calc_version text not null,
  exchange text not null,
  tradingsymbol text not null,
  product text,
  direction text not null check (direction in ('LONG','SHORT')),
  open_quantity numeric(20,4) not null,
  avg_cost numeric(20,4) not null,
  opened_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, calc_version, exchange, tradingsymbol, product)
);

create table public.position_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  position_id uuid not null references public.reconstructed_positions(id) on delete cascade,
  execution_id uuid references public.raw_executions(id) on delete cascade,
  remaining_quantity numeric(20,4) not null,
  price numeric(20,4) not null,
  opened_at timestamptz not null
);
create index on public.position_lots (position_id);

create table public.closed_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  calc_version text not null,
  trade_key text not null,
  is_demo boolean not null default false,
  exchange text not null,
  tradingsymbol text not null,
  instrument_category text,
  product text,
  direction text not null check (direction in ('LONG','SHORT')),
  quantity numeric(20,4) not null,
  avg_entry numeric(20,4) not null,
  avg_exit numeric(20,4) not null,
  entry_at timestamptz not null,
  exit_at timestamptz not null,
  gross_pnl numeric(20,4) not null,
  est_costs numeric(20,4) not null,
  verified_costs numeric(20,4),
  net_pnl numeric(20,4) not null,
  cost_status text not null check (cost_status in ('estimated','verified')),
  return_pct numeric(12,6),
  holding_seconds bigint not null,
  outcome text not null check (outcome in ('win','loss','breakeven')),
  execution_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, calc_version, trade_key)
);
create index on public.closed_trades (user_id, calc_version, exit_at desc);
create index on public.closed_trades (user_id, tradingsymbol);

create table public.trade_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  closed_trade_id uuid not null references public.closed_trades(id) on delete cascade,
  component text not null check (component in ('brokerage','stt','exchange_txn','sebi','gst','stamp_duty','dp','other')),
  amount numeric(20,4) not null,
  source text not null check (source in ('estimated','verified'))
);
create index on public.trade_costs (closed_trade_id);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  trade_key text not null,
  strategy_id uuid references public.trade_strategies(id) on delete set null,
  entry_rationale text,
  exit_rationale text,
  planned_stop numeric(20,4),
  planned_target numeric(20,4),
  followed_plan boolean,
  mistakes text[] not null default '{}',
  lessons text,
  emotional_state text,
  confidence smallint check (confidence between 1 and 5),
  tags text[] not null default '{}',
  notes text,
  annotations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple', coalesce(entry_rationale,'') || ' ' || coalesce(exit_rationale,'') || ' ' ||
      coalesce(lessons,'') || ' ' || coalesce(notes,''))
  ) stored,
  unique (user_id, trade_key)
);
create index on public.journal_entries using gin (search);
create index on public.journal_entries using gin (tags);

create table public.journal_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  data bytea not null,
  mime_type text,
  caption text,
  created_at timestamptz not null default now()
);

create table public.trading_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  rules jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.risk_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  starting_capital numeric(20,2) not null default 100000,
  max_risk_per_trade_pct numeric(6,3) not null default 1,
  max_daily_loss numeric(20,2) not null default 2000,
  max_weekly_loss numeric(20,2) not null default 5000,
  max_drawdown_pct numeric(6,3) not null default 10,
  max_trades_per_day int not null default 5,
  preferred_rr numeric(6,2) not null default 2,
  updated_at timestamptz not null default now()
);

create table public.performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  calc_version text not null,
  period_type text not null check (period_type in ('day','week','month','all')),
  period_start date not null,
  metrics jsonb not null,
  computed_at timestamptz not null default now(),
  unique (user_id, calc_version, period_type, period_start)
);

create table public.ai_trade_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  trade_key text not null,
  status text not null default 'pending' check (status in ('pending','complete','failed')),
  model text,
  verified_facts jsonb not null default '[]'::jsonb,
  possible_factors jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  narrative text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, trade_key)
);

create table public.ai_review_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  review_id uuid not null references public.ai_trade_reviews(id) on delete cascade,
  item_key text not null,
  verdict text not null check (verdict in ('accept','reject','correct')),
  correction text,
  created_at timestamptz not null default now(),
  unique (review_id, item_key)
);

create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  timezone text not null,
  metrics jsonb not null,
  ai_review jsonb,
  storage_path text,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('trade_imported','trade_closed','daily_pnl','daily_loss_exceeded',
    'weekly_report_ready','broker_disconnected','sync_failed','missing_journal','ai_review_ready')),
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (user_id, created_at desc);


-- covering indexes for foreign keys
create index on public.ai_review_feedback (user_id);
create index on public.broker_secrets (user_id);
create index on public.broker_sync_runs (connection_id);
create index on public.journal_attachments (journal_entry_id);
create index on public.journal_attachments (user_id);
create index on public.journal_entries (strategy_id);
create index on public.position_lots (execution_id);
create index on public.position_lots (user_id);
create index on public.raw_executions (batch_id);
create index on public.raw_orders (batch_id);
create index on public.trade_costs (user_id);
create index on public.trading_plans (user_id);
