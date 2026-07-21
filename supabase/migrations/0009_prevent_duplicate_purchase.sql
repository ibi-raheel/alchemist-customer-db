-- 0009_prevent_duplicate_purchase.sql
-- Guard against accidental double-entry: block a second identical sale
-- (same customer + branch + amount) within 2 minutes. Race-safe via an
-- advisory lock, so even same-instant double-taps are caught.

create or replace function public.prevent_duplicate_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- serialize concurrent identical inserts so a true double-tap can't slip through
  perform pg_advisory_xact_lock(
    hashtext(new.customer_id::text || ':' || new.branch_id::text || ':' || new.total_amount::text)
  );
  if exists (
    select 1 from public.purchases
    where customer_id = new.customer_id
      and branch_id   = new.branch_id
      and total_amount = new.total_amount
      and created_at >= now() - interval '2 minutes'
  ) then
    raise exception 'DUPLICATE_PURCHASE' using errcode = '23505';
  end if;
  return new;
end $$;

-- Fires before the points-setting trigger (name sorts first), so a duplicate is
-- rejected before any points are calculated.
drop trigger if exists trg_prevent_dup_purchase on public.purchases;
create trigger trg_prevent_dup_purchase
  before insert on public.purchases
  for each row execute function public.prevent_duplicate_purchase();
