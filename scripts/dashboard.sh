#!/bin/sh
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec node "$PROJECT_DIR/src/dashboard.js"
