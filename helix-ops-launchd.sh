#!/bin/bash
# Helix Ops dashboard launchd wrapper. One listener on :8790.
set -euo pipefail
ROOT="/Users/matflaherty/.hermes/reports/ops-dashboard"
LOGDIR="/Users/matflaherty/.hermes/logs"
PY="/usr/bin/python3"
cd "$ROOT"
mkdir -p "$LOGDIR"
rotate() {
  local f="$1"
  if [[ -f "$f" ]]; then
    local sz
    sz=$(stat -f%z "$f" 2>/dev/null || echo 0)
    if [[ "$sz" -gt 5242880 ]]; then
      mv -f "$f" "${f}.1"
    fi
  fi
}
rotate "$LOGDIR/helix-ops.out.log"
rotate "$LOGDIR/helix-ops.err.log"

if /usr/sbin/lsof -nP -iTCP:8790 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "helix-ops: :8790 already bound; retry" >&2
  exit 1
fi
exec "$PY" "$ROOT/server.py"
