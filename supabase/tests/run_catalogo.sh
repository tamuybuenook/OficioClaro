#!/usr/bin/env bash
# Pruebas SQL de la migración 0035 (catálogo propio y presupuestos). Requiere el Postgres local de run_baseline.sh.
set -euo pipefail
D="$(dirname "$0")"
bash "$D/run_baseline.sh" oc_catalogo
psql -h /tmp -p 5433 -U postgres -d oc_catalogo -f "$D/07_catalogo_presupuestos.sql" 2>&1
