-- 0014_profile_and_trial.sql
alter table plans add column trial_days integer not null default 30;

alter table profiles
  add column cuit text,
  add column address text,
  add column city text,
  add column province text;

create table payment_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  bank text,
  alias text,
  cbu text,
  account_holder text,
  holder_cuit text,
  mercado_pago_alias text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table payment_details enable row level security;
create policy payment_details_own on payment_details
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

grant select, insert, update on payment_details to authenticated;
