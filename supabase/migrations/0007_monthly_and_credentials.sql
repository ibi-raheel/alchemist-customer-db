-- 0007_monthly_and_credentials.sql
-- (1) monthly-medicine flag on customers
-- (2) branch login credentials, admin-visible
-- (3) customer report includes the monthly flag

-- (1) monthly medicine customer flag
alter table public.customers
  add column if not exists monthly_medicine boolean not null default false;

-- (2) branch_logins — a directory of which branch uses which login EMAIL.
-- Passwords are NOT stored (Supabase hashes them and they must stay secret).
-- Admin-only via RLS.
create table if not exists public.branch_logins (
  branch_id  uuid primary key references public.branches(id) on delete cascade,
  email      text not null,
  updated_at timestamptz not null default now()
);
alter table public.branch_logins enable row level security;
grant select, insert, update on public.branch_logins to authenticated;
drop policy if exists branch_logins_admin on public.branch_logins;
create policy branch_logins_admin on public.branch_logins
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- (3) rebuild customer_sales_summary to include monthly_medicine
drop function if exists public.customer_sales_summary();
create function public.customer_sales_summary()
returns table (
  customer_id      uuid,
  name             text,
  phone            text,
  visits           bigint,
  total_spent      numeric,
  points           int,
  last_purchase_at timestamptz,
  monthly_medicine boolean
)
language sql stable security invoker set search_path = public as $$
  select c.id, c.name, c.phone,
         count(p.id),
         coalesce(sum(p.total_amount), 0),
         coalesce((
           select sum(case when l.type = 'earn' then l.points else -l.points end)
           from public.loyalty_ledger l where l.customer_id = c.id
         ), 0)::int,
         max(p.created_at),
         c.monthly_medicine
  from public.customers c
  left join public.purchases p on p.customer_id = c.id
  group by c.id, c.name, c.phone, c.monthly_medicine
  order by coalesce(sum(p.total_amount), 0) desc, c.name;
$$;
grant execute on function public.customer_sales_summary() to authenticated;
