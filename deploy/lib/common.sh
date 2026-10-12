# shellcheck shell=sh
# Shared helpers for TamKobi zero-downtime deploy scripts.
# Sourced by update-native.sh / migrate / rollback / status.

ROOT="${ROOT:-${DEPLOY_PATH:-/var/www/tamkobi.com}}"
UPSTREAM_CONF="${UPSTREAM_CONF:-${TAMKOBI_UPSTREAM_CONF:-/etc/nginx/conf.d/tamkobi-upstream.conf}}"
# shellcheck disable=SC2034
SITE_FILE="${SITE_FILE:-${TAMKOBI_SITE_FILE:-/etc/nginx/sites-available/tamkobi.com}}"
MARKER="${MARKER:-$ROOT/.zero-downtime-migrated}"
FRONTEND_RELEASES="${FRONTEND_RELEASES:-$ROOT/frontend-releases}"
FRONTEND_CURRENT="${FRONTEND_CURRENT:-$ROOT/frontend-current}"
BACKEND_RELEASES="${BACKEND_RELEASES:-$ROOT/backend-releases}"
VENVS_DIR="${VENVS_DIR:-$ROOT/venvs}"
RELEASE_HISTORY="${RELEASE_HISTORY:-$ROOT/deploy/.release-history}"
KEEP_FRONTEND_RELEASES="${KEEP_FRONTEND_RELEASES:-5}"
KEEP_VENVS="${KEEP_VENVS:-2}"

die() {
  echo "HATA: $*" >&2
  exit 1
}

info() {
  echo "--- $*" >&2
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "root olarak çalıştırın (sudo sh …)"
  fi
}

require_deploy_tools() {
  _missing=""
  for _t in git curl rsync; do
    if ! command -v "$_t" >/dev/null 2>&1; then
      _missing="$_missing $_t"
    fi
  done
  if [ -n "$_missing" ]; then
    die "Gerekli komut(lar) yok:$_missing — apt/yum ile kurun ve tekrar deneyin."
  fi
}

atomic_symlink() {
  # atomic_symlink <target> <linkpath>
  _tgt=$1
  _link=$2
  _dir=$(dirname "$_link")
  mkdir -p "$_dir"
  _tmp="${_dir}/.symlink-tmp-$$"
  ln -sfn "$_tgt" "$_tmp"
  mv -T "$_tmp" "$_link"
}

atomic_write() {
  # atomic_write <dest>  (reads stdin)
  _dest=$1
  _dir=$(dirname "$_dest")
  mkdir -p "$_dir"
  _tmp="${_dest}.tmp.$$"
  cat >"$_tmp"
  mv -f "$_tmp" "$_dest"
}

active_upstream_port() {
  if [ ! -f "$UPSTREAM_CONF" ]; then
    echo ""
    return 0
  fi
  # shellcheck disable=SC2016
  sed -n 's/.*server 127\.0\.0\.1:\([0-9][0-9]*\).*/\1/p' "$UPSTREAM_CONF" | head -n1
}

other_port() {
  _active=$1
  if [ "$_active" = "8000" ]; then
    echo "8001"
  else
    echo "8000"
  fi
}

write_upstream() {
  _port=$1
  atomic_write "$UPSTREAM_CONF" <<EOF
# TamKobi API upstream — managed by deploy scripts. Do not edit by hand.
upstream tamkobi_api {
    server 127.0.0.1:${_port};
    keepalive 16;
}
EOF
}

nginx_test_reload() {
  if ! nginx -t; then
    return 1
  fi
  systemctl reload nginx
}

load_nvm_if_present() {
  if [ -f /root/.nvm/nvm.sh ]; then
    # nvm is not POSIX; sourced only when present.
    # shellcheck disable=SC1091
    . /root/.nvm/nvm.sh
  fi
}

git_meta() {
  # Variables are consumed by callers (update/migrate/backend drop-ins).
  # shellcheck disable=SC2034
  GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
  # shellcheck disable=SC2034
  GIT_SHA_SHORT="$(git -C "$ROOT" rev-parse --short HEAD)"
  # shellcheck disable=SC2034
  GIT_BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
  # shellcheck disable=SC2034
  GIT_MESSAGE="$(git -C "$ROOT" log -1 --pretty=%s)"
  # shellcheck disable=SC2034
  BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # shellcheck disable=SC2034
  APP_VERSION="${APP_VERSION:-2.0.0}"
}

require_zero_downtime_ready() {
  if [ ! -L "$FRONTEND_CURRENT" ] && [ ! -e "$FRONTEND_CURRENT" ]; then
    die "Kesintisiz dağıtım henüz kurulmadı (frontend-current yok). Önce: sudo sh deploy/migrate-zero-downtime.sh"
  fi
  if [ ! -f "$UPSTREAM_CONF" ]; then
    die "Kesintisiz dağıtım henüz kurulmadı ($UPSTREAM_CONF yok). Önce: sudo sh deploy/migrate-zero-downtime.sh"
  fi
  if [ ! -f "$MARKER" ]; then
    die "Kesintisiz dağıtım henüz kurulmadı (marker yok). Önce: sudo sh deploy/migrate-zero-downtime.sh"
  fi
  _unit="${SYSTEMD_UNIT_ROOT:-/etc/systemd/system}/tamkobi-backend@.service"
  if [ ! -f "$_unit" ]; then
    die "tamkobi-backend@.service yok ($_unit). Önce: sudo sh deploy/migrate-zero-downtime.sh"
  fi
}

release_history_append() {
  _sha=$1
  mkdir -p "$(dirname "$RELEASE_HISTORY")"
  _last=""
  if [ -f "$RELEASE_HISTORY" ]; then
    _last=$(tail -n1 "$RELEASE_HISTORY" || true)
  fi
  if [ "$_last" != "$_sha" ]; then
    echo "$_sha" >>"$RELEASE_HISTORY"
  fi
}

release_history_prev() {
  # stdout: previous sha (second-to-last). fail if missing.
  if [ ! -f "$RELEASE_HISTORY" ]; then
    return 1
  fi
  _n=$(wc -l <"$RELEASE_HISTORY" | tr -d ' ')
  if [ "$_n" -lt 2 ]; then
    return 1
  fi
  tail -n2 "$RELEASE_HISTORY" | head -n1
}

release_history_truncate_to() {
  # Keep history up to and including sha (drop newer entries).
  _sha=$1
  [ -f "$RELEASE_HISTORY" ] || return 0
  _tmp="${RELEASE_HISTORY}.tmp.$$"
  : >"$_tmp"
  while IFS= read -r _line || [ -n "$_line" ]; do
    echo "$_line" >>"$_tmp"
    if [ "$_line" = "$_sha" ]; then
      break
    fi
  done <"$RELEASE_HISTORY"
  mv -f "$_tmp" "$RELEASE_HISTORY"
}
