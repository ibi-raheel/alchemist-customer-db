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
