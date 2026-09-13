#!/bin/sh
set -e

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
INSTALL_DIR="/opt/metropolis/monitor"

echo "=== METROPOLIS MONITOR INSTALLER ==="

sudo mkdir -p "$INSTALL_DIR"
sudo cp -r "$PROJECT_DIR/src" "$PROJECT_DIR/config" \
    "$PROJECT_DIR/package.json" "$INSTALL_DIR/"

sudo mkdir -p "$INSTALL_DIR/data/logs" "$INSTALL_DIR/data/state"

if [ -f "$PROJECT_DIR/.env" ]; then
    sudo cp "$PROJECT_DIR/.env" "$INSTALL_DIR/.env"
fi

# nodes.json is machine-specific: install it only if the target doesn't have one
if [ ! -f "$INSTALL_DIR/config/nodes.json" ]; then
    sudo cp "$PROJECT_DIR/config/nodes.json" "$INSTALL_DIR/config/nodes.json"
fi

sudo cp "$PROJECT_DIR/systemd/metropolis-monitor.service" \
    /etc/systemd/system/metropolis-monitor.service

sudo systemctl daemon-reload
sudo systemctl enable metropolis-monitor

echo "Installation complete. Start with:"
echo "  sudo systemctl start metropolis-monitor"
