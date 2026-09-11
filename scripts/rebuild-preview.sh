#!/usr/bin/env bash
# Rebuild frontend + backend images with this checkout's commit baked in.
# MySQL is not touched. After this, GET /api/version and the sidebar stamp
# must show the same SHA as `git rev-parse --short HEAD`.
#
#   ./scripts/rebuild-preview.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export GIT_SHA="$(git rev-parse HEAD)"
export GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Derlenen sürüm: ${GIT_SHA:0:7} ($GIT_BRANCH) @ $BUILD_TIME"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif docker-compose version >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "HATA: docker compose bulunamadı." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  DC="sudo $DC"
fi

$DC build backend frontend
$DC up -d backend frontend

echo "--- Sunulan API"
# Compose healthcheck waits for uvicorn; give it a few seconds.
ok=""
for _ in $(seq 1 30); do
  if body="$(curl -fsS --max-time 5 http://127.0.0.1:8000/api/version 2>/dev/null)"; then
    echo "$body"
    ok=1
    break
  fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "HATA: /api/version yanıt vermedi." >&2
  $DC logs --tail 40 backend || true
  exit 1
fi
served="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('git_sha') or '')" "$body")"
if [ "$served" != "$GIT_SHA" ]; then
  echo "HATA: API $GIT_SHA yerine '${served:-boş}' sunuyor — imaj eski kaldı." >&2
  exit 1
fi
echo "Önizleme $(git rev-parse --short HEAD) sunuyor."
