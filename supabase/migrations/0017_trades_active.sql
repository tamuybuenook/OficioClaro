-- 0017_trades_active.sql
alter table trades add column is_active boolean not null default true;
