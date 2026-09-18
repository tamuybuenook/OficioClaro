-- 0013_user_trades.sql
alter table plans add column max_trades integer; -- null = sin límite (todos los oficios)
update plans set max_trades = null where name = 'Profesional';

insert into plans (name, price, billing_period, max_trades, is_active) values
  ('Básico', 5000, 'monthly', 1, true),
  ('Medium', 8000, 'monthly', 3, true)
on conflict (name) do nothing;

create table user_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  trade_id uuid not null references trades(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, trade_id)
);

alter table user_trades enable row level security;

create policy user_trades_own on user_trades
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

grant select, insert, delete on user_trades to authenticated;
