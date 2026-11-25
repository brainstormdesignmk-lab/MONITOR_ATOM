#!/bin/sh
set -u

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || true)}"
if [ -z "$NODE_BIN" ]; then
    for candidate in /usr/local/bin/node /usr/bin/node /bin/node; do
        if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
    done
fi
PIDFILE="$APP_DIR/data/state/monitor-supervisor.pid"
STOP_MARKER="$APP_DIR/data/state/monitor-supervisor.disabled"
SUPERVISOR_LOG="$APP_DIR/data/logs/supervisor.log"
CRON_MARKER="# metropolis-monitor-user-service"

running() {
    [ -s "$PIDFILE" ] || return 1
    PID="$(cat "$PIDFILE" 2>/dev/null || true)"
    case "$PID" in ''|*[!0-9]*) return 1;; esac
    kill -0 "$PID" 2>/dev/null || return 1
    STATE="$(ps -p "$PID" -o stat= 2>/dev/null | tr -d ' ' || true)"
    case "$STATE" in Z*|'') return 1;; esac
    ps -p "$PID" -o args= 2>/dev/null | grep -F "$APP_DIR/init.d/monitor-runner" >/dev/null || return 1
    return 0
}

start_service() {
    [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || { echo "Executable Node.js was not found" >&2; return 1; }
    mkdir -p "$APP_DIR/data/logs" "$APP_DIR/data/state"
    rm -f "$STOP_MARKER"
    if running; then echo "Monitor supervisor already running"; return 0; fi
    rm -f "$PIDFILE"
    nohup env MONITOR_DIR="$APP_DIR" NODE_BIN="$NODE_BIN" \
        "$APP_DIR/init.d/monitor-runner" </dev/null >>"$SUPERVISOR_LOG" 2>&1 &
    echo "$!" > "$PIDFILE"
    sleep 1
    if running; then echo "Monitor supervisor started (pid $(cat "$PIDFILE"))"; else
        rm -f "$PIDFILE"
        echo "Monitor supervisor failed to start; inspect $SUPERVISOR_LOG" >&2
        return 1
    fi
}

stop_service() {
    mkdir -p "$APP_DIR/data/state"
    : > "$STOP_MARKER"
    if ! running; then rm -f "$PIDFILE"; echo "Monitor supervisor is not running"; return 0; fi
    PID="$(cat "$PIDFILE")"
    kill -TERM "$PID" 2>/dev/null || true
    n=0
    while [ "$n" -lt 15 ] && kill -0 "$PID" 2>/dev/null; do
        sleep 1
        n=$((n + 1))
    done
    if kill -0 "$PID" 2>/dev/null; then
        echo "Monitor did not stop within 15 seconds" >&2
        return 1
    fi
    rm -f "$PIDFILE"
    echo "Monitor supervisor stopped"
}

install_cron() {
    current="$(crontab -l 2>/dev/null || true)"
    current="$(printf '%s\n' "$current" | grep -Fv "$CRON_MARKER" || true)"
    { [ -z "$current" ] || printf '%s\n' "$current"; \
      printf '@reboot %s start %s\n' "$APP_DIR/scripts/user-service.sh" "$CRON_MARKER"; \
      printf '* * * * * %s ensure %s-watchdog\n' "$APP_DIR/scripts/user-service.sh" "$CRON_MARKER"; } | crontab -
    echo "Installed per-user boot entry and one-minute recovery check"
    start_service
}

case "${1:-status}" in
    start) start_service ;;
    ensure) if [ -e "$STOP_MARKER" ] || running; then exit 0; else start_service; fi ;;
    stop) stop_service ;;
    restart) stop_service && start_service ;;
    status) if running; then echo "Monitor supervisor running (pid $(cat "$PIDFILE"))"; else echo "Monitor supervisor stopped"; exit 1; fi ;;
    install) install_cron ;;
    *) echo "Usage: $0 {install|start|stop|restart|status|ensure}" >&2; exit 2 ;;
esac
