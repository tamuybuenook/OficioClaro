-- 0004_seed_catalog.sql
alter table services add constraint services_category_name_uniq unique (category_id, name);

insert into trades (name, slug) values
  ('Plomería', 'plomeria'),
  ('Gasista', 'gasista'),
  ('Electricidad', 'electricidad'),
  ('Pintura', 'pintura')
on conflict (name) do nothing;

insert into categories (trade_id, name)
select t.id, c.name from trades t
join (values
  ('Plomería', 'Reparaciones'),
  ('Gasista', 'Instalaciones'),
  ('Electricidad', 'Instalaciones'),
  ('Pintura', 'Interiores')
) as c(trade_name, name) on t.name = c.trade_name
on conflict (trade_id, name) do nothing;

insert into services (category_id, name, unit_label, ut_coefficient)
select cat.id, s.name, s.unit_label, s.ut_coefficient
from categories cat
join trades t on t.id = cat.trade_id
join (values
  ('Plomería', 'Reparaciones', 'Cambio de canilla', 'Trabajo', 2.5),
  ('Plomería', 'Reparaciones', 'Reparación de pérdida', 'Trabajo', 2.0),
  ('Gasista', 'Instalaciones', 'Instalación de calefón', 'Trabajo', 6.2),
  ('Electricidad', 'Instalaciones', 'Instalación de artefacto', 'Trabajo', 3.5),
  ('Pintura', 'Interiores', 'Pintura de ambiente', 'm²', 0.4)
) as s(trade_name, category_name, name, unit_label, ut_coefficient)
  on t.name = s.trade_name and cat.name = s.category_name
on conflict (category_id, name) do nothing;
