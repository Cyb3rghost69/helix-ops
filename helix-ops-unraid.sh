#!/bin/bash
# HELIX/OPS on Unraid — start | stop | restart | status
# Use with the User Scripts plugin ("At Startup of Array" → start). Needs python3 on the host
# (e.g. the "Python 3 for UNRAID" plugin or NerdTools). No secrets here: ops.env stays beside server.py.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$DIR/.helix-ops.pid"
LOG="$DIR/helix-ops.log"
export HELIX_ON_UNRAID=1
# Point at Hermes's data if it isn't in ~/.hermes (e.g. an appdata share). Leave unset otherwise.
# export HELIX_HERMES_HOME=/mnt/user/appdata/hermes

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

start() {
  if running; then echo "already running (pid $(cat "$PIDFILE"))"; return 0; fi
  command -v python3 >/dev/null || { echo "python3 not found — install the Python 3 plugin first"; return 1; }
  python3 -m py_compile "$DIR/server.py" || { echo "server.py failed to compile"; return 1; }
  cd "$DIR" || return 1
  nohup python3 server.py >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 2
  if running && curl -fs -m 5 http://127.0.0.1:8790/health >/dev/null; then
    echo "HELIX/OPS up on :8790 (pid $(cat "$PIDFILE"))"
  else
    echo "start failed — last log lines:"; tail -n 20 "$LOG"; return 1
  fi
}

stop() {
  if running; then
    local pid; pid="$(cat "$PIDFILE")"
    kill "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    echo "stopped"
  else
    echo "not running"
  fi
  rm -f "$PIDFILE"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) if running; then echo "running (pid $(cat "$PIDFILE"))"; curl -s -m 5 http://127.0.0.1:8790/health; echo; else echo "not running"; fi ;;
  *) echo "usage: $0 start|stop|restart|status"; exit 2 ;;
esac
