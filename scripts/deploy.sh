#!/bin/sh
set -e

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

sudo service metropolis-monitor stop 2>/dev/null || true
./scripts/install.sh

sudo service metropolis-monitor start
sleep 3

if curl --connect-timeout 2 --max-time 5 -fsS http://127.0.0.1:8500/health > /dev/null; then
    echo "=== MONITOR DEPLOYED SUCCESSFULLY ==="
else
    echo "MONITOR FAILED HEALTH CHECK"
    sudo service metropolis-monitor status || true
    tail -80 /opt/metropolis/monitor/data/logs/monitor.log || true
    exit 1
fi
