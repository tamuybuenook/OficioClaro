#!/usr/bin/env bash
# Crea una DB limpia, aplica stubs + migraciones hasta el número indicado (por defecto todas).
set -euo pipefail
DB=${1:-oc_test}; UPTO=${2:-9999}
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f "$(dirname "$0")/00_supabase_stubs.sql"
for f in "$(dirname "$0")"/../migrations/*.sql; do
  n=$(basename "$f" | cut -c1-4)
  if [ "$((10#$n))" -le "$UPTO" ]; then $P -d $DB -f "$f"; fi
done
echo "migraciones aplicadas hasta $UPTO en $DB"
