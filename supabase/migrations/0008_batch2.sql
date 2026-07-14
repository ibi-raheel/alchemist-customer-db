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
