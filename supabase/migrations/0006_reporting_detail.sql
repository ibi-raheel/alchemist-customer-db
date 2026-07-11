-- 0006_reporting_detail.sql — deeper, all-time reporting.
-- All SECURITY INVOKER: RLS applies (branch sees own, admin sees all).

-- This branch's totals: today, this month, AND all-time.
create or replace function public.my_sales_totals()
returns table (
  today_total numeric, today_count bigint,
  month_total numeric, month_count bigint,
  all_total   numeric, all_count   bigint
)
language sql stable security invoker set search_path = public as $$
  with t as (select (now() at time zone 'Asia/Karachi')::date as today),
  p as (
    select total_amount,
           (created_at at time zone 'Asia/Karachi')::date as day
    from public.purchases
  )
  select
    coalesce(sum(total_amount) filter (where day = (select today from t)), 0),
    count(*) filter (where day = (select today from t)),
    coalesce(sum(total_amount) filter (
      where date_trunc('month', day) = date_trunc('month', (select today from t))), 0),
    count(*) filter (
      where date_trunc('month', day) = date_trunc('month', (select today from t))),
    coalesce(sum(total_amount), 0),
    count(*)
  from p;
$$;

-- Per-branch ALL-TIME totals.
create or replace function public.branch_sales_all()
returns table (
  branch_id uuid, branch_name text, total numeric, purchases bigint
)
language sql stable security invoker set search_path = public as $$
  select b.id, b.name, coalesce(sum(pu.total_amount), 0), count(pu.*)
  from public.branches b
  left join public.purchases pu on pu.branch_id = b.id
  group by b.id, b.name
  order by coalesce(sum(pu.total_amount), 0) desc, b.name;
$$;

-- Every customer's sales to date: visits, total spent, points balance, and
-- the exact date+time of their last purchase. Ordered by biggest spenders.
create or replace function public.customer_sales_summary()
returns table (
  customer_id      uuid,
  name             text,
  phone            text,
  visits           bigint,
  total_spent      numeric,
  points           int,
  last_purchase_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  select c.id, c.name, c.phone,
         count(p.id),
         coalesce(sum(p.total_amount), 0),
         coalesce((
           select sum(case when l.type = 'earn' then l.points else -l.points end)
           from public.loyalty_ledger l where l.customer_id = c.id
         ), 0)::int,
         max(p.created_at)
  from public.customers c
  left join public.purchases p on p.customer_id = c.id
  group by c.id, c.name, c.phone
  order by coalesce(sum(p.total_amount), 0) desc, c.name;
$$;

grant execute on function public.my_sales_totals()        to authenticated;
grant execute on function public.branch_sales_all()       to authenticated;
grant execute on function public.customer_sales_summary() to authenticated;
