# OficioClaro — Arquitectura (Bloque 1)

## A. Estado actual
Repo generado por v0: Next.js 16 (App Router) + React 19 + Tailwind v4, un único
`app/page.tsx` con todo el UI mockeado (navegación por `useState<View>`, datos
`jobs` hardcodeados). Sin Supabase, sin backend, sin tests, sin auth real.

## B. Problemas
- Todo el estado vive en el cliente (no hay persistencia).
- No hay separación UI / lógica de negocio / datos.
- `next.config.mjs` ignora errores de TS en build (`ignoreBuildErrors: true`) — lo
  vamos a sacar antes de ir a producción, no en este bloque para no romper el
  front de v0 mientras se sigue iterando ahí.

## C. Arquitectura propuesta
```
UI (v0, app/page.tsx y futuros componentes)
  -> hooks/acciones (lib/actions/*)
    -> servicios de negocio (lib/services/*)  [precio referencia, UT, etc.]
      -> Supabase client (lib/supabase/*)
```
- `lib/supabase/client.ts`: cliente browser (anon key).
- `lib/supabase/server.ts`: cliente server (cookies, Server Actions/RSC).
- `lib/supabase/types.ts`: tipos de la DB (a regenerar con `supabase gen types`
  cuando el proyecto Supabase real exista; por ahora tipado manual mínimo).
- Rutas `/admin/*` como route group separado, protegido por rol.

## D. Modelo de datos (Bloque 1 — núcleo, sin sobreingeniería)
- `profiles` (1:1 con `auth.users`): rol, zona, valor de UT personal.
- `regions`: zonas con `adjustment_percent` (ajuste regional).
- `trades` / `categories` / `services`: oficio → categoría → trabajo.
  `services.ut_coefficient` (nullable): si existe, precio = coeficiente × UT
  del usuario; si no, precio = precio de la versión vigente.
- `price_lists` / `price_list_versions` / `price_items`: lista maestra
  versionada e inmutable una vez publicada.
- `ipc_indexes`: valores de IPC y a qué versión de lista aplican.
- `user_price_items`: precio personalizado por usuario y servicio (no toca el
  IPC ni la referencia).
- `customers`, `quotes`, `quote_items`: presupuestos simples.
- `plans`, `subscriptions`, `payments`, `bank_reconciliations`: suscripciones y
  conciliación manual (transferencia). Mercado Pago se agrega en un bloque
  posterior sin tocar este esquema (campo `payments.provider`).
- `audit_logs`: genérico (tabla, entidad, antes/después) para todo cambio
  crítico (precios, IPC, suscripciones, permisos).

El precio de referencia (`base × ajuste regional`) **se calcula**, no se
guarda: evita inconsistencias y respeta la sección 10 (conservar relación
base→ajuste→resultado) sin duplicar datos.

## E. Plan de bloques
1. **Bloque 1 (este):** esquema SQL + RLS + clientes Supabase. *(sin conectar
   a un proyecto real todavía — falta que me pases las env vars)*.
2. Bloque 2: Auth (login/registro) + creación automática de `profiles`.
3. Bloque 3: Oficios/categorías/servicios + admin CRUD básico.
4. Bloque 4: Listas maestras + versionado + publicación inmutable.
5. Bloque 5: Motor de precios (referencia + UT) + tests.
6. Bloque 6: IPC y actualización de listas.
7. Bloque 7+: ajustes regionales finos, personalización, buscador, clientes,
   presupuestos, planes/pagos, conciliación, admin completo, PWA.

## F. Qué se hizo en este bloque
- Migraciones SQL (`supabase/migrations/0001_schema.sql`,
  `0002_rls.sql`) con el núcleo de tablas y políticas RLS.
- Clientes Supabase (`lib/supabase/client.ts`, `server.ts`, `types.ts`).
- `.env.example` con las variables necesarias.
- Dependencias `@supabase/supabase-js` y `@supabase/ssr` agregadas a
  `package.json`.

## Pendiente / necesito de vos
- Crear el proyecto en Supabase y pasarme `NEXT_PUBLIC_SUPABASE_URL` y
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (o las cargás vos en Vercel/`.env.local`).
- Confirmar si el modelo de datos te cierra antes de avanzar al Bloque 2
  (Auth), ya que las tablas siguientes dependen de `profiles`.
