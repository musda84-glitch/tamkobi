#!/usr/bin/env bash
# Rebuild frontend + backend images with this checkout's commit baked in.
# MySQL is not touched. After this, GET /api/version and the sidebar stamp
# must show the same SHA as `git rev-parse --short HEAD`.
#
# Pass GIT_SHA as a --build-arg on the command line. Do NOT feed a replacement
# --env-file to compose: that shadows the project .env (MySQL passwords) and
# can recreate the database container. `sudo docker compose` drops exported
# variables, but it does not strip arguments.
#
#   ./scripts/rebuild-preview.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GIT_SHA="$(git rev-parse HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
GIT_MESSAGE="$(git log -1 --pretty=%s)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export GIT_SHA GIT_BRANCH GIT_MESSAGE BUILD_TIME
echo "Derlenen sürüm: ${GIT_SHA:0:7} ($GIT_BRANCH) — $GIT_MESSAGE @ $BUILD_TIME"

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif docker-compose version >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "HATA: docker compose bulunamadı." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  DC=(sudo "${DC[@]}")
fi

"${DC[@]}" build \
  --build-arg GIT_SHA="$GIT_SHA" \
  --build-arg GIT_BRANCH="$GIT_BRANCH" \
  --build-arg GIT_MESSAGE="$GIT_MESSAGE" \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  backend frontend
"${DC[@]}" up -d --no-build backend frontend

echo "--- Sunulan API"
ok=""
body=""
for _ in $(seq 1 40); do
  if body="$(curl -fsS --max-time 5 http://127.0.0.1:8000/api/version 2>/dev/null)"; then
    echo "$body"
    ok=1
    break
  fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "HATA: /api/version yanıt vermedi." >&2
  "${DC[@]}" logs --tail 40 backend || true
  exit 1
fi
served="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('git_sha') or '')" "$body")"
if [ "$served" != "$GIT_SHA" ]; then
  echo "HATA: API $GIT_SHA yerine '${served:-boş}' sunuyor — imaj eski kaldı." >&2
  exit 1
fi
echo "Önizleme $(git rev-parse --short HEAD) sunuyor."
