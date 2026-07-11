-- 0005_retention.sql — 5-year retention purge (owner-set policy).
-- Deletes customers with no purchase in the last 5 years (and their old
-- purchases + ledger rows). Runs as SECURITY DEFINER so it can delete across
-- branch-owned rows.

create or replace function public.purge_inactive_customers()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_deleted int;
begin
  create temporary table _stale on commit drop as
    select c.id
    from public.customers c
    where c.created_at < now() - interval '5 years'
      and not exists (
        select 1 from public.purchases p
        where p.customer_id = c.id
          and p.created_at >= now() - interval '5 years'
      );

  delete from public.loyalty_ledger where customer_id in (select id from _stale);
  delete from public.purchases     where customer_id in (select id from _stale);
  delete from public.customers     where id in (select id from _stale);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke execute on function public.purge_inactive_customers() from authenticated, anon;

-- Schedule it monthly. Requires the pg_cron extension:
--   Supabase dashboard → Database → Extensions → enable "pg_cron".
-- Then run (once):
--   select cron.schedule(
--     'purge-inactive-customers', '0 3 1 * *',
--     $$select public.purge_inactive_customers();$$
--   );
