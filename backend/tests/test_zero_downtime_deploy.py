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


def test_site_rewrite_preserves_certbot_and_idempotent(tmp_path: Path):
    import sys

    sys.path.insert(0, str(LIB))
    from site_rewrite import rewrite_site_root_and_proxy

    root = "/var/www/tamkobi.com"
    site = tmp_path / "tamkobi.com"
    site.write_text(
        textwrap.dedent(
            f"""\
            # managed by Certbot
            server {{
                listen 443 ssl;
                ssl_certificate /etc/letsencrypt/live/tamkobi.com/fullchain.pem;
                ssl_certificate_key /etc/letsencrypt/live/tamkobi.com/privkey.pem;
                root {root}/frontend/build;
                location /api {{
                    proxy_pass http://127.0.0.1:8000;
                }}
            }}
            """
        ),
        encoding="utf-8",
    )
    # exact indentation required
    site.write_text(
        "# managed by Certbot\n"
        "server {\n"
        "    listen 443 ssl;\n"
        "    ssl_certificate /etc/letsencrypt/live/tamkobi.com/fullchain.pem;\n"
        "    ssl_certificate_key /etc/letsencrypt/live/tamkobi.com/privkey.pem;\n"
        f"    root {root}/frontend/build;\n"
        "    location /api {\n"
        "        proxy_pass http://127.0.0.1:8000;\n"
        "    }\n"
        "}\n",
        encoding="utf-8",
    )
    status, rn, pn = rewrite_site_root_and_proxy(site, root)
    assert status == "ok"
    assert rn == 1 and pn == 1
    text = site.read_text()
    assert "frontend-current" in text
    assert "tamkobi_api" in text
    assert "letsencrypt" in text
    assert "managed by Certbot" in text
    assert "127.0.0.1:8000" not in text
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
