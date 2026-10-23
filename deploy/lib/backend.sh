# shellcheck shell=sh
# Backend release tree, hashed venvs, systemd instance helpers.

req_hash() {
  # Stable hash of requirements.txt (for venv reuse)
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$ROOT/backend/requirements.txt" | awk '{print substr($1,1,16)}'
  else
    sha256sum <"$ROOT/backend/requirements.txt" 2>/dev/null | awk '{print substr($1,1,16)}' \
      || cksum "$ROOT/backend/requirements.txt" | awk '{print $1}'
  fi
}

validate_venv_path() {
  _p=$1
  case "$_p" in
    /*) ;;
    *) die "VENV_PATH mutlak değil: $_p" ;;
  esac
  _lines=$(printf '%s' "$_p" | awk 'END{print NR}')
  [ "$_lines" = "1" ] || die "VENV_PATH tek satır olmalı (satır=$_lines): $_p"
  [ -d "$_p" ] || die "VENV_PATH dizin değil veya yok: $_p"
  [ -x "$_p/bin/uvicorn" ] || die "VENV_PATH içinde uvicorn yok: $_p/bin/uvicorn"
}

backend_detect_service_user() {
  # Prefer User=/Group= from legacy tamkobi-backend.service; else root.
  SERVICE_USER="${SERVICE_USER:-}"
  SERVICE_GROUP="${SERVICE_GROUP:-}"
  _unit=""
  for _cand in /etc/systemd/system/tamkobi-backend.service /lib/systemd/system/tamkobi-backend.service; do
    if [ -f "$_cand" ]; then
      _unit=$_cand
      break
    fi
  done
  if [ -n "$_unit" ]; then
    _u=$(sed -n 's/^User=//p' "$_unit" | head -n1)
    _g=$(sed -n 's/^Group=//p' "$_unit" | head -n1)
    [ -n "$_u" ] && SERVICE_USER=$_u
    [ -n "$_g" ] && SERVICE_GROUP=$_g
  fi
  [ -n "$SERVICE_USER" ] || SERVICE_USER=root
  [ -n "$SERVICE_GROUP" ] || SERVICE_GROUP=$SERVICE_USER
  export SERVICE_USER SERVICE_GROUP
  info "Servis kullanıcısı: User=$SERVICE_USER Group=$SERVICE_GROUP (eski unitten veya root)"
}

check_credential_key_readable() {
  # ASLA yazma / yeniden üretme — yalnızca okunabilirlik.
  # CREDENTIAL_KEY_PATH override is for tests; production uses /data/...
  _ck="${CREDENTIAL_KEY_PATH:-/data/.credential_encryption_key}"
  if [ -e "$_ck" ]; then
    if [ ! -r "$_ck" ]; then
      die "$_ck okunamıyor (şu anki uid=$(id -u)). Servis kullanıcısı ($SERVICE_USER) bu dosyayı okuyabilmeli; ASLA yeniden üretmeyin / üzerine yazmayın."
    fi
  fi
}

backend_prepare_release() {
  # backend_prepare_release <sha>
  _sha=$1
  _dest="$BACKEND_RELEASES/$_sha"
  mkdir -p "$BACKEND_RELEASES"
  if [ -d "$_dest" ] && [ -f "$_dest/server.py" ]; then
    info "Backend release zaten var: $_dest"
  else
    rm -rf "$_dest"
    mkdir -p "$_dest"
    info "Backend release kopyalanıyor → $_dest"
    if git -C "$ROOT" rev-parse --verify "$_sha" >/dev/null 2>&1; then
      # Exclude persistent paths from archive so ln -sfn cannot nest (data/data).
      git -C "$ROOT" archive "$_sha" backend \
        | tar -x -C "$_dest" --strip-components=1 \
          --exclude=data --exclude=.env --exclude=.credential_encryption_key
    else
      rsync -a --delete \
        --exclude venv --exclude __pycache__ --exclude '*.pyc' \
        --exclude data --exclude .env --exclude .credential_encryption_key \
        "$ROOT/backend/" "$_dest/"
    fi
  fi

  # Remove any real dirs/files left by archive before symlinking
  rm -rf "$_dest/data"
  if [ -e "$_dest/.env" ] && [ ! -L "$_dest/.env" ]; then
    rm -f "$_dest/.env"
  fi
  if [ -e "$_dest/.credential_encryption_key" ] && [ ! -L "$_dest/.credential_encryption_key" ]; then
    rm -f "$_dest/.credential_encryption_key"
  fi

  ln -sfn "$ROOT/backend/data" "$_dest/data"
  if [ -f "$ROOT/backend/.env" ]; then
    ln -sfn "$ROOT/backend/.env" "$_dest/.env"
  fi
  mkdir -p "$ROOT/backend/jsencrypt_bridge"
  if [ -d "$ROOT/backend/jsencrypt_bridge/node_modules" ]; then
    mkdir -p "$_dest/jsencrypt_bridge"
    ln -sfn "$ROOT/backend/jsencrypt_bridge/node_modules" "$_dest/jsencrypt_bridge/node_modules"
  fi
  # Credential key: symlink only if readable; never create/write
  if [ -e /data/.credential_encryption_key ]; then
    if [ -r /data/.credential_encryption_key ]; then
      ln -sfn /data/.credential_encryption_key "$_dest/.credential_encryption_key"
    else
      die "/data/.credential_encryption_key okunamıyor; symlink atlanamaz (ASLA yeniden üretmeyin)"
    fi
  elif [ -e "$ROOT/backend/.credential_encryption_key" ]; then
    if [ -r "$ROOT/backend/.credential_encryption_key" ]; then
      ln -sfn "$ROOT/backend/.credential_encryption_key" "$_dest/.credential_encryption_key"
    fi
  fi

  # Sanity: data must be a symlink to shared persistent tree
  if [ ! -L "$_dest/data" ]; then
    die "release data symlink değil: $_dest/data"
  fi
  _data_tgt=$(readlink -f "$_dest/data" 2>/dev/null || readlink "$_dest/data")
  _want=$(readlink -f "$ROOT/backend/data" 2>/dev/null || echo "$ROOT/backend/data")
  if [ "$_data_tgt" != "$_want" ]; then
    die "release data hedefi yanlış: $_data_tgt (beklenen $_want)"
  fi
}

backend_ensure_venv() {
  # stdout: ONLY absolute venv path (single line). All logs → stderr via info().
  _hash=$(req_hash)
  _venv="$VENVS_DIR/$_hash"
  mkdir -p "$VENVS_DIR"
  if [ -x "$_venv/bin/python3" ] && [ -x "$_venv/bin/uvicorn" ]; then
    info "venv yeniden kullanılıyor: $_venv"
  else
    info "venv oluşturuluyor: $_venv"
    rm -rf "$_venv"
    python3 -m venv "$_venv" >&2
    REQ=/tmp/tamkobi-requirements.native.$$.txt
    grep -vE '^(#|$)' "$ROOT/backend/requirements.txt" \
      | grep -vE '^(emergentintegrations==|litellm @)' >"$REQ"
    if ! "$_venv/bin/pip" install -r "$REQ" >&2; then
      rm -f "$REQ"
      rm -rf "$_venv"
      die "pip install başarısız; canlıya dokunulmadı"
    fi
    rm -f "$REQ"
  fi

  STUB="$ROOT/backend/docker/stubs/emergentintegrations"
  SITE="$("$_venv/bin/python3" -c "import sysconfig; print(sysconfig.get_path('purelib'))" 2>/dev/null || true)"
  if [ -d "$STUB" ] && [ -n "$SITE" ] && [ -d "$SITE" ]; then
    if rm -rf "$SITE/emergentintegrations" 2>/dev/null \
      && cp -a "$STUB" "$SITE/emergentintegrations" 2>/dev/null; then
      info "emergentintegrations stub → $SITE/emergentintegrations"
    else
      echo "Uyarı: emergentintegrations stub kopyalanamadı ($SITE); devam" >&2
    fi
  fi

  # shellcheck disable=SC2012
  _list=$(ls -1dt "$VENVS_DIR"/*/ 2>/dev/null | sed 's:/*$::' || true)
  _n=0
  for d in $_list; do
    _n=$((_n + 1))
    if [ "$_n" -le "$KEEP_VENVS" ]; then
      continue
    fi
    if [ "$(basename "$d")" = "$_hash" ]; then
      continue
    fi
    info "Eski venv siliniyor: $(basename "$d")"
    rm -rf "$d"
  done

  printf '%s\n' "$_venv"
}

backend_write_instance_dropins() {
  # backend_write_instance_dropins <port> <sha> <venv>
  _port=$1
  _sha=$2
  _venv=$3
  validate_venv_path "$_venv"
  _rel="$BACKEND_RELEASES/$_sha"
  _drop="${SYSTEMD_DROPIN_ROOT:-/etc/systemd/system}/tamkobi-backend@${_port}.service.d"
  mkdir -p "$_drop"

  workers="${TAMKOBI_WORKERS:-2}"
  # Type=simple: clear inherited ExecStart before setting the real one.
  # `/usr/bin/env …=0` wins over EnvironmentFile (.env). systemd applies
  # EnvironmentFile after Environment=, so the Environment= line alone does not.
  cat >"$_drop/release.conf" <<EOF
[Service]
WorkingDirectory=${_rel}
Environment=PYTHONPATH=${_rel}:${_rel}/docker/stubs
Environment=TAMKOBI_BACKGROUND_JOBS=0
ExecStart=
ExecStart=/usr/bin/env TAMKOBI_BACKGROUND_JOBS=0 ${_venv}/bin/uvicorn server:app --host 127.0.0.1 --port ${_port} --workers ${workers} --proxy-headers --forwarded-allow-ips=127.0.0.1 --timeout-graceful-shutdown 20
EOF

  export GIT_SHA GIT_BRANCH GIT_MESSAGE BUILD_TIME APP_VERSION
  export DROPIN_DIR="$_drop"
  backend_write_stamp_conf
}

backend_write_stamp_conf() {
  # Caller exports DROPIN_DIR plus GIT_SHA, GIT_BRANCH, GIT_MESSAGE, BUILD_TIME, APP_VERSION.
  python3 - <<'PY' >&2
import os
from pathlib import Path

def esc(value: str) -> str:
    return (
        (value or "")
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", " ")
        .replace("\r", "")
    )

msg = " ".join((os.environ.get("GIT_MESSAGE") or "").split())[:160]
dropin = Path(os.environ["DROPIN_DIR"])
dropin.mkdir(parents=True, exist_ok=True)
(dropin / "stamp.conf").write_text(
    "[Service]\n"
    f'Environment="APP_GIT_SHA={esc(os.environ.get("GIT_SHA", ""))}"\n'
    f'Environment="APP_GIT_BRANCH={esc(os.environ.get("GIT_BRANCH", ""))}"\n'
    f'Environment="APP_GIT_MESSAGE={esc(msg)}"\n'
    f'Environment="APP_BUILD_TIME={esc(os.environ.get("BUILD_TIME", ""))}"\n'
    f'Environment="APP_VERSION={esc(os.environ.get("APP_VERSION", "2.0.0"))}"\n',
    encoding="utf-8",
)
print(f"stamp.conf → {dropin / 'stamp.conf'}")
PY
}

# Single background-job process. 8000/8001 stay the nginx blue/green ports.
WORKER_PORT="${WORKER_PORT:-8099}"

backend_install_worker_unit() {
  _src="$ROOT/deploy/tamkobi-worker.service"
  [ -f "$_src" ] || die "$_src yok"
  backend_detect_service_user
  _dst="${SYSTEMD_UNIT_ROOT:-/etc/systemd/system}/tamkobi-worker.service"
  mkdir -p "$(dirname "$_dst")"
  sed \
    -e "s|/var/www/tamkobi.com|$ROOT|g" \
    -e "s|^User=.*|User=${SERVICE_USER}|" \
    -e "s|^Group=.*|Group=${SERVICE_GROUP}|" \
    "$_src" >"$_dst"
  if [ "${SKIP_SYSTEMCTL:-0}" != "1" ]; then
    systemctl daemon-reload
  fi
}

backend_write_worker_dropin() {
  # backend_write_worker_dropin <sha> <venv>
  _sha=$1
  _venv=$2
  validate_venv_path "$_venv"
  _wport=${WORKER_PORT:-8099}
  case "$_wport" in
    8000|8001)
      die "WORKER_PORT blue/green portu olamaz: $_wport"
      ;;
  esac
  _rel="$BACKEND_RELEASES/$_sha"
  _drop="${SYSTEMD_DROPIN_ROOT:-/etc/systemd/system}/tamkobi-worker.service.d"
  mkdir -p "$_drop"
  # One unit, one process. env prefix beats EnvironmentFile (see HTTP drop-in).
  cat >"$_drop/release.conf" <<EOF
[Service]
WorkingDirectory=${_rel}
Environment=PYTHONPATH=${_rel}:${_rel}/docker/stubs
Environment=TAMKOBI_BACKGROUND_JOBS=1
ExecStart=
ExecStart=/usr/bin/env TAMKOBI_BACKGROUND_JOBS=1 ${_venv}/bin/uvicorn server:app --host 127.0.0.1 --port ${_wport} --workers 1 --proxy-headers --forwarded-allow-ips=127.0.0.1 --timeout-graceful-shutdown 20
EOF
  export GIT_SHA GIT_BRANCH GIT_MESSAGE BUILD_TIME APP_VERSION
  export DROPIN_DIR="$_drop"
  backend_write_stamp_conf
}

backend_sync_worker() {
  # backend_sync_worker <sha> <venv>
  # Point the single tamkobi-worker unit at this release. systemctl restart
  # stops the old process, then starts the new one — no second copy.
  _sha=$1
  _venv=$2
  _wport=${WORKER_PORT:-8099}
  case "$_wport" in
    8000|8001)
      die "WORKER_PORT blue/green portu olamaz: $_wport"
      ;;
  esac
  info "tamkobi-worker tek kopya → sha=${_sha} port=${_wport}"
  backend_install_worker_unit
  backend_write_worker_dropin "$_sha" "$_venv"
  if [ "${SKIP_SYSTEMCTL:-0}" = "1" ]; then
    return 0
  fi
  systemctl daemon-reload
  systemctl enable tamkobi-worker >/dev/null 2>&1 || true
  if ! systemctl restart tamkobi-worker; then
    journalctl -u tamkobi-worker -n 80 --no-pager || true
    die "tamkobi-worker yeniden başlatılamadı; nginx geri alınmadı, eski instance durdurulmadı"
  fi
  if ! backend_health_sha "$_wport" "$_sha"; then
    journalctl -u tamkobi-worker -n 80 --no-pager || true
    die "tamkobi-worker sağlık kontrolü başarısız (:${_wport}); nginx geri alınmadı, eski instance durdurulmadı"
  fi
}

backend_install_unit_template() {
  _src="$ROOT/deploy/tamkobi-backend@.service"
  [ -f "$_src" ] || die "$_src yok"
  backend_detect_service_user
  _dst="${SYSTEMD_UNIT_ROOT:-/etc/systemd/system}/tamkobi-backend@.service"
  mkdir -p "$(dirname "$_dst")"
  sed \
    -e "s|/var/www/tamkobi.com|$ROOT|g" \
    -e "s|^User=.*|User=${SERVICE_USER}|" \
    -e "s|^Group=.*|Group=${SERVICE_GROUP}|" \
    "$_src" >"$_dst"
  if [ "${SKIP_SYSTEMCTL:-0}" != "1" ]; then
    systemctl daemon-reload
  fi
}

backend_start_instance() {
  _port=$1
  systemctl enable "tamkobi-backend@${_port}" >/dev/null 2>&1 || true
  systemctl restart "tamkobi-backend@${_port}"
}

backend_stop_instance() {
  _port=$1
  systemctl stop "tamkobi-backend@${_port}" 2>/dev/null || true
  systemctl disable "tamkobi-backend@${_port}" 2>/dev/null || true
}

backend_health_sha() {
  # backend_health_sha <port> <expected_sha> — /api/version + /api/health/ready, up to 60s
  _port=$1
  _want=$2
  _i=0
  while [ "$_i" -lt 30 ]; do
    _i=$((_i + 1))
    if curl -fsS --max-time 5 "http://127.0.0.1:${_port}/api/version" >/tmp/tamkobi-api-version.json 2>/dev/null \
      && curl -fsS --max-time 5 "http://127.0.0.1:${_port}/api/health/ready" >/tmp/tamkobi-api-ready.json 2>/dev/null; then
      _got=$(python3 -c "import json; print(json.load(open('/tmp/tamkobi-api-version.json')).get('git_sha') or '')")
      _ready=$(python3 -c "import json; print('1' if json.load(open('/tmp/tamkobi-api-ready.json')).get('ready') else '0')")
      if [ "$_got" = "$_want" ] && [ "$_ready" = "1" ]; then
        cat /tmp/tamkobi-api-version.json >&2
        echo >&2
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

backend_jsencrypt_install() {
  info "JSEncrypt (Kuveyt Signature)"
  if command -v npm >/dev/null 2>&1; then
    mkdir -p "$ROOT/backend/jsencrypt_bridge"
    (cd "$ROOT/backend/jsencrypt_bridge" && npm install --omit=dev --no-audit --no-fund) >&2
  else
    echo "Uyarı: npm yok; Kuveyt imzası PKCS1 SHA256 yedeğine düşer." >&2
  fi
}
