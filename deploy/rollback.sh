#!/bin/sh
# shellcheck shell=sh source-path=SCRIPTDIR
# Önceki release'i deploy/.release-history üzerinden geri yükle.
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
require_deploy_tools
cd "$ROOT"
require_zero_downtime_ready
backend_detect_service_user
check_credential_key_readable

list_releases() {
  echo "Release history ($RELEASE_HISTORY):"
  if [ -f "$RELEASE_HISTORY" ]; then
    nl -ba "$RELEASE_HISTORY"
  else
    echo "  (yok)"
  fi
  echo "Frontend releases:"
  # shellcheck disable=SC2012
  ls -1dt "$FRONTEND_RELEASES"/*/ 2>/dev/null | sed 's:/*$::' | while read -r d; do
    mark=""
    cur=$(readlink -f "$FRONTEND_CURRENT" 2>/dev/null || true)
    if [ "$d" = "$cur" ]; then mark=" [current]"; fi
    echo "  $(basename "$d")$mark"
  done
  echo "Aktif upstream port: $(active_upstream_port)"
}

if [ "$LIST" -eq 1 ]; then
  list_releases
  exit 0
fi

_prev_sha=$(release_history_prev) || die "Geri alınacak önceki sha yok ($RELEASE_HISTORY)"
_prev_fe="$FRONTEND_RELEASES/$_prev_sha"
_prev_be="$BACKEND_RELEASES/$_prev_sha"
[ -d "$_prev_fe" ] || die "Frontend release yok: $_prev_fe"
[ -d "$_prev_be" ] || die "Backend release yok: $_prev_be"
_be_sha=$_prev_sha

ACTIVE=$(active_upstream_port)
[ -n "$ACTIVE" ] || ACTIVE=8000
NEW=$(other_port "$ACTIVE")

info "Rollback: sha→$_prev_sha port $ACTIVE→$NEW (frontend henüz değişmedi)"

if [ -f "$_prev_be/requirements.txt" ]; then
  _hash=$(sha256sum "$_prev_be/requirements.txt" | awk '{print substr($1,1,16)}')
else
  _hash=$(req_hash)
fi
VENV_PATH="$VENVS_DIR/$_hash"
if [ ! -x "$VENV_PATH/bin/uvicorn" ]; then
  # shellcheck disable=SC2012
  VENV_PATH=$(ls -1dt "$VENVS_DIR"/*/ 2>/dev/null | sed 's:/*$::' | head -n1 || true)
fi
validate_venv_path "$VENV_PATH"

GIT_SHA=$_be_sha
# shellcheck disable=SC2034
GIT_SHA_SHORT=$(echo "$GIT_SHA" | cut -c1-7)
GIT_BRANCH=rollback
GIT_MESSAGE="rollback"
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
APP_VERSION="${APP_VERSION:-2.0.0}"

backend_install_unit_template
backend_write_instance_dropins "$NEW" "$_be_sha" "$VENV_PATH"
systemctl daemon-reload
backend_start_instance "$NEW"

if ! backend_health_sha "$NEW" "$_be_sha"; then
  journalctl -u "tamkobi-backend@${NEW}" -n 80 --no-pager || true
  backend_stop_instance "$NEW"
  die "Rollback instance sağlıksız (git_sha=$_be_sha doğrulanamadı)"
fi

write_upstream "$NEW"
nginx_test_reload || {
  write_upstream "$ACTIVE"
  nginx_test_reload || true
  backend_stop_instance "$NEW"
  die "nginx reload başarısız"
}

# Activate frontend only after health + nginx success
frontend_activate "$_prev_sha"
release_history_truncate_to "$_prev_sha"

# Aynı tek worker birimini geri alınan sürüme çevir. İkinci kopya yok.
# Sağlık burada düşerse nginx geri alınmaz; eski web henüz durdurulmaz.
backend_sync_worker "$_be_sha" "$VENV_PATH"

sleep 5
backend_stop_instance "$ACTIVE"
echo "Rollback tamam. aktif_port=$NEW sha=$_prev_sha" >&2
"$HERE/status.sh" || true
