"""mysql_backup streaming path (mysqldump stub + fetchmany + restore isolation)."""
from __future__ import annotations

import gzip
import os
import resource
import stat
import subprocess
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_mysqldump_stream_uses_defaults_file_not_argv_no_databases(tmp_path, monkeypatch):
    import mysql_backup as mb

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    dump = bin_dir / "mysqldump"
    log = tmp_path / "argv.log"
    dump.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$@" > "{log}"\n'
        'echo "-- dump"; echo "CREATE TABLE t (id int);"\n'
        "exit 0\n"
    )
    dump.chmod(dump.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH','')}")
    monkeypatch.setattr(mb, "mysql_settings", lambda **k: {
        "host": "127.0.0.1",
        "port": 3306,
        "user": "u",
        "password": "secret-password",
        "database": "tamkobi",
        "charset": "utf8mb4",
    })

    dest = tmp_path / "backups"
    sql_path, meta = mb.backup_mysqldump_stream(dest)
    assert sql_path.exists()
    assert meta["method"] == "mysqldump-stream"
    argv = log.read_text()
    assert "secret-password" not in argv
    assert "--defaults-extra-file=" in argv
    assert "--single-transaction" in argv
    assert "--quick" in argv
    assert "--databases" not in argv
    # DB name as positional arg
    assert "tamkobi" in argv.splitlines()
    with gzip.open(sql_path, "rt", encoding="utf-8") as f:
        body = f.read()
    assert "CREATE TABLE" in body
    assert "CREATE DATABASE" not in body
    assert "USE `" not in body


def test_backup_mysqldump_skips_json(tmp_path, monkeypatch):
    import mysql_backup as mb

    called = {"json": 0}

    def fake_stream(dest, settings=None):
        p = dest / "tamkobi-x.sql.gz"
        dest.mkdir(parents=True, exist_ok=True)
        with gzip.open(p, "wt", encoding="utf-8") as f:
            f.write("CREATE TABLE docs (id int);\nINSERT INTO docs VALUES (1);\n")
        return p, {"sql": str(p), "json": None, "tables": {}, "method": "mysqldump-stream", "database": "tamkobi"}

    def fake_json(*a, **k):
        called["json"] += 1
        raise AssertionError("backup_json_stream must not run when mysqldump is available")

    monkeypatch.setattr(mb, "mysqldump_available", lambda: True)
    monkeypatch.setattr(mb, "backup_mysqldump_stream", fake_stream)
    monkeypatch.setattr(mb, "backup_json_stream", fake_json)
    monkeypatch.setattr(mb, "verify_snapshot_file", lambda p: {"path": str(p)})
    monkeypatch.setattr(mb, "rotate_backups", lambda *a, **k: [])
    monkeypatch.setattr(mb, "mysql_settings", lambda **k: {
        "host": "127.0.0.1", "port": 3306, "user": "u", "password": "p", "database": "tamkobi",
    })
    monkeypatch.setattr(mb, "load_env", lambda: None)

    out = mb.backup(dest_dir=tmp_path / "b", keep_days=14)
    assert out["method"] == "mysqldump-stream"
    assert out["sql"]
    assert out["json"] is None
    assert called["json"] == 0


def test_assert_sql_rejects_use_and_create_database(tmp_path):
    import mysql_backup as mb

    bad = tmp_path / "bad.sql.gz"
    with gzip.open(bad, "wt", encoding="utf-8") as f:
        f.write("CREATE DATABASE `other`;\nUSE `other`;\nCREATE TABLE t(id int);\n")
    with pytest.raises(ValueError, match="database switch"):
        mb.assert_sql_gz_no_database_switch(bad)


def test_verify_snapshot_json_streams_without_full_load(tmp_path):
    import mysql_backup as mb

    p = tmp_path / "snap.json.gz"
    # Large-ish payload; verify must not require full json.loads of whole structure
    with gzip.open(p, "wt", encoding="utf-8") as f:
        f.write('{"format":"tamkobi-mysql-snapshot-v1","database":"tamkobi","tables":{')
        f.write('"docs":{"columns":["collection","doc"],"rows":[],"row_count":0},')
        f.write('"meta_indexes":{"columns":["collection"],"rows":[],"row_count":0}')
        f.write("}}")
    info = mb.verify_snapshot_file(p)
    assert info["format"] == "json-stream"


def test_mysqldump_backup_rss_under_100mb(tmp_path, monkeypatch):
    """Stub mysqldump emits ~300MB SQL; process RSS peak must stay under 100MB."""
    import mysql_backup as mb

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    dump = bin_dir / "mysqldump"
    # ~300 MiB of repetitive SQL on stdout
    dump.write_text(
        "#!/bin/sh\n"
        "python3 - <<'PY'\n"
        "import sys\n"
        "chunk = ('INSERT INTO t VALUES (1);\\n')\n"
        "target = 300 * 1024 * 1024\n"
        "written = 0\n"
        "sys.stdout.write('-- big dump\\nCREATE TABLE t (id int);\\n')\n"
        "while written < target:\n"
        "    sys.stdout.write(chunk)\n"
        "    written += len(chunk)\n"
        "PY\n"
    )
    dump.chmod(dump.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH','')}")
    monkeypatch.setattr(mb, "mysql_settings", lambda **k: {
        "host": "127.0.0.1", "port": 3306, "user": "u", "password": "p",
        "database": "tamkobi", "charset": "utf8mb4",
    })

    # Run in subprocess so RSS is isolated
    script = tmp_path / "run_backup.py"
    script.write_text(
        "import os, sys\n"
        f"sys.path.insert(0, {str(Path(__file__).resolve().parents[1])!r})\n"
        "import mysql_backup as mb\n"
        f"mb.backup_mysqldump_stream({str(tmp_path / 'out')!r})\n"
        "import resource\n"
        "print(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)\n"
    )
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH','')}"}
    # Patch mysql_settings inside subprocess via env not available — inline monkeypatch in script
    script.write_text(
        "import os, sys, resource\n"
        f"sys.path.insert(0, {str(Path(__file__).resolve().parents[1])!r})\n"
        "import mysql_backup as mb\n"
        "mb.mysql_settings = lambda **k: {"
        "'host':'127.0.0.1','port':3306,'user':'u','password':'p',"
        "'database':'tamkobi','charset':'utf8mb4'}\n"
        f"mb.backup_mysqldump_stream({str(tmp_path / 'out')!r})\n"
        "print(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)\n"
    )
    r = subprocess.run(
        [sys.executable, str(script)],
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert r.returncode == 0, r.stderr
    # Linux ru_maxrss is in kilobytes
    rss_kb = int(r.stdout.strip().splitlines()[-1])
    assert rss_kb < 100 * 1024, f"RSS too high: {rss_kb} KB (limit 100MB)"


def test_restore_sql_gz_isolates_databases():
    """Real MariaDB: backup A, mutate A, restore into B → B filled, A mutation kept."""
    import mysql_backup as mb

    mb.load_env()
    if not mb.mysqldump_available() or not __import__("shutil").which("mysql"):
        pytest.skip("mysqldump/mysql not available")
    try:
        conn = mb.connect()
        conn.ping(reconnect=True)
        conn.close()
    except Exception as exc:
        pytest.skip(f"MySQL not reachable: {exc}")

    cfg = mb.mysql_settings()
    db_a = f"tamkobi_zdd_a_{os.getpid()}"
    db_b = f"tamkobi_zdd_b_{os.getpid()}"
    marker = f"marker-{os.getpid()}"

    def _admin():
        return mb.connect({
            **cfg,
            "user": os.environ.get("MYSQL_ROOT_USER", cfg["user"]),
            "password": os.environ.get("MYSQL_ROOT_PASSWORD") or os.environ.get("DB_PASSWORD") or cfg["password"],
            "database": None,
        })

    try:
        adm = _admin()
        cur = adm.cursor()
        for name in (db_a, db_b):
            cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
            cur.execute(
                f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        cur.execute(f"USE `{db_a}`")
        cur.execute("CREATE TABLE t (id INT PRIMARY KEY, note VARCHAR(64))")
        cur.execute("INSERT INTO t (id, note) VALUES (1, 'orig')")
        adm.commit()
        adm.close()

        # Backup A (no --databases)
        settings_a = {**cfg, "database": db_a}
        dest = Path(os.environ.get("TMPDIR", "/tmp")) / f"zdd-bak-{os.getpid()}"
        dest.mkdir(exist_ok=True)
        sql_path, _ = mb.backup_mysqldump_stream(dest, settings_a)

        # Mutate A after backup
        ca = mb.connect({**cfg, "database": db_a})
        c = ca.cursor()
        c.execute("INSERT INTO t (id, note) VALUES (2, %s)", (marker,))
        ca.commit()
        ca.close()

        # Restore into B
        mb.restore_sql_gz(sql_path, target_db=db_b, yes=True)

        cb = mb.connect({**cfg, "database": db_b})
        c = cb.cursor()
        c.execute("SELECT id, note FROM t ORDER BY id")
        rows_b = c.fetchall()
        cb.close()
        assert rows_b == ((1, "orig"),), rows_b

        ca = mb.connect({**cfg, "database": db_a})
        c = ca.cursor()
        c.execute("SELECT note FROM t WHERE id=2")
        assert c.fetchone()[0] == marker
        ca.close()
    except Exception as exc:
        if "Access denied" in str(exc) or "1698" in str(exc):
            pytest.skip(f"insufficient MySQL privileges: {exc}")
        raise
    finally:
        try:
            adm = _admin()
            cur = adm.cursor()
            for name in (db_a, db_b):
                cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
            adm.close()
        except Exception:
            pass
