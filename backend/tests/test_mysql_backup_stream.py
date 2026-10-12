"""mysql_backup streaming path (mysqldump stub + fetchmany)."""
from __future__ import annotations

import gzip
import os
import stat
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_mysqldump_stream_uses_defaults_file_not_argv(tmp_path, monkeypatch):
    import mysql_backup as mb

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    dump = bin_dir / "mysqldump"
    # Stub writes SQL to stdout; records argv to a log
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
    with gzip.open(sql_path, "rt", encoding="utf-8") as f:
        body = f.read()
    assert "CREATE TABLE" in body


def test_backup_prefers_mysqldump_when_available(tmp_path, monkeypatch):
    import mysql_backup as mb

    def fake_stream(dest, settings=None):
        p = dest / "tamkobi-x.sql.gz"
        dest.mkdir(parents=True, exist_ok=True)
        with gzip.open(p, "wt", encoding="utf-8") as f:
            f.write("CREATE TABLE docs (id int);\nINSERT INTO docs VALUES (1);\n")
        return p, {"sql": str(p), "json": None, "tables": {}, "method": "mysqldump-stream", "database": "tamkobi"}

    def fake_json(dest, settings=None, *, write_sql=True, stamp=None):
        dest.mkdir(parents=True, exist_ok=True)
        jp = dest / f"tamkobi-{stamp or 'x'}.json.gz"
        with gzip.open(jp, "wt", encoding="utf-8") as f:
            f.write('{"format":"tamkobi-mysql-snapshot-v1","database":"tamkobi","created_at":"t","tables":{"docs":{"create":"CREATE TABLE docs(id int)","columns":["id"],"rows":[[1]],"row_count":1}}}')
        return jp, None, {"tables": {"docs": 1}, "method": "json-fetchmany-stream"}

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
    assert out["method"] == "mysqldump-stream+json"
    assert out["sql"]
    assert out["json"]