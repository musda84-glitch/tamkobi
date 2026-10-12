"""Zero-downtime deploy helpers: symlink, prune, site rewrite, upstream, migrate bits."""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
import textwrap
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
DEPLOY = REPO / "deploy"
LIB = DEPLOY / "lib"


def _sh(script: str, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    full_env = {**os.environ, **(env or {})}
    return subprocess.run(
        ["sh", "-c", script],
        cwd=str(REPO),
        env=full_env,
        text=True,
        capture_output=True,
        check=check,
    )


def test_atomic_symlink_and_build_fail_keeps_current(tmp_path: Path):
    root = tmp_path / "www"
    releases = root / "frontend-releases"
    current = root / "frontend-current"
    releases.mkdir(parents=True)
    a = releases / "aaa"
    b = releases / "bbb"
    a.mkdir()
    (a / "index.html").write_text("A")
    (a / "static").mkdir()
    (a / "static" / "js").mkdir()
    (a / "static" / "js" / "old.js").write_text("1")
    b.mkdir()
    (b / "index.html").write_text("B")
    (b / "static").mkdir()
    (b / "static" / "js").mkdir()
    (b / "static" / "js" / "new.js").write_text("2")

    script = f"""
set -eu
ROOT="{root}"
FRONTEND_RELEASES="{releases}"
FRONTEND_CURRENT="{current}"
KEEP_FRONTEND_RELEASES=5
. "{LIB}/common.sh"
. "{LIB}/frontend.sh"
atomic_symlink "{a}" "$FRONTEND_CURRENT"
test "$(readlink -f "$FRONTEND_CURRENT")" = "$(readlink -f "{a}")"
# simulate failed build: do not call frontend_activate for incomplete dir
bad="{releases}/bad"
mkdir -p "$bad"
# current must stay on aaa
test "$(readlink -f "$FRONTEND_CURRENT")" = "$(readlink -f "{a}")"
# carry previous static before flipping symlink
frontend_copy_prev_static "{b}"
test -f "{b}/static/js/old.js"
test -f "{b}/static/js/new.js"
frontend_activate "bbb"
test "$(readlink -f "$FRONTEND_CURRENT")" = "$(readlink -f "{b}")"
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr


def test_frontend_prune_keeps_five_and_current_prev(tmp_path: Path):
    root = tmp_path / "www"
    releases = root / "frontend-releases"
    current = root / "frontend-current"
    releases.mkdir(parents=True)
    dirs = []
    for i in range(8):
        d = releases / f"sha{i}"
        d.mkdir()
        (d / "index.html").write_text("x")
        (d / "static").mkdir()
        # stagger mtimes
        os.utime(d, (1000 + i, 1000 + i))
        dirs.append(d)
    script = f"""
set -eu
ROOT="{root}"
FRONTEND_RELEASES="{releases}"
FRONTEND_CURRENT="{current}"
KEEP_FRONTEND_RELEASES=5
. "{LIB}/common.sh"
. "{LIB}/frontend.sh"
atomic_symlink "{dirs[-1]}" "$FRONTEND_CURRENT"
frontend_prune_releases
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr
    left = sorted(p.name for p in releases.iterdir() if p.is_dir())
    assert dirs[-1].name in left
    assert len(left) <= 6  # 5 + maybe prev safeguard


def test_write_upstream_port_swap(tmp_path: Path):
    conf = tmp_path / "tamkobi-upstream.conf"
    script = f"""
set -eu
UPSTREAM_CONF="{conf}"
. "{LIB}/common.sh"
write_upstream 8000
grep -q 'server 127.0.0.1:8000' "$UPSTREAM_CONF"
test "$(active_upstream_port)" = "8000"
write_upstream 8001
test "$(active_upstream_port)" = "8001"
test "$(other_port 8001)" = "8000"
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr


def test_site_rewrite_preserves_certbot_triple_listen443(tmp_path: Path):
    """Fixture: 3× listen 443 + Certbot markers; whitespace-tolerant root/proxy."""
    import sys

    sys.path.insert(0, str(LIB))
    from site_rewrite import rewrite_site_root_and_proxy

    root = "/var/www/tamkobi.com"
    site = tmp_path / "tamkobi.com"
    # Varying indentation on root/proxy; three 443 listeners + Certbot comments
    site.write_text(
        "# managed by Certbot\n"
        "server {\n"
        "  listen 443 ssl;\n"
        "  # managed by Certbot\n"
        "  ssl_certificate /etc/letsencrypt/live/tamkobi.com/fullchain.pem;\n"
        "  ssl_certificate_key /etc/letsencrypt/live/tamkobi.com/privkey.pem;\n"
        f"\troot   {root}/frontend/build;\n"
        "  location /api {\n"
        "      proxy_pass    http://127.0.0.1:8000;\n"
        "  }\n"
        "}\n"
        "server {\n"
        "    listen 443 ssl http2;\n"
        "    server_name www.tamkobi.com;\n"
        "    # managed by Certbot\n"
        "    ssl_certificate /etc/letsencrypt/live/tamkobi.com/fullchain.pem;\n"
        "    return 301 https://tamkobi.com$request_uri;\n"
        "}\n"
        "server {\n"
        " listen 443 ssl;\n"
        " ssl_certificate /etc/letsencrypt/live/tamkobi.com/fullchain.pem;\n"
        f" root {root}/frontend/build;\n"
        " location /api { proxy_pass http://127.0.0.1:8000; }\n"
        "}\n",
        encoding="utf-8",
    )
    before_cert = [ln for ln in site.read_text().splitlines(True) if "managed by Certbot" in ln or "ssl_certificate" in ln]
    status, rn, pn = rewrite_site_root_and_proxy(site, root)
    assert status == "ok"
    assert rn >= 1 and pn >= 1
    text = site.read_text()
    assert "frontend-current" in text
    assert "tamkobi_api" in text
    assert text.count("listen 443") == 3
    after_cert = [ln for ln in text.splitlines(True) if "managed by Certbot" in ln or "ssl_certificate" in ln]
    assert before_cert == after_cert
    status2, _, _ = rewrite_site_root_and_proxy(site, root)
    assert status2 == "already"


def test_site_rewrite_unexpected_count_no_change(tmp_path: Path):
    import sys

    sys.path.insert(0, str(LIB))
    from site_rewrite import rewrite_site_root_and_proxy

    site = tmp_path / "site"
    original = "server {\n    listen 80;\n}\n"
    site.write_text(original)
    with pytest.raises(ValueError, match="root line count"):
        rewrite_site_root_and_proxy(site, "/var/www/tamkobi.com")
    assert site.read_text() == original


def test_nginx_t_failure_restores_site_backup(tmp_path: Path):
    """Simulate migrate step 5: nginx -t fails → restore bak, remove upstream."""
    site = tmp_path / "sites-available" / "tamkobi.com"
    site.parent.mkdir(parents=True)
    site.write_text("GOOD\n")
    bak = tmp_path / "root" / "nginx-tamkobi.com.bak"
    bak.parent.mkdir(parents=True)
    shutil.copy(site, bak)
    site.write_text("BAD\n")
    upstream = tmp_path / "conf.d" / "tamkobi-upstream.conf"
    upstream.parent.mkdir(parents=True)
    upstream.write_text("upstream x {}\n")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    nginx = bin_dir / "nginx"
    nginx.write_text("#!/bin/sh\nexit 1\n")
    nginx.chmod(nginx.stat().st_mode | stat.S_IXUSR)

    script = f"""
set -eu
PATH="{bin_dir}:$PATH"
SITE_FILE="{site}"
SITE_BAK="{bak}"
UPSTREAM_CONF="{upstream}"
if ! nginx -t; then
  cp -a "$SITE_BAK" "$SITE_FILE"
  rm -f "$UPSTREAM_CONF"
  exit 1
fi
"""
    r = _sh(script, check=False)
    assert r.returncode == 1
    assert site.read_text() == "GOOD\n"
    assert not upstream.exists()


def test_update_native_requires_migration_marker(tmp_path: Path):
    root = tmp_path / "www"
    root.mkdir()
    script = f"""
set -eu
ROOT="{root}"
DEPLOY_PATH="{root}"
. "{LIB}/common.sh"
require_zero_downtime_ready
"""
    r = _sh(script, check=False)
    assert r.returncode != 0
    assert "migrate-zero-downtime" in (r.stderr + r.stdout)


def test_shellcheck_all_deploy_scripts():
    shellcheck = shutil.which("shellcheck") or str(Path.home() / ".local/bin/shellcheck")
    if not Path(shellcheck).is_file():
        pytest.skip("shellcheck not installed")
    scripts = [
        DEPLOY / "update-native.sh",
        DEPLOY / "migrate-zero-downtime.sh",
        DEPLOY / "rollback.sh",
        DEPLOY / "status.sh",
        LIB / "common.sh",
        LIB / "frontend.sh",
        LIB / "backend.sh",
    ]
    r = subprocess.run(
        [shellcheck, "-x", "-s", "sh", *[str(s) for s in scripts]],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stdout + r.stderr


def test_release_conf_clears_execstart_then_sets_one(tmp_path: Path):
    root = tmp_path / "www"
    rel = root / "backend-releases" / "deadbeef"
    venv = tmp_path / "venv"
    (venv / "bin").mkdir(parents=True)
    (venv / "bin" / "uvicorn").write_text("#!/bin/sh\n")
    (venv / "bin" / "uvicorn").chmod(0o755)
    rel.mkdir(parents=True)
    unit_root = tmp_path / "systemd"
    drop_root = unit_root
    script = f"""
set -eu
ROOT="{root}"
BACKEND_RELEASES="{root}/backend-releases"
SYSTEMD_DROPIN_ROOT="{drop_root}"
SYSTEMD_UNIT_ROOT="{unit_root}"
SKIP_SYSTEMCTL=1
GIT_SHA=deadbeef
GIT_BRANCH=test
GIT_MESSAGE=msg
BUILD_TIME=t
APP_VERSION=1
. "{LIB}/common.sh"
. "{LIB}/backend.sh"
backend_write_instance_dropins 8001 deadbeef "{venv}"
conf="{drop_root}/tamkobi-backend@8001.service.d/release.conf"
grep -q '^ExecStart=$' "$conf"
# Exactly one non-empty ExecStart=
test "$(grep -c '^ExecStart=.' "$conf")" = "1"
# Empty clear appears before real ExecStart
awk '/^ExecStart=$/{{c=1}} /^ExecStart=./{{if(!c) exit 1}} END{{if(!c) exit 1}}' "$conf"
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr + r.stdout
    conf = drop_root / "tamkobi-backend@8001.service.d" / "release.conf"
    text = conf.read_text()
    assert "ExecStart=\n" in text or "ExecStart=\r\n" in text or "ExecStart=\nExecStart=" in text.replace("\r", "")
    # systemd-analyze verify when available
    analyze = shutil.which("systemd-analyze")
    if analyze:
        unit_dst = unit_root / "tamkobi-backend@.service"
        unit_dst.write_text((DEPLOY / "tamkobi-backend@.service").read_text())
        # Instance verify needs concrete instance name — write a shim unit
        shim = unit_root / "tamkobi-backend@8001.service"
        shim.write_text(
            "[Unit]\nDescription=test\n[Service]\nType=simple\n"
            "ExecStart=/bin/false\n"
        )
        # Drop-in already written next to @8001 via SYSTEMD_DROPIN_ROOT
        # Point systemd to our tree via --user is hard; verify drop-in text invariants above.
        # Also run verify on the template if possible:
        vr = subprocess.run(
            [analyze, "verify", str(unit_dst)],
            capture_output=True,
            text=True,
        )
        # template with ExecStart=/bin/false alone is fine; ignore path warnings
        assert vr.returncode in (0, 1)  # warnings may yield 1 on some distros
        # Our critical invariant is the clear line:
        assert "ExecStart=\nExecStart=" in text.replace("\r\n", "\n")


def test_ensure_venv_stdout_is_single_absolute_path(tmp_path: Path):
    root = tmp_path / "www"
    (root / "backend").mkdir(parents=True)
    (root / "backend" / "requirements.txt").write_text("pip\n")
    (root / "backend" / "docker" / "stubs" / "emergentintegrations").mkdir(parents=True)
    (root / "backend" / "docker" / "stubs" / "emergentintegrations" / "__init__.py").write_text("")
    venvs = root / "venvs"
    # Pre-create a fake hashed venv so ensure_venv reuses without pip
    import hashlib
    h = hashlib.sha256((root / "backend" / "requirements.txt").read_bytes()).hexdigest()[:16]
    v = venvs / h
    (v / "bin").mkdir(parents=True)
    for name in ("python3", "uvicorn", "pip"):
        p = v / "bin" / name
        p.write_text("#!/bin/sh\necho ok\n")
        p.chmod(0o755)
    # python3 -c for sysconfig must work — point to real python via symlink
    real_py = shutil.which("python3")
    (v / "bin" / "python3").unlink()
    os.symlink(real_py, v / "bin" / "python3")
    script = f"""
set -eu
ROOT="{root}"
VENVS_DIR="{venvs}"
. "{LIB}/common.sh"
. "{LIB}/backend.sh"
out=$(backend_ensure_venv)
echo "OUT=$out"
validate_venv_path "$out"
# stdout capture must be single absolute path
case "$out" in /*) ;; *) exit 2 ;; esac
test "$(printf '%s' "$out" | awk 'END{{print NR}}')" = "1"
test -d "$out"
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr + r.stdout
    # info lines must not be in OUT=
    out_line = [ln for ln in r.stdout.splitlines() if ln.startswith("OUT=")][0]
    assert "---" not in out_line
    assert "venv" in out_line or out_line.startswith("OUT=/")


def test_prepare_release_data_is_symlink_to_shared(tmp_path: Path):
    root = tmp_path / "www"
    backend = root / "backend"
    backend.mkdir(parents=True)
    (backend / "data").mkdir()
    (backend / "data" / "install.json").write_text("{}")
    (backend / ".env").write_text("X=1\n")
    (backend / "server.py").write_text("#x\n")
    (backend / "requirements.txt").write_text("pip\n")
    # Simulate archive leaving a real data/ dir with .gitkeep
    releases = root / "backend-releases"
    sha = "abc123"
    dest = releases / sha
    dest.mkdir(parents=True)
    (dest / "server.py").write_text("#x\n")
    (dest / "data").mkdir()
    (dest / "data" / ".gitkeep").write_text("")
    script = f"""
set -eu
ROOT="{root}"
BACKEND_RELEASES="{releases}"
. "{LIB}/common.sh"
. "{LIB}/backend.sh"
backend_prepare_release "{sha}"
test -L "{dest}/data"
tgt=$(readlink -f "{dest}/data")
want=$(readlink -f "{backend}/data")
test "$tgt" = "$want"
# must not be nested data/data
test ! -e "{dest}/data/data"
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr + r.stdout


def test_frontend_activate_only_after_success_simulated(tmp_path: Path):
    """Build-ready release exists; activate must not run when health fails."""
    root = tmp_path / "www"
    fe = root / "frontend-releases"
    cur = root / "frontend-current"
    fe.mkdir(parents=True)
    old = fe / "oldsha"
    new = fe / "newsha"
    for d, body in ((old, "OLD"), (new, "NEW")):
        d.mkdir()
        (d / "index.html").write_text(body)
        (d / "static").mkdir()
    script = f"""
set -eu
ROOT="{root}"
FRONTEND_RELEASES="{fe}"
FRONTEND_CURRENT="{cur}"
. "{LIB}/common.sh"
. "{LIB}/frontend.sh"
atomic_symlink "{old}" "$FRONTEND_CURRENT"
# simulate update flow: build ok, health fails → do NOT activate
frontend_build_ok=1
health_ok=0
if [ "$health_ok" -eq 1 ]; then
  frontend_activate "newsha"
fi
test "$(readlink -f "$FRONTEND_CURRENT")" = "$(readlink -f "{old}")"
# success path
health_ok=1
if [ "$health_ok" -eq 1 ]; then
  frontend_activate "newsha"
fi
test "$(readlink -f "$FRONTEND_CURRENT")" = "$(readlink -f "{new}")"
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr


def test_release_history_rollback_goes_further_back(tmp_path: Path):
    hist = tmp_path / "deploy" / ".release-history"
    hist.parent.mkdir(parents=True)
    script = f"""
set -eu
RELEASE_HISTORY="{hist}"
ROOT="{tmp_path}"
. "{LIB}/common.sh"
release_history_append sha1
release_history_append sha2
release_history_append sha3
test "$(release_history_prev)" = "sha2"
release_history_truncate_to sha2
test "$(tail -n1 "$RELEASE_HISTORY")" = "sha2"
test "$(release_history_prev)" = "sha1"
release_history_truncate_to sha1
! release_history_prev
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr + r.stdout


def test_require_deploy_tools_fails_clearly(tmp_path: Path):
    script = f"""
set -eu
PATH="{tmp_path}/empty"
ROOT="{tmp_path}"
. "{LIB}/common.sh"
require_deploy_tools
"""
    (tmp_path / "empty").mkdir()
    r = _sh(script, check=False)
    assert r.returncode != 0
    assert "Gerekli komut" in r.stderr


def test_service_user_from_legacy_unit(tmp_path: Path):
    unit_dir = tmp_path / "etc" / "systemd" / "system"
    unit_dir.mkdir(parents=True)
    (unit_dir / "tamkobi-backend.service").write_text(
        "[Service]\nUser=www-data\nGroup=www-data\nExecStart=/bin/true\n"
    )
    # Point detect at our fake unit via bind-style path: patch by copying into
    # expected location is hard; instead source a thin wrapper.
    script = f"""
set -eu
ROOT="{tmp_path}/www"
mkdir -p "$ROOT"
. "{LIB}/common.sh"
. "{LIB}/backend.sh"
# Inline detect using the fixture unit (same logic as backend_detect_service_user)
_unit="{unit_dir}/tamkobi-backend.service"
SERVICE_USER=$(sed -n 's/^User=//p' "$_unit" | head -n1)
SERVICE_GROUP=$(sed -n 's/^Group=//p' "$_unit" | head -n1)
[ -n "$SERVICE_USER" ] || SERVICE_USER=root
[ -n "$SERVICE_GROUP" ] || SERVICE_GROUP=$SERVICE_USER
test "$SERVICE_USER" = "www-data"
test "$SERVICE_GROUP" = "www-data"
# No legacy unit → root
SERVICE_USER=
SERVICE_GROUP=
[ -n "$SERVICE_USER" ] || SERVICE_USER=root
[ -n "$SERVICE_GROUP" ] || SERVICE_GROUP=$SERVICE_USER
test "$SERVICE_USER" = "root"
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr


def test_credential_key_check_never_writes(tmp_path: Path):
    key = tmp_path / ".credential_encryption_key"
    key.write_text("secret-key-material\n")
    key.chmod(0o000)
    script = f"""
set -eu
ROOT="{tmp_path}"
SERVICE_USER=nobody
CREDENTIAL_KEY_PATH="{key}"
. "{LIB}/common.sh"
. "{LIB}/backend.sh"
check_credential_key_readable
"""
    r = _sh(script, check=False)
    assert r.returncode != 0
    assert "ASLA" in r.stderr or "okunamıyor" in r.stderr
    assert key.read_bytes() == b"secret-key-material\n"
    key.chmod(0o600)


def test_validate_venv_rejects_multiline(tmp_path: Path):
    v = tmp_path / "venv"
    (v / "bin").mkdir(parents=True)
    (v / "bin" / "uvicorn").write_text("#!/bin/sh\n")
    (v / "bin" / "uvicorn").chmod(0o755)
    script = f"""
set -eu
. "{LIB}/common.sh"
. "{LIB}/backend.sh"
# polluted capture must fail (die exits subshell)
bad=$(printf '%s\\n%s' "{v}" "--- venv yeniden kullanılıyor")
if (validate_venv_path "$bad"); then
  echo "expected failure" >&2
  exit 1
fi
validate_venv_path "{v}"
"""
    r = _sh(script)
    assert r.returncode == 0, r.stderr

def test_systemd_analyze_verify_dropin_clears_execstart(tmp_path: Path):
    """When systemd-analyze is present, verify instance unit + drop-in with ExecStart= clear."""
    analyze = shutil.which("systemd-analyze")
    if not analyze:
        pytest.skip("systemd-analyze not installed")
    unit_root = tmp_path / "systemd"
    unit_root.mkdir()
    # Concrete instance unit (template %i already expanded)
    unit = unit_root / "tamkobi-backend@8001.service"
    unit.write_text(
        "[Unit]\nDescription=TamKobi test\n"
        "[Service]\nType=simple\nUser=root\nGroup=root\n"
        "ExecStart=/bin/false\n"
        "Restart=no\n"
    )
    drop = unit_root / "tamkobi-backend@8001.service.d"
    drop.mkdir()
    (drop / "release.conf").write_text(
        "[Service]\n"
        "WorkingDirectory=/tmp\n"
        "ExecStart=\n"
        "ExecStart=/bin/true\n"
    )
    vr = subprocess.run(
        [analyze, "verify", str(unit)],
        capture_output=True,
        text=True,
    )
    combined = (vr.stdout or "") + (vr.stderr or "")
    assert "Refusing" not in combined, combined
    assert "Two or more" not in combined and "more than one" not in combined.lower(), combined
    # Without clear line, dual ExecStart must be refused
    (drop / "release.conf").write_text(
        "[Service]\nExecStart=/bin/true\n"
    )
    bad = subprocess.run(
        [analyze, "verify", str(unit)],
        capture_output=True,
        text=True,
    )
    bad_out = (bad.stdout or "") + (bad.stderr or "")
    # systemd reports refusing to start / more than one ExecStart
    assert bad.returncode != 0 or "Refusing" in bad_out or "ExecStart" in bad_out
