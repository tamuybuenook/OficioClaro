-- 0007_seed_plans.sql
insert into plans (name, price, billing_period, is_active) values
  ('Profesional', 9000, 'monthly', true)
on conflict (name) do nothing;
