-- Combined migrations 0001–0008 for Alchemist Customer DB.
-- Paste into Supabase → SQL Editor → Run.

-- ================= 0001_schema.sql =================
-- 0001_schema.sql — tables, view, indexes
-- Track 02 Customer Database. See stages/02_design/output/design.md §3.
-- Model B: lightweight capture, no line-item/drug data (privacy by design).

-- branches: one row per pharmacy branch. UUID id is the branch's unique id.
create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,                    -- optional human label
  name        text not null,
  location    text,
  created_at  timestamptz not null default now()
);

-- profiles: maps a Supabase auth user to a role + branch (one login per branch)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('branch','admin')),
  branch_id   uuid references public.branches(id),
  created_at  timestamptz not null default now(),
  constraint branch_needs_branch_id
    check (role <> 'branch' or branch_id is not null)
);

-- customers: ORG-WIDE, keyed by phone. No drug/line-item columns by design.
create table if not exists public.customers (
  id                uuid primary key default gen_random_uuid(),
  phone             text unique not null,
  name              text not null,
  address           text,
  consent_at        timestamptz,             -- loyalty consent notice accepted
  consent_version   text,
  created_at        timestamptz not null default now(),
  created_by_branch uuid references public.branches(id)
);

-- purchases: BRANCH-OWNED, lightweight. points_earned set by trigger.
create table if not exists public.purchases (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id),
  branch_id     uuid not null references public.branches(id),
  total_amount  numeric(12,2) not null check (total_amount > 0),
  points_earned int not null default 0,
  created_at    timestamptz not null default now()
);

-- loyalty_ledger: single source of truth for the points balance.
create table if not exists public.loyalty_ledger (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id),
  type         text not null check (type in ('earn','redeem')),
  points       int  not null check (points > 0),   -- magnitude; type gives sign
  purchase_id  uuid references public.purchases(id),
  branch_id    uuid not null references public.branches(id),
  created_at   timestamptz not null default now()
);

-- Derived balance (never a mutable stored field). security_invoker so the
-- caller's RLS applies (ledger is readable org-wide, so balances are too).
create or replace view public.customer_balances
  with (security_invoker = true) as
select customer_id,
       coalesce(sum(case when type = 'earn'   then points end), 0)
     - coalesce(sum(case when type = 'redeem' then points end), 0) as balance
from public.loyalty_ledger
group by customer_id;

-- indexes for the hot paths
create index if not exists idx_purchases_branch_date on public.purchases (branch_id, created_at);
create index if not exists idx_purchases_customer    on public.purchases (customer_id);
create index if not exists idx_ledger_customer       on public.loyalty_ledger (customer_id);

-- ================= 0002_functions_rls.sql =================
-- 0002_functions_rls.sql — helper functions, loyalty engine, RLS policies
-- See stages/02_design/output/design.md §4 and §5.

-- ---------------------------------------------------------------------------
-- Identity helpers. SECURITY DEFINER (owned by postgres) so they read profiles
-- without triggering RLS recursion.
-- ---------------------------------------------------------------------------
create or replace function public.current_branch_id()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Loyalty engine
-- ---------------------------------------------------------------------------
-- Earn: 1 point per PKR 100 (floor). Set on the row, then mirror into ledger.
create or replace function public.set_purchase_points()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.points_earned := floor(new.total_amount / 100);
  return new;
end $$;

create or replace function public.ledger_earn_on_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.points_earned > 0 then
    insert into public.loyalty_ledger (customer_id, type, points, purchase_id, branch_id)
    values (new.customer_id, 'earn', new.points_earned, new.id, new.branch_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_set_purchase_points on public.purchases;
create trigger trg_set_purchase_points
  before insert on public.purchases
  for each row execute function public.set_purchase_points();

drop trigger if exists trg_ledger_earn on public.purchases;
create trigger trg_ledger_earn
  after insert on public.purchases
  for each row execute function public.ledger_earn_on_purchase();

-- Redeem: 1 point = PKR 1, minimum balance 100 to redeem. Locks the customer's
-- ledger rows so the balance can never go negative under concurrent use.
create or replace function public.redeem_points(p_customer uuid, p_points int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_balance int;
  v_branch  uuid;
begin
  if p_points <= 0 then
    raise exception 'Points to redeem must be positive';
  end if;

  -- serialize concurrent redemptions for this customer
  perform 1 from public.loyalty_ledger where customer_id = p_customer for update;

  select coalesce(sum(case when type = 'earn' then points else -points end), 0)
    into v_balance
  from public.loyalty_ledger where customer_id = p_customer;

  if v_balance < 100 then
    raise exception 'Minimum 100 points required to redeem (balance: %)', v_balance;
  end if;
  if p_points > v_balance then
    raise exception 'Insufficient points (balance: %, requested: %)', v_balance, p_points;
  end if;

  v_branch := public.current_branch_id();
  if v_branch is null then
    raise exception 'No branch context for redemption';
  end if;

  insert into public.loyalty_ledger (customer_id, type, points, branch_id)
  values (p_customer, 'redeem', p_points, v_branch);

  return v_balance - p_points;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (RLS sits on top of these). anon gets nothing.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select on public.branches to authenticated;
grant select, insert on public.purchases to authenticated;
grant select on public.loyalty_ledger to authenticated;
grant select on public.customer_balances to authenticated;
grant select on public.profiles to authenticated;
grant execute on function public.redeem_points(uuid, int) to authenticated;
grant execute on function public.current_branch_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.branches       enable row level security;
alter table public.profiles       enable row level security;
alter table public.customers      enable row level security;
alter table public.purchases      enable row level security;
alter table public.loyalty_ledger enable row level security;

-- branches: everyone signed in can read; only admin writes.
create policy branches_select on public.branches
  for select to authenticated using (true);
create policy branches_admin_write on public.branches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: read your own row, or any if admin. Writes happen server-side
-- (service role) during provisioning, which bypasses RLS.
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

-- customers: ORG-WIDE. Any branch can look up, create, and fix name/address.
-- Deletes are admin-only (5-year retention purge runs as admin/service).
create policy customers_select on public.customers
  for select to authenticated using (true);
create policy customers_insert on public.customers
  for insert to authenticated with check (true);
create policy customers_update on public.customers
  for update to authenticated using (true) with check (true);
create policy customers_admin_delete on public.customers
  for delete to authenticated using (public.is_admin());

-- purchases: a branch reads/writes only its own; admin reads all. Immutable
-- for branches (no update/delete policy => denied).
create policy purchases_select on public.purchases
  for select to authenticated
  using (branch_id = public.current_branch_id() or public.is_admin());
create policy purchases_insert on public.purchases
  for insert to authenticated
  with check (branch_id = public.current_branch_id());
create policy purchases_admin_update on public.purchases
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy purchases_admin_delete on public.purchases
  for delete to authenticated using (public.is_admin());

-- loyalty_ledger: readable org-wide (pooled points). No client writes — the
-- earn trigger and redeem_points() (SECURITY DEFINER) are the only writers.
create policy ledger_select on public.loyalty_ledger
  for select to authenticated using (true);

-- ================= 0003_seed.sql =================
-- 0003_seed.sql — seed the real branches (UUIDs auto-generated).
-- Source: shared/business-context.md + owner (2026-07-11): the two Johar Town
-- branches are Allaho Chowk and Khokhar Chowk.

insert into public.branches (name, location) values
  ('G.T. Road',                   'Opposite Pakistan Mint, G.T. Road, Lahore'),
  ('Thokar Niaz Baig',            'Thokar Niaz Baig, Lahore'),
  ('Allama Iqbal Town',           'Allama Iqbal Town, Lahore'),
  ('Johar Town – Allaho Chowk',   'Allaho Chowk, Johar Town, Lahore'),
  ('Johar Town – Khokhar Chowk',  'Khokhar Chowk, Johar Town, Lahore')
on conflict do nothing;

-- NOTE: branch logins (auth users + profiles) are provisioned from the Admin
-- screen, not here — creating auth users requires the Supabase admin API.
-- Bootstrap the FIRST admin once (see README "First-time setup").

-- ================= 0004_reporting.sql =================
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

-- ================= 0005_retention.sql =================
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

-- ================= 0006_reporting_detail.sql =================
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

-- ================= 0007_monthly_and_credentials.sql =================
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

-- ================= 0008_batch2.sql =================
-- 0008_batch2.sql — delivery tracking, rider role, monthly invoice, remark,
-- prescription storage, org-wide customer totals.

-- ========== Delivery tracking ==========
alter table public.purchases add column if not exists is_delivery boolean not null default false;
alter table public.purchases add column if not exists delivered_at timestamptz;
create index if not exists idx_purchases_pending_delivery
  on public.purchases (branch_id) where is_delivery and delivered_at is null;

-- allow a 'rider' role
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('branch', 'admin', 'rider'));
-- branch AND rider need a branch_id; admin does not
alter table public.profiles drop constraint if exists branch_needs_branch_id;
alter table public.profiles add constraint branch_needs_branch_id
  check (role = 'admin' or branch_id is not null);

-- rider (or the owning branch) marks a delivery done; stamps delivered_at
create or replace function public.mark_delivered(p_purchase uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_ts timestamptz;
begin
  update public.purchases
     set delivered_at = now()
   where id = p_purchase
     and branch_id = public.current_branch_id()
     and is_delivery = true
     and delivered_at is null
   returning delivered_at into v_ts;
  if v_ts is null then
    raise exception 'Delivery not found for this branch, or already delivered';
  end if;
  return v_ts;
end $$;
grant execute on function public.mark_delivered(uuid) to authenticated;

-- delivery KPIs (RLS scopes: branch = own, admin = all). 30-min SLA.
create or replace function public.delivery_stats()
returns table (pending bigint, delivered bigint, avg_minutes numeric, ontime_pct numeric)
language sql stable security invoker set search_path = public as $$
  with d as (
    select delivered_at,
           extract(epoch from (delivered_at - created_at)) / 60.0 as mins
    from public.purchases where is_delivery
  )
  select
    count(*) filter (where delivered_at is null),
    count(*) filter (where delivered_at is not null),
    round(avg(mins) filter (where delivered_at is not null)::numeric, 1),
    round(100.0 * count(*) filter (where delivered_at is not null and mins <= 30)
          / nullif(count(*) filter (where delivered_at is not null), 0), 0)
  from d;
$$;
grant execute on function public.delivery_stats() to authenticated;

-- ========== Customer extra fields ==========
alter table public.customers add column if not exists monthly_invoice_no text;
alter table public.customers add column if not exists remark text;
alter table public.customers add column if not exists prescription_path text;

-- org-wide totals for a customer (bypasses per-branch RLS to sum ALL branches)
create or replace function public.customer_stats(p_customer uuid)
returns table (total_spent numeric, visits bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(total_amount), 0), count(*)
  from public.purchases where customer_id = p_customer;
$$;
grant execute on function public.customer_stats(uuid) to authenticated;

-- ========== Prescriptions storage bucket (private) ==========
insert into storage.buckets (id, name, public)
values ('prescriptions', 'prescriptions', false)
on conflict (id) do nothing;

