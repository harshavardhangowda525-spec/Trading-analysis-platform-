-- Row Level Security verification. Runs inside a transaction and ROLLS BACK (leaves no data).
-- Run with: psql "$DATABASE_URL" -f supabase/tests/rls.sql   (or paste into the Supabase SQL editor)
-- Every row of the final SELECT should show the expected value in the comment next to its test.
begin;
create temp table rls_results(test text, result text, expected text) on commit drop;
grant all on rls_results to authenticated, anon;
insert into auth.users (id, email, aud, role, instance_id) values
 ('11111111-1111-1111-1111-111111111111','rls-a@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('22222222-2222-2222-2222-222222222222','rls-b@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into public.broker_connections (id, user_id, status) values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','connected');
insert into public.broker_secrets (connection_id, user_id, access_token_enc) values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','v1.x.y.z');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.raw_executions (user_id, source, broker_trade_id, exchange, tradingsymbol, side, quantity, price, executed_at) values ('11111111-1111-1111-1111-111111111111','csv','T1','NSE','INFY','BUY',1,1500,now());
insert into public.raw_executions (user_id, source, broker_trade_id, exchange, tradingsymbol, side, quantity, price, executed_at) values ('11111111-1111-1111-1111-111111111111','csv','T1','NSE','INFY','BUY',1,1500,now()) on conflict do nothing;
insert into rls_results select 'A sees own executions (duplicate ignored)', count(*)::text, '1' from public.raw_executions;
insert into rls_results select 'A reads broker_secrets', count(*)::text, '0' from public.broker_secrets;
insert into rls_results select 'A reads own connection', count(*)::text, '1' from public.broker_connections;
do $$ begin
  perform public.rebuild_analytics('22222222-2222-2222-2222-222222222222','fifo-v1','[]','[]','[]');
  insert into rls_results values ('A rebuilds B analytics', 'ALLOWED', 'denied');
exception when others then insert into rls_results values ('A rebuilds B analytics', 'denied', 'denied'); end $$;
update public.broker_connections set status = 'updated';
insert into rls_results select 'A can change own sync status', count(*)::text, '0' from public.broker_connections where status = 'updated';

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
insert into rls_results select 'B sees A executions', count(*)::text, '0' from public.raw_executions;
insert into rls_results select 'B sees A connection', count(*)::text, '0' from public.broker_connections;
do $$ begin
  insert into public.raw_executions (user_id, source, broker_trade_id, exchange, tradingsymbol, side, quantity, price, executed_at) values ('11111111-1111-1111-1111-111111111111','csv','T9','NSE','INFY','BUY',1,1,now());
  insert into rls_results values ('B inserts rows for A', 'ALLOWED', 'denied');
exception when others then insert into rls_results values ('B inserts rows for A', 'denied', 'denied'); end $$;
do $$ declare n int; begin delete from public.raw_executions; get diagnostics n = row_count; insert into rls_results values ('B deletes A rows', n::text, '0'); end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  insert into rls_results select 'anon reads executions', count(*)::text, '0' from public.raw_executions;
exception when others then insert into rls_results values ('anon reads executions', '0', '0'); end $$;
reset role;
select test, result, expected, case when result = expected then 'PASS' else 'FAIL' end as status from rls_results;
rollback;
