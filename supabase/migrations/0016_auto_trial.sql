-- 0016_auto_trial.sql
--
create or replace function handle_new_profile_trial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan record;
begin
  select id, trial_days into v_plan from plans where is_active = true order by (max_trades is null) desc, price asc limit 1;
  if v_plan.id is null then
    return new;
  end if;
  insert into subscriptions (user_id, plan_id, status, start_date, end_date)
  values (new.id, v_plan.id, 'trial', current_date, (current_date + (v_plan.trial_days || ' days')::interval)::date);
  return new;
end;
$$;

create trigger on_profile_created_start_trial
  after insert on profiles
  for each row execute function handle_new_profile_trial();
