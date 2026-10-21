#!/usr/bin/env bash
set -euo pipefail
D="$(dirname "$0")"
"$D/run_baseline.sh" oc_notif 9999
psql -h /tmp -p 5433 -U postgres -d oc_notif -f "$D/06_notifications.sql" 2>&1
