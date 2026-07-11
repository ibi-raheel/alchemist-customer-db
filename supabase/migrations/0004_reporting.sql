-- 0004_reporting.sql — server-side aggregation for reports.
-- All functions are SECURITY INVOKER: RLS applies, so a branch sees only its
-- own sales and an admin sees every branch. Keeps payloads tiny (slow-internet
-- priority) — no raw rows shipped to the client for totals.

-- This branch's today + this-month totals (Asia/Karachi day boundaries).
create or replace function public.my_sales_summary()
returns table (
  today_total  numeric,
  today_count  bigint,
  month_total  numeric,
  month_count  bigint
)
language sql stable security invoker set search_path = public as $$
  with t as (select (now() at time zone 'Asia/Karachi')::date as today),
  p as (
    select total_amount,
           (created_at at time zone 'Asia/Karachi')::date as day
    from public.purchases
    where created_at >= date_trunc('month', now() at time zone 'Asia/Karachi')
  )
  select
    coalesce(sum(total_amount) filter (where day = (select today from t)), 0),
    count(*) filter (where day = (select today from t)),
    coalesce(sum(total_amount), 0),
    count(*)
  from p;
$$;

-- Per-branch totals for the current month (admin view; branches with no sales
-- still appear via the left join).
create or replace function public.branch_sales_month()
returns table (
  branch_id   uuid,
  branch_name text,
  total       numeric,
  purchases   bigint
)
language sql stable security invoker set search_path = public as $$
  select b.id, b.name,
         coalesce(sum(pu.total_amount), 0),
         count(pu.*)
  from public.branches b
  left join public.purchases pu
    on pu.branch_id = b.id
   and pu.created_at >= date_trunc('month', now() at time zone 'Asia/Karachi')
  group by b.id, b.name
  order by b.name;
$$;

grant execute on function public.my_sales_summary() to authenticated;
grant execute on function public.branch_sales_month() to authenticated;
