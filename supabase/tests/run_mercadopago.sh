#!/usr/bin/env bash
# Pruebas SQL de la migración 0023 (Mercado Pago + correcciones de seguridad). Requiere el Postgres local de run_baseline.sh.
set -euo pipefail
D="$(dirname "$0")"
bash "$D/run_baseline.sh" oc_mp 9999
psql -h /tmp -p 5433 -U postgres -d oc_mp -f "$D/03_mercadopago.sql" 2>&1
