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
