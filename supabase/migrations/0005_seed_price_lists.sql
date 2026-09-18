-- 0005_seed_price_lists.sql
alter table price_lists add constraint price_lists_trade_uniq unique (trade_id);

insert into regions (name, adjustment_percent) values ('Zona Centro', 10.00)
on conflict (name) do nothing;

insert into price_lists (trade_id, name)
select id, name || ' - Lista maestra' from trades
on conflict (trade_id) do nothing;

insert into price_list_versions (price_list_id, version_label, status, effective_date, published_at)
select pl.id, 'Octubre 2026', 'published', date '2026-10-01', now()
from price_lists pl
on conflict (price_list_id, version_label) do nothing;

insert into price_items (price_list_version_id, service_id, base_price)
select v.id, s.id, p.base_price
from price_list_versions v
join price_lists pl on pl.id = v.price_list_id
join trades t on t.id = pl.trade_id
join categories c on c.trade_id = t.id
join services s on s.category_id = c.id
join (values
  ('Cambio de canilla', 35000),
  ('Reparación de pérdida', 28000),
  ('Instalación de calefón', 85000),
  ('Instalación de artefacto', 42000),
  ('Pintura de ambiente', 5200)
) as p(service_name, base_price) on p.service_name = s.name
where v.version_label = 'Octubre 2026'
on conflict (price_list_version_id, service_id) do nothing;
