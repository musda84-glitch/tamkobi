#!/bin/sh
# shellcheck shell=sh source-path=SCRIPTDIR
# Önceki frontend release + önceki backend sha'yı diğer porta kaldır.
#
#   sudo sh deploy/rollback.sh
#   sudo sh deploy/rollback.sh --list
set -eu

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/frontend.sh
. "$HERE/lib/frontend.sh"
# shellcheck source=lib/backend.sh
. "$HERE/lib/backend.sh"

LIST=0
for arg in "$@"; do
  case "$arg" in
    --list) LIST=1 ;;
    *)
      echo "Bilinmeyen argüman: $arg" >&2
      exit 2
      ;;
  esac
done

require_root
cd "$ROOT"
require_zero_downtime_ready

list_releases() {
  echo "Frontend releases:"
  # shellcheck disable=SC2012
  ls -1dt "$FRONTEND_RELEASES"/*/ 2>/dev/null | sed 's:/*$::' | while read -r d; do
    mark=""
    cur=$(readlink -f "$FRONTEND_CURRENT" 2>/dev/null || true)
    if [ "$d" = "$cur" ]; then mark=" [current]"; fi
    echo "  $(basename "$d")$mark"
  done
  echo "Backend releases:"
  # shellcheck disable=SC2012
  ls -1dt "$BACKEND_RELEASES"/*/ 2>/dev/null | sed 's:/*$::' | while read -r d; do
    echo "  $(basename "$d")"
  done
  echo "Aktif upstream port: $(active_upstream_port)"
}

if [ "$LIST" -eq 1 ]; then
  list_releases
  exit 0
fi

# Pick previous frontend (second by mtime)
# shellcheck disable=SC2012
_list=$(ls -1dt "$FRONTEND_RELEASES"/*/ 2>/dev/null | sed 's:/*$::' || true)
_cur=$(readlink -f "$FRONTEND_CURRENT" 2>/dev/null || true)
_prev_fe=""
_n=0
for d in $_list; do
  _n=$((_n + 1))
  if [ "$d" = "$_cur" ]; then
    continue
  fi
  _prev_fe=$d
  break
done
[ -n "$_prev_fe" ] || die "Geri alınacak önceki frontend release yok"
_prev_sha=$(basename "$_prev_fe")

# Prefer matching backend release sha; else newest backend != current stamp
_prev_be="$BACKEND_RELEASES/$_prev_sha"
if [ ! -d "$_prev_be" ]; then
  # shellcheck disable=SC2012
  _prev_be=$(ls -1dt "$BACKEND_RELEASES"/*/ 2>/dev/null | sed 's:/*$::' | sed -n '2p' || true)
fi
if [ -z "${_prev_be:-}" ] || [ ! -d "$_prev_be" ]; then
  die "Geri alınacak backend release yok"
fi
_be_sha=$(basename "$_prev_be")

ACTIVE=$(active_upstream_port)
[ -n "$ACTIVE" ] || ACTIVE=8000
NEW=$(other_port "$ACTIVE")

info "Rollback: frontend→$_prev_sha backend→$_be_sha port $ACTIVE→$NEW"

atomic_symlink "$_prev_fe" "$FRONTEND_CURRENT"

# venv: use hash of current requirements in that release if present, else newest
if [ -f "$_prev_be/requirements.txt" ]; then
  _hash=$(sha256sum "$_prev_be/requirements.txt" | awk '{print substr($1,1,16)}')
else
  _hash=$(req_hash)
fi
VENV_PATH="$VENVS_DIR/$_hash"
if [ ! -x "$VENV_PATH/bin/uvicorn" ]; then
  # fallback: any existing venv
  # shellcheck disable=SC2012
  VENV_PATH=$(ls -1dt "$VENVS_DIR"/*/ 2>/dev/null | sed 's:/*$::' | head -n1 || true)
fi
[ -x "${VENV_PATH}/bin/uvicorn" ] || die "Uygun venv yok"

# Point git_meta-like stamps at rolled-back sha
GIT_SHA=$_be_sha
# shellcheck disable=SC2034
GIT_SHA_SHORT=$(echo "$GIT_SHA" | cut -c1-7)
GIT_BRANCH=rollback
GIT_MESSAGE="rollback"
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
APP_VERSION="${APP_VERSION:-2.0.0}"

backend_write_instance_dropins "$NEW" "$_be_sha" "$VENV_PATH"
systemctl daemon-reload
backend_start_instance "$NEW"

if ! backend_health_sha "$NEW" "$_be_sha"; then
  # version endpoint may return empty if stamp missing — accept any 200 with body
  if ! curl -fsS --max-time 5 "http://127.0.0.1:${NEW}/api/version" >/tmp/tamkobi-api-version.json; then
    journalctl -u "tamkobi-backend@${NEW}" -n 80 --no-pager || true
    backend_stop_instance "$NEW"
    die "Rollback instance sağlıksız"
  fi
fi

write_upstream "$NEW"
nginx_test_reload || {
  write_upstream "$ACTIVE"
  nginx_test_reload || true
  backend_stop_instance "$NEW"
  die "nginx reload başarısız"
}

sleep 5
backend_stop_instance "$ACTIVE"
echo "Rollback tamam. aktif_port=$NEW frontend=$_prev_sha backend=$_be_sha"
"$HERE/status.sh" || true
