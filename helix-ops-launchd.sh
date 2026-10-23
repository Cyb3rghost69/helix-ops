#!/bin/bash
# LaunchAgent wrapper for HELIX/OPS (com.helix.ops-dashboard). Do not print secrets.
cd /Users/matflaherty/.hermes/reports/ops-dashboard || exit 1
exec /usr/bin/python3 server.py
