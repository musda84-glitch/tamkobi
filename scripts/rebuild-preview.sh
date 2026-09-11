#!/usr/bin/env bash
# Rebuild frontend + backend images with this checkout's commit baked in.
# MySQL is not touched. After this, GET /api/version and the sidebar stamp
# must show the same SHA as `git rev-parse --short HEAD`.
#
# Compose interpolates ${GIT_SHA} from a file, not from the process
# environment: `sudo docker compose` drops exported vars, which is how an
# image can come up with an empty stamp even though this script set one.
#
#   ./scripts/rebuild-preview.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GIT_SHA="$(git rev-parse HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Derlenen sürüm: ${GIT_SHA:0:7} ($GIT_BRANCH) @ $BUILD_TIME"

# .env.* is gitignored. Compose reads this even under sudo.
stamp_env="$ROOT/.env.build-stamp"
umask 077
printf 'GIT_SHA=%s\nGIT_BRANCH=%s\nBUILD_TIME=%s\n' "$GIT_SHA" "$GIT_BRANCH" "$BUILD_TIME" > "$stamp_env"

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

"${DC[@]}" --env-file "$stamp_env" build backend frontend
"${DC[@]}" --env-file "$stamp_env" up -d backend frontend

echo "--- Sunulan API"
ok=""
body=""
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
  "${DC[@]}" logs --tail 40 backend || true
  exit 1
fi
served="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('git_sha') or '')" "$body")"
if [ "$served" != "$GIT_SHA" ]; then
  echo "HATA: API $GIT_SHA yerine '${served:-boş}' sunuyor — imaj eski kaldı." >&2
  exit 1
fi
echo "Önizleme $(git rev-parse --short HEAD) sunuyor."
