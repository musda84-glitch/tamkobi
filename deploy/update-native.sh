#!/bin/sh
# Native production deploy for the ixirhost VPS:
# nginx serves frontend/build, uvicorn on 127.0.0.1:8000, no Docker.
#
# Usage (on the server, as root):
#   cd /var/www/tamkobi.com && sh deploy/update-native.sh
#   sh deploy/update-native.sh --skip-git    # already on the desired commit
set -eu

ROOT="${DEPLOY_PATH:-/var/www/tamkobi.com}"
SKIP_GIT=0
for arg in "$@"; do
  case "$arg" in
    --skip-git) SKIP_GIT=1 ;;
    *)
      echo "Bilinmeyen argüman: $arg" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

if [ -f /root/.nvm/nvm.sh ]; then
  # nvm is not POSIX; this file is sourced only when present.
  # shellcheck disable=SC1091
  . /root/.nvm/nvm.sh
fi

echo "--- Kod güncelleniyor ($ROOT)"
if [ "$SKIP_GIT" -eq 0 ]; then
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  if ! git rev-parse --abbrev-ref HEAD | grep -qx main; then
    git checkout main
  fi
  # Önceki build (örn. eklenti zip yeniden paketleme) tracked dosyaları kirletirse
  # ff-only merge düşer. Bu checkout yalnızca dağıtım içindir — yerel edit tutulmaz.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Uyarı: sunucuda yerel değişiklik var; dağıtımdan önce sıfırlanıyor:"
    git status --short || true
    git reset --hard HEAD
  fi
  if ! git merge --ff-only origin/main; then
    echo "HATA: sunucudaki kopya origin/main ile ileri sarılamıyor (ortak ata yok veya ayrışmış)." >&2
    echo "GitHub geçmişi yeniden yazıldı. Bir kez, yedekten sonra:" >&2
    echo "  git branch backup-pre-rewrite-\$(date +%Y%m%d-%H%M)" >&2
    echo "  git fetch origin +refs/heads/main:refs/remotes/origin/main" >&2
    echo "  git reset --hard origin/main" >&2
    echo "  sh deploy/update-native.sh --skip-git" >&2
    exit 1
  fi
else
  echo "git atlandı (--skip-git), HEAD=$(git rev-parse --short HEAD)"
fi

GIT_SHA="$(git rev-parse HEAD)"
GIT_SHA_SHORT="$(git rev-parse --short HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
GIT_MESSAGE="$(git log -1 --pretty=%s)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Dağıtılan sürüm: $GIT_SHA_SHORT ($GIT_BRANCH) — $GIT_MESSAGE"

echo "--- Backend bağımlılıkları"
if [ ! -x "$ROOT/backend/venv/bin/python3" ]; then
  echo "HATA: $ROOT/backend/venv yok. venv oluşturup requirements.txt kurun." >&2
  exit 1
fi
PY="$ROOT/backend/venv/bin/python3"
PIP="$ROOT/backend/venv/bin/pip"
REQ=/tmp/tamkobi-requirements.native.txt
# PyPI'de yok (malware namesake). litellm tekerleği Emergent CDN; VPS erişemezse düş.
grep -vE '^(#|$)' "$ROOT/backend/requirements.txt" \
  | grep -vE '^(emergentintegrations==|litellm @)' > "$REQ"
"$PIP" install -r "$REQ"
STUB="$ROOT/backend/docker/stubs/emergentintegrations"
SITE="$("$PY" -c "import sysconfig; print(sysconfig.get_path('purelib'))")"
if [ -d "$STUB" ] && [ -n "$SITE" ]; then
  rm -rf "$SITE/emergentintegrations"
  cp -a "$STUB" "$SITE/emergentintegrations"
  echo "emergentintegrations stub → $SITE/emergentintegrations"
fi

echo "--- Frontend üretim derlemesi"
cd "$ROOT/frontend"
# Private visual-edits tarball is optional; CRA/craco already degrades without it.
python3 -c '
import json
from pathlib import Path
p = Path("package.json")
data = json.loads(p.read_text())
deps = data.get("devDependencies") or {}
if "@emergentbase/visual-edits" in deps:
    del deps["@emergentbase/visual-edits"]
    data["devDependencies"] = deps
    p.write_text(json.dumps(data, indent=2) + "\n")
'
if command -v yarn >/dev/null 2>&1; then
  yarn install --network-timeout 600000
  CI=false GENERATE_SOURCEMAP=false DISABLE_ESLINT_PLUGIN=true \
    REACT_APP_GIT_SHA="$GIT_SHA" \
    REACT_APP_GIT_BRANCH="$GIT_BRANCH" \
    REACT_APP_GIT_MESSAGE="$GIT_MESSAGE" \
    REACT_APP_BUILD_TIME="$BUILD_TIME" \
    yarn build
elif command -v npm >/dev/null 2>&1; then
  npm install
  CI=false GENERATE_SOURCEMAP=false DISABLE_ESLINT_PLUGIN=true \
    REACT_APP_GIT_SHA="$GIT_SHA" \
    REACT_APP_GIT_BRANCH="$GIT_BRANCH" \
    REACT_APP_GIT_MESSAGE="$GIT_MESSAGE" \
    REACT_APP_BUILD_TIME="$BUILD_TIME" \
    npm run build
else
  echo "HATA: yarn veya npm bulunamadı." >&2
  exit 1
fi
# prebuild eklenti zip'ini yeniden yazar; sonraki ff-only merge için tracked ağacı temiz tut.
git checkout -- package.json frontend/public/downloads/tamkobi-browser-extension.zip 2>/dev/null || true
if [ -d build ]; then
  chown -R www-data:www-data build
fi

echo "--- uvicorn systemd"
# Canlı VPS tamkobi-backend.service kullanıyor. İkinci birim (tamkobi-uvicorn)
# :8000'i kapışır. Varsa onu kullan; yoksa repo birimini kur.
if systemctl list-unit-files tamkobi-backend.service 2>/dev/null | grep -q tamkobi-backend.service; then
  UNIT=tamkobi-backend
  systemctl disable --now tamkobi-uvicorn 2>/dev/null || true
else
  UNIT=tamkobi-uvicorn
  APP_USER=tamkobi
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd -r -M -d "$ROOT" -s /usr/sbin/nologin -c "TamKobi API" "$APP_USER"
  fi
  install -d -o "$APP_USER" -g "$APP_USER" -m 750 \
    "$ROOT/backend/data" "$ROOT/logs" "$ROOT/backups" /var/log/tamkobi
  chown -R "$APP_USER:$APP_USER" "$ROOT/backend/data" "$ROOT/logs" "$ROOT/backups" /var/log/tamkobi
  for f in "$ROOT/backend/.env" "$ROOT/.env"; do
    if [ -f "$f" ]; then
      chgrp "$APP_USER" "$f"
      chmod 640 "$f"
    fi
  done
  if [ -d "$ROOT/backend/venv" ]; then
    chmod -R a+rX "$ROOT/backend/venv"
  fi
  UNIT_SRC="$ROOT/deploy/tamkobi-uvicorn.service"
  if [ ! -f "$UNIT_SRC" ]; then
    echo "HATA: $UNIT_SRC yok ve tamkobi-backend.service bulunamadı." >&2
    exit 1
  fi
  sed "s|/var/www/tamkobi.com|$ROOT|g" "$UNIT_SRC" > /etc/systemd/system/tamkobi-uvicorn.service
fi

mkdir -p "/etc/systemd/system/${UNIT}.service.d"
# Commit konusu boşluk / tırnak içerir; systemd Environment= satırını
# Python ile kaçırıyoruz (ham heredoc boşlukta kesilir).
export GIT_SHA GIT_BRANCH GIT_MESSAGE BUILD_TIME UNIT
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
dropin = Path("/etc/systemd/system") / f"{os.environ['UNIT']}.service.d"
dropin.mkdir(parents=True, exist_ok=True)
(dropin / "stamp.conf").write_text(
    "[Service]\n"
    f'Environment="APP_GIT_SHA={esc(os.environ.get("GIT_SHA", ""))}"\n'
    f'Environment="APP_GIT_BRANCH={esc(os.environ.get("GIT_BRANCH", ""))}"\n'
    f'Environment="APP_GIT_MESSAGE={esc(msg)}"\n'
    f'Environment="APP_BUILD_TIME={esc(os.environ.get("BUILD_TIME", ""))}"\n',
    encoding="utf-8",
)
print(f"stamp.conf → {dropin / 'stamp.conf'}")
PY

if ! systemctl is-active --quiet "$UNIT" 2>/dev/null; then
  pids=$(ss -ltnp 2>/dev/null | awk '/:8000/ {print}' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
  for p in $pids; do
    echo "Eski uvicorn durduruluyor (pid $p)"
    kill "$p" 2>/dev/null || true
  done
  sleep 2
fi

systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null
systemctl restart "$UNIT"
nginx -t
systemctl reload nginx

echo "--- Sağlık kontrolü"
ok=""
i=0
while [ "$i" -lt 30 ]; do
  i=$((i + 1))
  if curl -fsS --max-time 5 http://127.0.0.1:8000/api/version >/tmp/tamkobi-api-version.json 2>/dev/null; then
    ok=1
    break
  fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "HATA: uvicorn /api/version yanıt vermedi." >&2
  systemctl status "$UNIT" --no-pager -l || true
  journalctl -u "$UNIT" -n 80 --no-pager || true
  exit 1
fi
cat /tmp/tamkobi-api-version.json
echo
served_sha="$(python3 -c "import json; print(json.load(open('/tmp/tamkobi-api-version.json')).get('git_sha') or '')")"
if [ "$served_sha" != "$GIT_SHA" ]; then
  echo "HATA: API $GIT_SHA_SHORT yerine '${served_sha:-boş}' sunuyor." >&2
  exit 1
fi
if ! curl -fsS -o /dev/null --max-time 5 -H "Host: tamkobi.com" http://127.0.0.1/; then
  echo "HATA: nginx frontend/build sunmuyor." >&2
  exit 1
fi
echo "Dağıtım tamam. ($UNIT)"
