-- TRADEOS initial schema
-- Conventions:
--   * UUID primary keys, every user-owned row carries user_id -> auth.users
--   * Raw broker data (raw_orders, raw_executions) is stored separately from
--     normalized analytical records (closed_trades, reconstructed_positions ...)
--   * Analytical rows carry calc_version so metrics can be rebuilt when the
--     accounting methodology changes.
--   * Journal entries / AI reviews are keyed by a deterministic trade_key so they
--     survive a rebuild of closed_trades.
--   * Broker secrets live in broker_secrets which has RLS enabled and NO policies:
--     only the service role (server) can read or write it. Values are additionally
--     AES-256-GCM encrypted by the application before storage.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- users
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  week_start smallint not null default 1 check (week_start between 0 and 6), -- 1 = Monday
  dashboard_layout jsonb not null default '[]'::jsonb,
  email_reports boolean not null default false,
  data_mode text not null default 'live' check (data_mode in ('live','demo')),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.risk_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------- broker
create table public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_enc text not null,
  updated_at timestamptz not null default now()
);

create table public.broker_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.reconstructed_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.reconstructed_positions(id) on delete cascade,
  execution_id uuid references public.raw_executions(id) on delete cascade,
  remaining_quantity numeric(20,4) not null,
  price numeric(20,4) not null,
  opened_at timestamptz not null
);
create index on public.position_lots (position_id);

create table public.closed_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  closed_trade_id uuid not null references public.closed_trades(id) on delete cascade,
  component text not null check (component in ('brokerage','stt','exchange_txn','sebi','gst','stamp_duty','dp','other')),
  amount numeric(20,4) not null,
  source text not null check (source in ('estimated','verified'))
);
create index on public.trade_costs (closed_trade_id);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  storage_path text not null,
  mime_type text,
  caption text,
  created_at timestamptz not null default now()
);

create table public.trading_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  rules jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.risk_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  calc_version text not null,
  period_type text not null check (period_type in ('day','week','month','all')),
  period_start date not null,
  metrics jsonb not null,
  computed_at timestamptz not null default now(),
  unique (user_id, calc_version, period_type, period_start)
);

create table public.ai_trade_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  review_id uuid not null references public.ai_trade_reviews(id) on delete cascade,
  item_key text not null,
  verdict text not null check (verdict in ('accept','reject','correct')),
  correction text,
  created_at timestamptz not null default now(),
  unique (review_id, item_key)
);

create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip inet,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (user_id, created_at desc);

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['user_preferences','broker_connections','broker_sync_runs','broker_import_batches',
    'raw_orders','raw_executions','trade_strategies','reconstructed_positions','position_lots','closed_trades',
    'trade_costs','journal_entries','journal_attachments','trading_plans','risk_settings','performance_snapshots',
    'ai_trade_reviews','ai_review_feedback','weekly_reports','notifications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner_select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner_insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner_update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner_delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- broker_connections status is written by the server only; users may read their own row
drop policy "owner_insert" on public.broker_connections;
drop policy "owner_update" on public.broker_connections;
drop policy "owner_delete" on public.broker_connections;

alter table public.users enable row level security;
create policy "self_select" on public.users for select to authenticated using ((select auth.uid()) = id);
create policy "self_update" on public.users for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- secrets: RLS on, no policies => service role only
alter table public.broker_secrets enable row level security;

-- audit logs: users may read their own, only the server writes
alter table public.audit_logs enable row level security;
create policy "owner_select" on public.audit_logs for select to authenticated using ((select auth.uid()) = user_id);

-- reference data: readable by any signed-in user, written by server only
alter table public.instruments enable row level security;
create policy "read_all" on public.instruments for select to authenticated using (true);

-- ---------------------------------------------------------------- atomic trade rebuild
-- Replaces the closed trades for one calc_version in a single transaction.
create or replace function public.replace_closed_trades(p_calc_version text, p_trades jsonb, p_costs jsonb)
returns int language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  delete from public.closed_trades where user_id = uid and calc_version = p_calc_version;
  insert into public.closed_trades (user_id, calc_version, trade_key, is_demo, exchange, tradingsymbol,
    instrument_category, product, direction, quantity, avg_entry, avg_exit, entry_at, exit_at, gross_pnl,
    est_costs, verified_costs, net_pnl, cost_status, return_pct, holding_seconds, outcome, execution_ids)
  select uid, p_calc_version, t->>'trade_key', coalesce((t->>'is_demo')::boolean,false), t->>'exchange',
    t->>'tradingsymbol', t->>'instrument_category', t->>'product', t->>'direction', (t->>'quantity')::numeric,
    (t->>'avg_entry')::numeric, (t->>'avg_exit')::numeric, (t->>'entry_at')::timestamptz, (t->>'exit_at')::timestamptz,
    (t->>'gross_pnl')::numeric, (t->>'est_costs')::numeric, (t->>'verified_costs')::numeric, (t->>'net_pnl')::numeric,
    t->>'cost_status', (t->>'return_pct')::numeric, (t->>'holding_seconds')::bigint, t->>'outcome',
    array(select jsonb_array_elements_text(t->'execution_ids'))
  from jsonb_array_elements(p_trades) t;
  get diagnostics n = row_count;
  insert into public.trade_costs (user_id, closed_trade_id, component, amount, source)
  select uid, ct.id, c->>'component', (c->>'amount')::numeric, c->>'source'
  from jsonb_array_elements(p_costs) c
  join public.closed_trades ct on ct.user_id = uid and ct.calc_version = p_calc_version and ct.trade_key = c->>'trade_key';
  return n;
end $$;
revoke all on function public.replace_closed_trades(text, jsonb, jsonb) from public, anon;
grant execute on function public.replace_closed_trades(text, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-attachments','journal-attachments', false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports','reports', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "own_files_select" on storage.objects for select to authenticated
  using (bucket_id in ('journal-attachments','reports') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('journal-attachments','reports') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own_files_delete" on storage.objects for delete to authenticated
  using (bucket_id in ('journal-attachments','reports') and (storage.foldername(name))[1] = (select auth.uid())::text);
