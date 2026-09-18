-- 0006_fix_subscriptions_rls.sql
drop policy if exists subscriptions_admin_write on subscriptions;

create policy subscriptions_insert on subscriptions
  for insert with check (
    is_admin() or (user_id = auth.uid() and status = 'trial')
  );
