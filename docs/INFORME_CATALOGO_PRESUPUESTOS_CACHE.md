# Informe: presupuestos, formularios sin modales, catálogo propio y caché local

Estado: implementado y probado en entorno local. **No se desplegó ni se aplicó ninguna migración a Supabase.**
Mercado Pago y suscripciones: sin cambios (solo se reutiliza `requireFullAccess`).

## Causas reales encontradas
| Problema | Causa real |
|---|---|
| Listas lentas | `getMyList`, `fetchCategoryPage` y la búsqueda llamaban a `getServicePricing` **por cada servicio** (~6 consultas en serie cada uno). Medido con el mismo escenario: 10 servicios 60→6 consultas; 100: 600→6; 500: 3000→18. |
| "Modales incómodos" de presupuesto | No eran modales: eran `window.prompt` con listas numeradas para elegir cliente, trabajo y cantidad. |
| Presupuesto sin concepto propio | `quote_items.service_id` era NOT NULL y no existía catálogo por usuario. |
| Numeración | `count + 1` repetía números tras borrar presupuestos y tenía carrera ante dos guardados simultáneos. |
| `getMyList` | Además cortaba en silencio a 1000 servicios (límite de PostgREST). Ahora pagina. |

## Migración nueva: `supabase/migrations/0035_catalogo_propio_y_presupuestos.sql`
Aditiva, falla con mensaje claro si 0020/0022 no están aplicadas. Contenido: tabla `catalog_items` (RLS solo dueño, `user_id` fijado por trigger = `auth.uid()`, sin DELETE), `quote_items` admite conceptos propios/libres (`service_id` nullable, `catalog_item_id`, `unit_label`, `position`), `quotes.client_request_id` (idempotencia), validación de cliente propio, `save_quote()` (atómica, calcula subtotales/total en la base), `my_sync_stamp()`.
Diagnóstico de solo lectura: `supabase/diagnostics/0035_check_quote_numbers.sql`.
**No se agregó índice único a `quotes.number`** porque datos existentes podrían tener repetidos (decisión que podía comprometer datos).

### Cambio de regla comercial (identificado, requiere tu aprobación)
Un presupuesto enviado/aceptado/rechazado **ya no admite cambios en sus ítems** (trigger). Antes la app lo permitía. Para corregir uno enviado/rechazado hay un botón "Volver a borrador"; los aceptados no se reabren.

## Qué cambió en la app
- **Un solo formulario** (`components/features/quotes/quote-editor.tsx`) con los mismos cálculos y guardado, desde: Clientes ("Presupuestar" en la lista y en el detalle), Agenda (en el trabajo: "Guardar y armar presupuesto" y "Vincular uno existente") y Presupuestos.
- Cliente: búsqueda y alta **dentro** del formulario. Conceptos: pestañas Mi catálogo / Lista de precios, búsqueda en servidor, paginado, alta de concepto sin perder lo cargado, deshacer al quitar línea.
- Línea editable (descripción, cantidad, precio) sin tocar el catálogo. Errores junto al campo.
- **Mi catálogo** (nueva pantalla): crear, editar, desactivar, buscar por nombre/categoría.
- Vínculo cliente–trabajo–presupuesto en una sola actualización; reintentos idempotentes (clave `requestId` + índice único existente por presupuesto activo).

## Caché local (en cada dispositivo, no en servidor)
`lib/cache/`: `idb.ts` (IndexedDB, almacenes `cache` y `drafts`), `store.ts` (memoria + disco, TTL, deduplicación de consultas simultáneas, invalidación por prefijo, aviso a otras pestañas), `sync.ts` (sello `my_sync_stamp` para detectar cambios hechos desde otro dispositivo), `drafts.ts` (borradores locales), `use-cached-query.ts`.
- Toda clave lleva el id del usuario; al cambiar de cuenta se purga lo de la anterior; **Cerrar sesión borra memoria, disco y borradores**; las pantallas de acceso/inicio borran la caché de datos (conservan borradores del mismo usuario hasta que otra cuenta inicie sesión). Usuario bloqueado por suscripción: se purga la caché de datos.
- No se guardan credenciales ni datos de suscripción/pago. La caché nunca autoriza: cada acción vuelve a verificar sesión, acceso y RLS.
- Invalidación: al crear/editar/desactivar (local + otras pestañas) y por sello al abrir, al volver a la pestaña y al recuperar conexión. Clientes: TTL de 2 min + invalidación local.
- Sin Redis ni infraestructura nueva.

## Pruebas (resultado real)
- Vitest: **56 archivos, 751 pruebas, todas pasan** (línea base: 49 / 639). Incluye interfaz con jsdom, caché con IndexedDB simulada, acciones, paridad de precios lote-vs-original y las 2 suites contra Postgres real.
- `tsc --noEmit`: sin errores. `next build`: compila.
- SQL contra PostgreSQL 16 real: nuevas **38/38** (`supabase/tests/run_catalogo.sh`); acceptance 94/94, notifications 26/26, plan_periods 19/19. `run_agenda.sh` #10 falla (preexistente, documentado en `CONTINUACION_OFICIOCLARO.md`).
- Pruebas de mutación del caché: al desactivar la purga de cuenta o la invalidación, los tests fallan (detectan la regresión).
- Bugs que las propias pruebas encontraron y corregí: `WITH ORDINALITY` inválido en `save_quote`; el total lanzaba excepción (pantalla rota) si se vaciaba la cantidad/precio mientras se escribía.

## Lo que NO está verificado / pendiente
1. **Móvil**: revisado por diseño responsive (campos ≥44 px, columna única, barra de guardado fija sobre la barra inferior) y por pruebas jsdom; **no probado en navegador ni dispositivo real**.
2. Las consultas a PostgREST (`.or()` repetido, `in('categories.trade_id')` con `!inner`, `rpc`) se probaron con dobles; el SQL sí contra Postgres real. Hacer una prueba de humo en un proyecto Supabase de pruebas tras aplicar 0035.
3. **0035 depende de 0022** (agenda), que el repositorio documenta como no aplicada en producción.
4. `pnpm-lock.yaml` no se regeneró: agregué solo devDependencies (`fake-indexeddb`, `jsdom`, `@testing-library/*`). Ejecutar `pnpm install`.
5. No existe script de lint en el repo.
6. Siguen `window.prompt/confirm` en: detalle de cliente (trabajo realizado, notas, valoración), borrar cliente, panel admin, perfil (UT), diálogo de oficios. No son del flujo de presupuestos; se dejaron a propósito.
7. Acciones viejas `createQuote/addQuoteItem/updateQuoteItemQuantity/removeQuoteItem` ya no las usa la UI (siguen con sus tests). Recomiendo retirarlas.
8. No hay organizaciones en el esquema: la propiedad es por usuario.
9. Búsqueda en lista de precios: solo por nombre (el catálogo propio busca por nombre y categoría).
10. `/` aún envía al navegador la lista completa `jobs` (ahora se calcula rápido, pero sigue siendo todo el volumen). Siguiente paso: cargarla bajo demanda.
11. Cerrar sesión en una pestaña no vacía la memoria de otras pestañas ya abiertas (el disco sí se borra; sus acciones fallan por falta de sesión).
12. Los borradores locales se descartan a los 30 días y al cerrar sesión explícitamente.

## Orden sugerido para aplicar
Probar en un proyecto de pruebas: 0022 → 0035 → `supabase/tests/run_catalogo.sh` equivalente → prueba de humo de la app. Antes, correr `0035_check_quote_numbers.sql`.
