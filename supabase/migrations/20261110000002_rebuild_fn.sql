-- Atomic rebuild of analytical records for one user + calc_version.
-- Callable by the signed-in user for themselves, or by the service role (scheduled sync).
drop function if exists public.replace_closed_trades(text, jsonb, jsonb);

create or replace function public.rebuild_analytics(
  p_user_id uuid, p_calc_version text, p_trades jsonb, p_costs jsonb, p_positions jsonb
) returns int language plpgsql security definer set search_path = '' as $$
declare n int;
  caller uuid := auth.uid();
  caller_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '');
begin
  if not (caller = p_user_id or (caller is null and caller_role = 'service_role')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.closed_trades where user_id = p_user_id and calc_version = p_calc_version;
  insert into public.closed_trades (user_id, calc_version, trade_key, is_demo, exchange, tradingsymbol,
    instrument_category, product, direction, quantity, avg_entry, avg_exit, entry_at, exit_at, gross_pnl,
    est_costs, verified_costs, net_pnl, cost_status, return_pct, holding_seconds, outcome, execution_ids)
  select p_user_id, p_calc_version, t->>'trade_key', coalesce((t->>'is_demo')::boolean,false), t->>'exchange',
    t->>'tradingsymbol', t->>'instrument_category', t->>'product', t->>'direction', (t->>'quantity')::numeric,
    (t->>'avg_entry')::numeric, (t->>'avg_exit')::numeric, (t->>'entry_at')::timestamptz, (t->>'exit_at')::timestamptz,
    (t->>'gross_pnl')::numeric, (t->>'est_costs')::numeric, (t->>'verified_costs')::numeric, (t->>'net_pnl')::numeric,
    t->>'cost_status', (t->>'return_pct')::numeric, (t->>'holding_seconds')::bigint, t->>'outcome',
    array(select jsonb_array_elements_text(t->'execution_ids'))
  from jsonb_array_elements(p_trades) t;
  get diagnostics n = row_count;

  insert into public.trade_costs (user_id, closed_trade_id, component, amount, source)
  select p_user_id, ct.id, c->>'component', (c->>'amount')::numeric, c->>'source'
  from jsonb_array_elements(p_costs) c
  join public.closed_trades ct on ct.user_id = p_user_id and ct.calc_version = p_calc_version and ct.trade_key = c->>'trade_key';

  delete from public.reconstructed_positions where user_id = p_user_id and calc_version = p_calc_version;
  insert into public.reconstructed_positions (user_id, calc_version, exchange, tradingsymbol, product, direction,
    open_quantity, avg_cost, opened_at)
  select p_user_id, p_calc_version, p->>'exchange', p->>'tradingsymbol', p->>'product', p->>'direction',
    (p->>'open_quantity')::numeric, (p->>'avg_cost')::numeric, (p->>'opened_at')::timestamptz
  from jsonb_array_elements(p_positions) p;

  return n;
end $$;

revoke all on function public.rebuild_analytics(uuid, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.rebuild_analytics(uuid, text, jsonb, jsonb, jsonb) to authenticated, service_role;
