#!/usr/bin/env bash
# Pruebas SQL de la migración 0022 (agenda). Requiere el Postgres local de run_baseline.sh.
# Aplica hasta 0021, siembra datos "viejos" y recién ahí aplica 0022 (prueba de compatibilidad).
set -euo pipefail
D="$(dirname "$0")"
"$D/run_baseline.sh" oc_agenda 21
psql -h /tmp -p 5433 -U postgres -d oc_agenda -f "$D/02_agenda.sql" 2>&1
