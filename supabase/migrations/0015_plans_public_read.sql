-- 0015_plans_public_read.sql
create policy plans_read_anon on plans
  for select using (auth.role() = 'anon' and is_active = true);
