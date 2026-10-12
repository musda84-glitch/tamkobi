#!/bin/sh
# shellcheck shell=sh source-path=SCRIPTDIR
# Aktif port, sha, frontend-current, iki portun /api/version çıktısı.
set -eu

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"

cd "$ROOT" 2>/dev/null || true

echo "ROOT=$ROOT"
echo "marker=$([ -f "$MARKER" ] && echo yes || echo no)"
echo "upstream_conf=$UPSTREAM_CONF"
ACTIVE=$(active_upstream_port)
echo "active_upstream_port=${ACTIVE:-?}"

if [ -L "$FRONTEND_CURRENT" ] || [ -e "$FRONTEND_CURRENT" ]; then
  echo "frontend-current=$(readlink -f "$FRONTEND_CURRENT" 2>/dev/null || readlink "$FRONTEND_CURRENT" 2>/dev/null || echo "$FRONTEND_CURRENT")"
else
  echo "frontend-current=(yok)"
fi

for p in 8000 8001; do
  unit="tamkobi-backend@${p}"
  state=$(systemctl is-active "$unit" 2>/dev/null || echo inactive)
  printf 'port %s: unit=%s ' "$p" "$state"
  if curl -fsS --max-time 3 "http://127.0.0.1:${p}/api/version" >/tmp/tamkobi-status-"$p".json 2>/dev/null; then
    python3 -c "import json;d=json.load(open('/tmp/tamkobi-status-$p.json'));print('git_sha=%s short=%s' % (d.get('git_sha'), d.get('git_sha_short')))"
  else
    echo "version=(yanıt yok)"
  fi
done

if [ -n "${ACTIVE:-}" ]; then
  echo "--- nginx → :$ACTIVE ---"
fi
