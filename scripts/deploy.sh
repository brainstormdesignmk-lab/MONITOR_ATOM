#!/bin/sh
set -e

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

echo "Running tests..."
cd "$PROJECT_DIR"
node --test
echo "Tests passed."

sudo systemctl stop metropolis-monitor 2>/dev/null || true
./scripts/install.sh

sudo systemctl start metropolis-monitor
sleep 2

if curl -fsS http://127.0.0.1:8500/health > /dev/null; then
    echo "=== MONITOR DEPLOYED SUCCESSFULLY ==="
else
    echo "MONITOR FAILED HEALTH CHECK"
    sudo systemctl status metropolis-monitor --no-pager
    exit 1
fi
