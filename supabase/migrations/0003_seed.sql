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
