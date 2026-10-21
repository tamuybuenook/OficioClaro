# Continuación OficioClaro (generado 2026-10-19)

## Reglas
Seguir el prompt de dirección técnica original (entregas cortas, ZIP real por etapa, sin secretos, sin tocar producción, sin reescribir migraciones aplicadas 0022–0030). Usuario principiante, Windows + VS Code, Claude plan gratuito.

## Estado real
- **Etapa 1–2 (auditoría + recuperación de contraseña): código entregado** (`OficioClaro-Recuperacion-Etapa2.zip`). typecheck OK, 309 tests OK, build OK (variables ficticias).
- **Etapa 3 NO cerrada (aplazada):** el enlace del correo vuelve a la Site URL en vez de /reset-password. Falta la prueba manual con Supabase real (correo, enlace, nueva contraseña, enlace reutilizado) y comprobar que «Continuar con Google» sigue funcionando (el middleware cambió: `lib/auth/paths.ts`).
  Config requerida: Supabase Site URL y Redirect URLs `https://oficioclaro.vercel.app/auth/callback` (+ localhost); Vercel `APP_URL=https://oficioclaro.vercel.app`.
- **Etapa 4 (auditoría MP): cerrada** (`docs/AUDITORIA_MP_ESTADO.md`).
- **Etapa 5 (diseño): cerrada como documento** (`docs/DISENO_SUSCRIPCIONES_ETAPA5.md`). Sin código.

## Decisiones confirmadas
- URL provisoria: `https://oficioclaro.vercel.app` (cambiará en producción).
- Valores iniciales: prueba 30 días, aviso 5 días, gracia 5 días (configurables desde admin).
## Decisiones confirmadas en 6c
- Gracia con acceso completo; sin gracia al terminar la prueba sin pago (queda solo con Suscripción); gracia solo con pago previo `reconciled`.

## Decisiones NO confirmadas
- Qué ve un usuario suspendido por el admin (hoy: pantalla restringida con aviso).
- Proveedor de email (pendiente; se necesita en etapa 8).

## Riesgos abiertos
Embeds `plans(...)` ambiguos desde `subscriptions` (2 FK); prueba SQL agenda n.º 10 fallaba; cron diario sin verificar en Vercel; 10 pruebas Sandbox MP pendientes; pruebas SQL no ejecutadas en el entorno de Claude.

## Cola de tareas (orden confirmado por el usuario)
1. Cerrar etapa 3 (recuperación: el enlace del correo vuelve a la Site URL; revisar Redirect URLs `https://oficioclaro.vercel.app/**`, `APP_URL`, redeploy; y probar «Continuar con Google»).
2. Probar 6c en proyecto de prueba (ver `docs/INFORME_CIERRE_ETAPA6C.md`). Decidir qué ve un usuario suspendido por el admin.
3. ~~Planes de 3 y 6 meses~~ **Código entregado** (`docs/INFORME_CIERRE_PLANES_3_6_MESES.md`): migración 0032 escrita y probada en Postgres local (NO aplicada en Supabase). Falta: aplicarla en el proyecto de prueba, cargar los planes y probar en Sandbox de MP.
4. **Etapa 7 cerrada** (7a tabla/sync + 7b banner; `docs/INFORME_CIERRE_ETAPA7A.md` y `7B.md`; migración 0033 sin aplicar). Siguiente: etapa 8 (emails + cron; necesita decidir proveedor de email), 9 Sandbox, 10–11 optimización. Más adelante: cerrar el bloqueo también en RLS.

## Próximo paso
Planes 3/6 meses entregados (0032 sin aplicar). Las pruebas SQL ahora se pueden correr en el entorno de Claude (Postgres 16 local).
Estado: 4, 5, 6a, 6b, 6c cerradas (0031 aplicada). 6c entregada sin prueba en Supabase real.
Decisiones 6c (2026-10-20): prueba terminada sin pago → sin gracia y solo Suscripción; cobro fallido → gracia (acceso completo) → solo Suscripción; gracia solo con pago `reconciled` previo; admin nunca se bloquea.

## Archivos a adjuntar en el chat nuevo
El proyecto completo actualizado en ZIP (sin node_modules/.next/.env) y este archivo.
