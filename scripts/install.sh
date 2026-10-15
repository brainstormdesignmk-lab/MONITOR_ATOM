#!/bin/sh
set -e

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
INSTALL_DIR="/opt/metropolis/monitor"

echo "=== METROPOLIS MONITOR INSTALLER ==="

sudo mkdir -p "$INSTALL_DIR"
sudo cp -r "$PROJECT_DIR/src" "$PROJECT_DIR/config" \
    "$PROJECT_DIR/package.json" "$INSTALL_DIR/"
sudo cp "$PROJECT_DIR/init.d/monitor-runner" "$INSTALL_DIR/monitor-runner.sh"
sudo chmod 755 "$INSTALL_DIR/monitor-runner.sh"

sudo mkdir -p "$INSTALL_DIR/data/logs" "$INSTALL_DIR/data/state"

if ! id atom >/dev/null 2>&1; then
    echo "Required service account 'atom' does not exist. Create it, then rerun installer."
    exit 1
fi
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
    echo "Node.js was not found in PATH. Install Node.js 16 or newer first."
    exit 1
fi
NODE_MAJOR="$($NODE_BIN -p 'process.versions.node.split(".")[0]')"
case "$NODE_MAJOR" in ''|*[!0-9]*) echo "Could not determine Node.js version"; exit 1;; esac
if [ "$NODE_MAJOR" -lt 16 ]; then
    echo "Node.js 16 or newer is required (found $NODE_MAJOR)."
    exit 1
fi
if ! sudo -u atom "$NODE_BIN" --version >/dev/null; then
    echo "The atom service account cannot execute $NODE_BIN. Install Node.js system-wide."
    exit 1
fi

if [ -f "$PROJECT_DIR/.env" ]; then
    sudo cp "$PROJECT_DIR/.env" "$INSTALL_DIR/.env"
    sudo chown atom:atom "$INSTALL_DIR/.env"
    sudo chmod 600 "$INSTALL_DIR/.env"
fi

# This repo contains Atom6's fleet inventory and is its source of truth.
sudo cp "$PROJECT_DIR/config/nodes.json" "$INSTALL_DIR/config/nodes.json"

sudo cp "$PROJECT_DIR/init.d/metropolis-monitor" /etc/init.d/metropolis-monitor
sudo chmod 755 /etc/init.d/metropolis-monitor
sudo sh -c "cat > /etc/default/metropolis-monitor <<'EOF'
NODE_BIN=$NODE_BIN
RUN_USER=atom
EOF"
sudo chown -R atom:atom "$INSTALL_DIR/data"
sudo sh -c 'cat > /usr/local/bin/metropolis-dashboard <<"EOF"
#!/bin/sh
NODE_BIN=/usr/bin/node
[ ! -r /etc/default/metropolis-monitor ] || . /etc/default/metropolis-monitor
exec "$NODE_BIN" /opt/metropolis/monitor/src/dashboard.js
EOF
chmod 755 /usr/local/bin/metropolis-dashboard'
sudo update-rc.d metropolis-monitor defaults

echo "Installation complete. Start with:"
echo "  sudo service metropolis-monitor start"
echo "  metropolis-dashboard"
