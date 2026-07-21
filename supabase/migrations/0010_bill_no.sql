-- 0010_bill_no.sql — optional bill/invoice number on each purchase.
-- Links our record to the branch POS bill for reconciliation.

alter table public.purchases
  add column if not exists bill_no text;
