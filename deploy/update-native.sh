#!/bin/sh
# shellcheck shell=sh source-path=SCRIPTDIR
# Kesintisiz (zero-downtime) native dağıtım — tamkobi.com
#
# Önkoşul (tek seferlik): sudo sh deploy/migrate-zero-downtime.sh
#
# Usage (on the server, as root):
#   cd /var/www/tamkobi.com && sh deploy/update-native.sh
#   sh deploy/update-native.sh --skip-git
#   sh deploy/update-native.sh --backup          # isteğe bağlı MySQL yedeği
set -eu

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/frontend.sh
. "$HERE/lib/frontend.sh"
# shellcheck source=lib/backend.sh
. "$HERE/lib/backend.sh"

SKIP_GIT=0
DO_BACKUP=0
for arg in "$@"; do
  case "$arg" in
    --skip-git) SKIP_GIT=1 ;;
    --backup) DO_BACKUP=1 ;;
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
load_nvm_if_present
backend_detect_service_user
check_credential_key_readable

info "Kod güncelleniyor ($ROOT)"
if [ "$SKIP_GIT" -eq 0 ]; then
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  if ! git rev-parse --abbrev-ref HEAD | grep -qx main; then
    git checkout main
  fi
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Uyarı: sunucuda yerel değişiklik var; dağıtımdan önce sıfırlanıyor:" >&2
    git status --short || true
    git reset --hard HEAD
  fi
  if ! git merge --ff-only origin/main; then
    echo "HATA: sunucudaki kopya origin/main ile ileri sarılamıyor." >&2
    echo "  git fetch origin +refs/heads/main:refs/remotes/origin/main" >&2
    echo "  git reset --hard origin/main" >&2
    echo "  sh deploy/update-native.sh --skip-git" >&2
    exit 1
  fi
else
  echo "git atlandı (--skip-git), HEAD=$(git rev-parse --short HEAD)" >&2
fi

git_meta
echo "Dağıtılan sürüm: $APP_VERSION ($GIT_SHA_SHORT · $GIT_BRANCH) — $GIT_MESSAGE" >&2

if [ "$DO_BACKUP" -eq 1 ]; then
  info "MySQL yedeği (--backup)"
  if [ -x "$ROOT/backend/venv/bin/python3" ]; then
    PY="$ROOT/backend/venv/bin/python3"
  else
    _vh=$(req_hash)
    if [ -x "$VENVS_DIR/$_vh/bin/python3" ]; then
      PY="$VENVS_DIR/$_vh/bin/python3"
    else
      PY=python3
    fi
  fi
  (cd "$ROOT/backend" && "$PY" -m mysql_backup backup --keep 14) || die "yedek başarısız"
fi

backend_jsencrypt_install

# 1) Frontend build ONLY (activate after backend health + nginx reload)
frontend_build_release "$GIT_SHA"

# 2) Backend release + venv
backend_prepare_release "$GIT_SHA"
VENV_PATH=$(backend_ensure_venv)
validate_venv_path "$VENV_PATH"

ACTIVE=$(active_upstream_port)
[ -n "$ACTIVE" ] || ACTIVE=8000
NEW=$(other_port "$ACTIVE")
info "Blue/green: aktif=$ACTIVE → yeni=$NEW"

backend_install_unit_template
backend_write_instance_dropins "$NEW" "$GIT_SHA" "$VENV_PATH"
systemctl daemon-reload
backend_start_instance "$NEW"

if ! backend_health_sha "$NEW" "$GIT_SHA"; then
  echo "HATA: yeni instance :$NEW sağlık kontrolü başarısız (/api/version+/api/health/ready)." >&2
  journalctl -u "tamkobi-backend@${NEW}" -n 80 --no-pager || true
  backend_stop_instance "$NEW"
  exit 1
fi

write_upstream "$NEW"
if ! nginx_test_reload; then
  echo "HATA: nginx -t/reload başarısız; upstream geri alınıyor → $ACTIVE" >&2
  write_upstream "$ACTIVE"
  nginx_test_reload || true
  backend_stop_instance "$NEW"
  exit 1
fi

# 3) Only now flip frontend-current
frontend_activate "$GIT_SHA"
release_history_append "$GIT_SHA"

info "Eski instance $ACTIVE 20 sn sonra durdurulacak"
sleep 20
backend_stop_instance "$ACTIVE"

if ! curl -fsS -o /dev/null --max-time 5 -H "Host: tamkobi.com" http://127.0.0.1/; then
  echo "Uyarı: nginx kök yanıt vermedi (Host: tamkobi.com); upstream yine de $NEW" >&2
fi

echo "Dağıtım tamam. aktif_port=$NEW sha=$GIT_SHA_SHORT" >&2
"$HERE/status.sh" || true
