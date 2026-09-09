#!/usr/bin/env bash
# Generate strong MySQL passwords, apply least-privilege grants, update gitignored .env files.
# Existing Docker volumes ignore initdb.d — this is the supported way to harden them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${ROOT}/backend${PYTHONPATH:+:${PYTHONPATH}}"
exec python3 "${ROOT}/backend/mysql_users.py" "$@"
