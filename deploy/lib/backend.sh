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
    # Prefer git archive for a clean tree at HEAD
    if git -C "$ROOT" rev-parse --verify "$_sha" >/dev/null 2>&1; then
      git -C "$ROOT" archive "$_sha" backend | tar -x -C "$_dest" --strip-components=1
    else
      # Fallback: rsync working tree backend (tests)
      rsync -a --delete \
        --exclude venv --exclude __pycache__ --exclude '*.pyc' --exclude data \
        "$ROOT/backend/" "$_dest/"
    fi
  fi

  # Shared persistent paths (never baked into a release)
  ln -sfn "$ROOT/backend/data" "$_dest/data"
  ln -sfn "$ROOT/backend/.env" "$_dest/.env"
  mkdir -p "$ROOT/backend/jsencrypt_bridge"
  if [ -d "$ROOT/backend/jsencrypt_bridge/node_modules" ]; then
    mkdir -p "$_dest/jsencrypt_bridge"
    ln -sfn "$ROOT/backend/jsencrypt_bridge/node_modules" "$_dest/jsencrypt_bridge/node_modules"
  fi
  # Credential key used by some installs
  if [ -e /data/.credential_encryption_key ]; then
    ln -sfn /data/.credential_encryption_key "$_dest/.credential_encryption_key" 2>/dev/null || true
  elif [ -e "$ROOT/backend/.credential_encryption_key" ]; then
    ln -sfn "$ROOT/backend/.credential_encryption_key" "$_dest/.credential_encryption_key" 2>/dev/null || true
  fi
}

backend_ensure_venv() {
  _hash=$(req_hash)
  _venv="$VENVS_DIR/$_hash"
  mkdir -p "$VENVS_DIR"
  if [ -x "$_venv/bin/python3" ] && [ -x "$_venv/bin/uvicorn" ]; then
    info "venv yeniden kullanılıyor: $_venv"
  else
    info "venv oluşturuluyor: $_venv"
    rm -rf "$_venv"
    python3 -m venv "$_venv"
    REQ=/tmp/tamkobi-requirements.native.$$.txt
    grep -vE '^(#|$)' "$ROOT/backend/requirements.txt" \
      | grep -vE '^(emergentintegrations==|litellm @)' >"$REQ"
    if ! "$_venv/bin/pip" install -r "$REQ"; then
      rm -f "$REQ"
      rm -rf "$_venv"
      die "pip install başarısız; canlıya dokunulmadı"
    fi
    rm -f "$REQ"
  fi

  STUB="$ROOT/backend/docker/stubs/emergentintegrations"
  SITE="$("$_venv/bin/python3" -c "import sysconfig; print(sysconfig.get_path('purelib'))")"
  if [ -d "$STUB" ] && [ -n "$SITE" ]; then
    rm -rf "$SITE/emergentintegrations"
    cp -a "$STUB" "$SITE/emergentintegrations"
    info "emergentintegrations stub → $SITE/emergentintegrations"
  fi

  # prune old venvs (keep last KEEP_VENVS by mtime; never delete active hash)
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

  echo "$_venv"
}

backend_write_instance_dropins() {
  # backend_write_instance_dropins <port> <sha> <venv>
  _port=$1
  _sha=$2
  _venv=$3
  _rel="$BACKEND_RELEASES/$_sha"
  _drop="/etc/systemd/system/tamkobi-backend@${_port}.service.d"
  mkdir -p "$_drop"

  workers="${TAMKOBI_WORKERS:-2}"
  cat >"$_drop/release.conf" <<EOF
[Service]
WorkingDirectory=${_rel}
Environment=PYTHONPATH=${_rel}:${_rel}/docker/stubs
ExecStart=${_venv}/bin/uvicorn server:app --host 127.0.0.1 --port ${_port} --workers ${workers} --proxy-headers --forwarded-allow-ips=127.0.0.1 --timeout-graceful-shutdown 20
EOF

  export GIT_SHA GIT_BRANCH GIT_MESSAGE BUILD_TIME APP_VERSION
  export DROPIN_DIR="$_drop"
  python3 - <<'PY'
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

backend_install_unit_template() {
  _src="$ROOT/deploy/tamkobi-backend@.service"
  [ -f "$_src" ] || die "$_src yok"
  sed "s|/var/www/tamkobi.com|$ROOT|g" "$_src" > /etc/systemd/system/tamkobi-backend@.service
  systemctl daemon-reload
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
  # backend_health_sha <port> <expected_sha> — waits up to 60s
  _port=$1
  _want=$2
  _i=0
  while [ "$_i" -lt 30 ]; do
    _i=$((_i + 1))
    if curl -fsS --max-time 5 "http://127.0.0.1:${_port}/api/version" >/tmp/tamkobi-api-version.json 2>/dev/null; then
      _got=$(python3 -c "import json; print(json.load(open('/tmp/tamkobi-api-version.json')).get('git_sha') or '')")
      if [ "$_got" = "$_want" ]; then
        cat /tmp/tamkobi-api-version.json
        echo
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
    (cd "$ROOT/backend/jsencrypt_bridge" && npm install --omit=dev --no-audit --no-fund)
  else
    echo "Uyarı: npm yok; Kuveyt imzası PKCS1 SHA256 yedeğine düşer."
  fi
}
