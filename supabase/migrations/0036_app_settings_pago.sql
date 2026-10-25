-- 0036_app_settings_pago.sql — Datos bancarios para transferencias + interruptor para ocultar Mercado Pago.
-- Aditiva y mínima: reutiliza app_settings (0031). No crea tablas ni toca datos de suscripciones/pagos.
-- Por qué hace falta: la 0031 solo admitía 2 claves y valores enteros (no texto). Se agrega la columna text_value
-- y se amplían las claves permitidas. Las filas existentes (notice_days, grace_days) no cambian.
-- NO se aplica sola: ejecutar manualmente (primero en un proyecto de prueba). Mientras no se aplique, la app sigue
-- usando las variables de entorno TRANSFER_* y Mercado Pago sigue visible.

alter table public.app_settings add column if not exists text_value text;

-- Se reemplazan las restricciones CHECK de la 0031 (clave permitida y rango). No hay otras CHECK en la tabla.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.app_settings'::regclass and contype = 'c' loop
    execute format('alter table public.app_settings drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.app_settings add constraint app_settings_key_check check (
  key in ('notice_days', 'grace_days', 'mp_hidden', 'bank_holder', 'bank_cuit', 'bank_cbu', 'bank_alias'));

-- value sigue siendo entero: política (rangos 0031), mp_hidden (0 = visible, 1 = oculto) y 0 fijo para las claves de texto.
alter table public.app_settings add constraint app_settings_range check (
     (key = 'notice_days' and value between 1 and 15)
  or (key = 'grace_days'  and value between 0 and 30)
  or (key = 'mp_hidden'   and value in (0, 1))
  or (key in ('bank_holder', 'bank_cuit', 'bank_cbu', 'bank_alias') and value = 0));

-- Validación en la base (última defensa): CUIT/CUIL con formato XX-XXXXXXXX-X, CBU/CVU de exactamente 22 dígitos,
-- alias de 6 a 20 caracteres (letras, números, punto, guion). NULL = sin cargar.
alter table public.app_settings add constraint app_settings_text check (
     (key in ('notice_days', 'grace_days', 'mp_hidden') and text_value is null)
  or (key = 'bank_holder' and (text_value is null or char_length(text_value) between 2 and 120))
  or (key = 'bank_cuit'   and (text_value is null or text_value ~ '^[0-9]{2}-[0-9]{8}-[0-9]$'))
  or (key = 'bank_cbu'    and (text_value is null or text_value ~ '^[0-9]{22}$'))
  or (key = 'bank_alias'  and (text_value is null or text_value ~ '^[A-Za-z0-9.-]{6,20}$')));

-- Filas fijas (la clave es inmutable y no se insertan filas desde la app: solo UPDATE por admin, igual que en 0031).
insert into public.app_settings (key, value) values
  ('mp_hidden', 0), ('bank_holder', 0), ('bank_cuit', 0), ('bank_cbu', 0), ('bank_alias', 0)
on conflict (key) do nothing;

-- El admin ya podía actualizar value (RLS app_settings_admin_update); ahora también text_value.
grant update (value, text_value) on public.app_settings to authenticated;
