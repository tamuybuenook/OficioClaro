-- PROPUESTA ORIGINAL (NO APLICAR, NO ES UNA MIGRACIÓN). Se conserva solo como referencia de lo que se recibió.
-- La migración real y acotada es supabase/migrations/0034_fix_service_role_permissions.sql. Motivos de no usar esta versión:
--   1) falta COMMIT: el BEGIN queda abierto y, según cómo se ejecute, los GRANT pueden no quedar confirmados;
--   2) GRANT ALL sobre TODAS las tablas incluye DELETE/TRUNCATE y tablas que el servidor no usa;
--   3) ALTER DEFAULT PRIVILEGES abre automáticamente cualquier tabla futura sin revisarla.
BEGIN;

GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
TO service_role;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
