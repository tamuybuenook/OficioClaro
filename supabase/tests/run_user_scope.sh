#!/usr/bin/env bash
# Etapa 2: aislamiento de datos del usuario. Requiere el Postgres local de run_baseline.sh.
set -euo pipefail
D="$(dirname "$0")"
bash "$D/run_baseline.sh" oc_scope 9999
psql -h /tmp -p 5433 -U postgres -d oc_scope -f "$D/09_user_scope.sql" 2>&1
