#!/bin/sh
# shellcheck shell=sh source-path=SCRIPTDIR
# TEK SEFERLİK, idempotent geçiş: klasik tamkobi-backend → blue/green + frontend-current.
#
#   sudo sh deploy/migrate-zero-downtime.sh
set -eu

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/frontend.sh
. "$HERE/lib/frontend.sh"
# shellcheck source=lib/backend.sh
. "$HERE/lib/backend.sh"

require_root
cd "$ROOT"
load_nvm_if_present
git_meta

STAMP=$(date +%Y%m%d-%H%M%S)
SITE_BAK="/root/nginx-tamkobi.com.${STAMP}.bak"

info "1) nginx site yedeği"
if [ -f "$SITE_FILE" ]; then
  cp -a "$SITE_FILE" "$SITE_BAK"
  echo "Yedek: $SITE_BAK"
else
  die "Site dosyası yok: $SITE_FILE"
fi

info "2) Mevcut frontend/build → frontend-releases/$GIT_SHA"
mkdir -p "$FRONTEND_RELEASES"
_rel="$FRONTEND_RELEASES/$GIT_SHA"
if [ ! -f "$_rel/index.html" ]; then
  if [ -d "$ROOT/frontend/build" ] && [ -f "$ROOT/frontend/build/index.html" ]; then
    mkdir -p "$_rel"
    rsync -a "$ROOT/frontend/build/" "$_rel/"
  else
    die "frontend/build yok; önce klasik bir build veya update gerekir"
  fi
fi
[ -d "$_rel/static" ] || die "release static/ eksik: $_rel"
atomic_symlink "$_rel" "$FRONTEND_CURRENT"
echo "frontend-current → $_rel"

info "3) Site dosyasında root + proxy_pass (yalnızca tam satır)"
export SITE_FILE SITE_BAK ROOT HERE
python3 - <<'PY'
import os, sys
from pathlib import Path
sys.path.insert(0, os.path.join(os.environ["HERE"], "lib"))
from site_rewrite import rewrite_site_root_and_proxy

site = Path(os.environ["SITE_FILE"])
bak = os.environ["SITE_BAK"]
try:
    status, a, b = rewrite_site_root_and_proxy(site, os.environ["ROOT"])
except ValueError as e:
    print(f"HATA: {e}. Dosya değiştirilmedi. Yedek: {bak}", file=sys.stderr)
    sys.exit(1)
if status == "already":
    print("Site dosyası zaten kesintisiz moda (root/proxy); satır değişikliği atlandı.")
else:
    print(f"Site güncellendi (root={a}, proxy={b} satır).")
PY

info "4) Upstream dosyası (8000)"
mkdir -p "$(dirname "$UPSTREAM_CONF")"
write_upstream 8000

info "5) nginx -t"
if ! nginx -t; then
  echo "nginx -t başarısız — site yedeği geri yükleniyor"
  cp -a "$SITE_BAK" "$SITE_FILE"
  rm -f "$UPSTREAM_CONF"
  exit 1
fi
systemctl reload nginx

info "6) systemd template + blue/green kesintisiz geçiş"
APP_USER=tamkobi
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd -r -M -d "$ROOT" -s /usr/sbin/nologin -c "TamKobi API" "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 750 \
  "$ROOT/backend/data" "$ROOT/logs" "$ROOT/backups" /var/log/tamkobi
for f in "$ROOT/backend/.env" "$ROOT/.env"; do
  if [ -f "$f" ]; then
    chgrp "$APP_USER" "$f" 2>/dev/null || true
    chmod 640 "$f" 2>/dev/null || true
  fi
done

backend_jsencrypt_install
backend_prepare_release "$GIT_SHA"
VENV_PATH=$(backend_ensure_venv)
backend_install_unit_template
backend_write_instance_dropins 8001 "$GIT_SHA" "$VENV_PATH"
systemctl daemon-reload

systemctl disable --now tamkobi-uvicorn 2>/dev/null || true

backend_start_instance 8001
if ! backend_health_sha 8001 "$GIT_SHA"; then
  echo "HATA: tamkobi-backend@8001 sağlık kontrolü başarısız" >&2
  journalctl -u tamkobi-backend@8001 -n 80 --no-pager || true
  backend_stop_instance 8001
  exit 1
fi

write_upstream 8001
nginx_test_reload || {
  write_upstream 8000
  nginx_test_reload || true
  backend_stop_instance 8001
  die "nginx reload başarısız; upstream 8000'e alındı"
}

if systemctl list-unit-files tamkobi-backend.service 2>/dev/null | grep -q tamkobi-backend.service; then
  systemctl stop tamkobi-backend 2>/dev/null || true
  systemctl disable tamkobi-backend 2>/dev/null || true
  if [ -f /etc/systemd/system/tamkobi-backend.service ]; then
    cp -a /etc/systemd/system/tamkobi-backend.service "/root/tamkobi-backend.service.${STAMP}.bak"
    echo "Eski unit yedeği: /root/tamkobi-backend.service.${STAMP}.bak"
  fi
fi
systemctl disable --now tamkobi-uvicorn 2>/dev/null || true
systemctl daemon-reload

echo "migrated_at=${STAMP}" >"$MARKER"
echo "git_sha=${GIT_SHA}" >>"$MARKER"
echo "site_backup=${SITE_BAK}" >>"$MARKER"

info "7) durum"
"$HERE/status.sh" || true
echo
echo "Geçiş tamam. Sonraki güncellemeler: sudo sh deploy/update-native.sh"
echo "Geri alma: sudo sh deploy/rollback.sh"
echo "Site yedeği: $SITE_BAK"
