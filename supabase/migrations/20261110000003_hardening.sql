-- Run the rebuild with the caller's privileges so RLS always applies to signed-in users
-- (the service role bypasses RLS for scheduled syncs). The explicit caller check remains.
alter function public.rebuild_analytics(uuid, text, jsonb, jsonb, jsonb) security invoker;

-- Covering indexes for foreign keys
create index if not exists ai_review_feedback_user_id_idx on public.ai_review_feedback (user_id);
create index if not exists broker_secrets_user_id_idx on public.broker_secrets (user_id);
create index if not exists broker_sync_runs_connection_id_idx on public.broker_sync_runs (connection_id);
create index if not exists journal_attachments_entry_idx on public.journal_attachments (journal_entry_id);
create index if not exists journal_attachments_user_id_idx on public.journal_attachments (user_id);
create index if not exists journal_entries_strategy_id_idx on public.journal_entries (strategy_id);
create index if not exists position_lots_execution_id_idx on public.position_lots (execution_id);
create index if not exists position_lots_user_id_idx on public.position_lots (user_id);
create index if not exists raw_executions_batch_id_idx on public.raw_executions (batch_id);
create index if not exists raw_orders_batch_id_idx on public.raw_orders (batch_id);
create index if not exists trade_costs_user_id_idx on public.trade_costs (user_id);
create index if not exists trading_plans_user_id_idx on public.trading_plans (user_id);
