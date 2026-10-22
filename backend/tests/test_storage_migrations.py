"""Şema migration aracı. Canlı veritabanına bağlanmaz.

Boş hedefe paket uygulanır, tekrar yazmaz, yarım kalan adım sürer,
dry-run dosya oluşturmaz, legacy ve docs reddedilir, DSN çıktıda maskelenir.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import sys
import types
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from storage_migrations.cli import main  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.errors import ChecksumError, LegacyTargetError, MigrationError  # noqa: E402
from storage_migrations.loader import Migration, load_migrations  # noqa: E402
from storage_migrations.session import Session, connect  # noqa: E402
from storage_migrations.targets import list_targets  # noqa: E402
import storage_router  # noqa: E402

SECRET = "s3cret-dsn-value"


class Catalog:
    def __init__(self, docs):
        self._docs = docs

    def __getitem__(self, name):
        if name != "companies":
            raise KeyError(name)
        return types.SimpleNamespace(docs=self._docs)


class TraceSession(Session):
    def __init__(self, conn):
        super().__init__(conn, "sqlite", read_only=False)
        self.calls = []
        self.fail_marker = True
        self.writes = 0

    def execute(self, sql, params=None):
        text = sql.strip()
        self.calls.append(text)
        head = text.lstrip().upper()
        if not head.startswith(("SELECT", "PRAGMA", "WITH", "EXPLAIN", "SHOW")):
            self.writes += 1
        if self.fail_marker and "storage_marker" in text and head.startswith("INSERT"):
            self.fail_marker = False
            raise RuntimeError("kesildi")
        return super().execute(sql, params)


def _memory(*, fail=False):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    session = TraceSession(conn)
    session.fail_marker = fail
    return session


def _count(session, table):
    return session.fetchall(f"SELECT COUNT(*) FROM {table}")[0][0]


def test_pack_versions_are_contiguous():
    pack = load_migrations()
    assert [item.version for item in pack] == [1, 2, 3]
    assert pack[0].name == "storage_meta"
    assert pack[1].name == "marker_steps"
    assert pack[2].name == "docs_v2"
    assert len(pack[0].steps) == 2
    assert len(pack[1].steps) == 2
    assert pack[2].mysql_steps
    assert pack[0].mysql_steps == ()


def test_empty_target_then_second_apply_writes_nothing():
    session = _memory()
    first = apply(session, confirm=True, dry_run=False)
    assert first.wrote is True
    assert first.advanced == 3
    assert [row.state for row in first.rows] == ["uygulandı", "uygulandı", "uygulandı"]
    assert _count(session, "storage_meta") == 1
    assert _count(session, "storage_marker") == 1
    session.writes = 0
    second = apply(session, confirm=True, dry_run=False)
    assert second.advanced == 0
    assert second.wrote is True
    assert session.writes == 0
    assert _count(session, "storage_meta") == 1
    assert _count(session, "storage_marker") == 1


def test_interrupted_migration_resumes_without_repeating_finished_step():
    session = _memory(fail=True)
    with pytest.raises(MigrationError, match="kesildi"):
        apply(session, confirm=True, dry_run=False)
    row = session.fetchall(
        "SELECT state, step_no FROM schema_version WHERE version = 2"
    )[0]
    assert row[0] == "applying"
    assert row[1] == 1
    assert _count(session, "storage_marker") == 0
    creates = [
        sql for sql in session.calls
        if "storage_marker" in sql and sql.lstrip().upper().startswith("CREATE")
    ]
    assert len(creates) == 1
    done = apply(session, confirm=True, dry_run=False)
    assert done.advanced == 2
    assert [row.state for row in done.rows] == ["uygulandı", "uygulandı", "uygulandı"]
    assert _count(session, "storage_marker") == 1
    creates = [
        sql for sql in session.calls
        if "storage_marker" in sql and sql.lstrip().upper().startswith("CREATE")
    ]
    assert len(creates) == 1
    session.writes = 0
    again = apply(session, confirm=True, dry_run=False)
    assert again.advanced == 0
    assert session.writes == 0


def test_finished_index_step_is_not_created_again():
    session = _memory()
    apply(session, confirm=True, dry_run=False)
    pack = load_migrations()
    last = len(pack[2].steps)
    name = "idx_v2_unique_doc"
    found = session.fetchall(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
        (name,),
    )
    assert found
    session.execute(
        "UPDATE schema_version SET state = ?, step_no = ? WHERE version = ?",
        ("applying", last - 1, 3),
    )
    session.commit()
    session.calls.clear()
    done = apply(session, confirm=True, dry_run=False)
    assert done.rows[2].state == "uygulandı"
    assert done.rows[2].step == last
    created = [sql for sql in session.calls if sql.lstrip().upper().startswith("CREATE")]
    assert created == []
    found = session.fetchall(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
        (name,),
    )
    assert len(found) == 1


def test_dry_run_and_missing_confirm_do_not_write():
    raw = sqlite3.connect(":memory:")
    session = Session(raw, "sqlite", read_only=False)
    preview = apply(session, confirm=False, dry_run=True)
    assert preview.wrote is False
    assert preview.advanced == 0
    explicit = apply(session, confirm=True, dry_run=True)
    assert explicit.wrote is False
    names = {row[0] for row in raw.execute("SELECT name FROM sqlite_master")}
    assert names == set()
    both_off = apply(session, confirm=False, dry_run=False)
    assert both_off.wrote is False
    names = {row[0] for row in raw.execute("SELECT name FROM sqlite_master")}
    assert names == set()


def test_cli_dry_run_does_not_create_file(tmp_path, monkeypatch, capsys):
    path = tmp_path / "yeni.db"
    monkeypatch.setenv("STORAGE_SHARED_V2_DSN", f"sqlite:///{path}")
    code = main(["apply", "--target", "shared_v2"])
    assert code == 0
    assert not path.exists()
    out = capsys.readouterr().out
    assert "yazılmadı" in out
    assert "bekliyor" in out
    code = main(["apply", "--target", "shared_v2", "--confirm", "--dry-run"])
    assert code == 0
    assert not path.exists()


def test_legacy_target_is_rejected_before_connect(monkeypatch, capsys):
    def boom(*_args, **_kwargs):
        raise AssertionError("bağlantı açılmamalı")

    monkeypatch.setattr("storage_migrations.session._connect_sqlite", boom)
    monkeypatch.setattr("storage_migrations.session._connect_mysql", boom)
    code = main(["apply", "--target", " Legacy ", "--confirm"])
    captured = capsys.readouterr()
    assert code == 2
    assert "Legacy" in captured.err


def test_docs_table_is_rejected(tmp_path, monkeypatch, capsys):
    path = tmp_path / "legacy.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE docs (collection TEXT, id TEXT, doc TEXT)")
    conn.commit()
    conn.close()
    monkeypatch.setenv("STORAGE_SHARED_V2_DSN", f"sqlite:///{path}")
    code = main(["apply", "--target", "shared_v2", "--confirm"])
    captured = capsys.readouterr()
    assert code == 2
    assert "docs" in captured.err
    conn = sqlite3.connect(path)
    names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master")}
    conn.close()
    assert "schema_version" not in names
    assert "storage_meta" not in names


def test_live_mysql_identity_is_rejected_without_connecting(monkeypatch):
    dsn = f"mysql://app:{SECRET}@10.0.0.8:3306/tamkobi"
    monkeypatch.setenv("MYSQL_URL", dsn)

    def boom(*_args, **_kwargs):
        raise AssertionError("bağlantı açılmamalı")

    monkeypatch.setattr("storage_migrations.session._connect_mysql", boom)
    with pytest.raises(LegacyTargetError) as caught:
        connect(f"mysql://other:{SECRET}@10.0.0.8:3306/tamkobi", write=True)
    assert SECRET not in str(caught.value)
    assert "10.0.0.8" not in str(caught.value)


def test_dsn_is_masked_in_output_and_logs(tmp_path, monkeypatch, capsys):
    folder = tmp_path / SECRET
    path = folder / "app.db"
    dsn = f"sqlite:///{path}"
    monkeypatch.setenv("STORAGE_SHARED_V2_DSN", dsn)
    buffer = _capture_log()
    code = main(["apply", "--target", "shared_v2", "--confirm"])
    captured = capsys.readouterr()
    blob = captured.out + captured.err + buffer.getvalue()
    assert code == 0
    assert SECRET not in blob
    assert "sqlite://***" in captured.out
    assert path.exists()
    code = main(["status", "--target", "ref:STORAGE_SHARED_V2_DSN"])
    captured = capsys.readouterr()
    blob = captured.out + captured.err + buffer.getvalue()
    assert code == 0
    assert SECRET not in blob
    assert "sqlite://***" in captured.out
    assert "uygulandı" in captured.out
    code = main(["apply", "--target", "shared_v2", "--confirm"])
    captured = capsys.readouterr()
    blob = captured.out + captured.err + buffer.getvalue()
    assert code == 0
    assert "değişiklik yok" in captured.out
    assert SECRET not in blob


def test_raw_dsn_argument_is_rejected_without_echo(capsys):
    code = main(["status", "--target", f"mysql://user:{SECRET}@db.internal/app"])
    captured = capsys.readouterr()
    assert code == 2
    assert SECRET not in captured.out + captured.err
    assert "DSN" in captured.err


def test_targets_follow_storage_router_modes(monkeypatch, capsys):
    seen = []
    original = storage_router.normalize_mode

    def wrapped(raw):
        seen.append(raw)
        return original(raw)

    monkeypatch.setattr(storage_router, "normalize_mode", wrapped)
    secret_dsn = f"mysql://user:{SECRET}@db.internal/firm"
    mode = storage_router.MODE_FIELD
    dsn_field = storage_router.DSN_FIELD
    catalog = Catalog([
        {"_id": "bos"},
        {"_id": "eski", mode: " LEGACY ", dsn_field: secret_dsn},
        {"_id": "pay-1", mode: storage_router.SHARED_V2},
        {"_id": "pay-2", mode: "SHARED_V2", dsn_field: secret_dsn},
        {"_id": "ozel", mode: "Dedicated", dsn_field: secret_dsn},
        {"_id": "garip", mode: f"mysql://user:{SECRET}@h/db"},
    ])
    refs = list_targets(catalog)
    text = "\n".join(ref.public() for ref in refs)
    assert seen
    assert "shared_v2" in [ref.name for ref in refs]
    assert sum(1 for ref in refs if ref.name == "shared_v2") == 1
    assert "dedicated:ozel" in text
    assert "blocked:garip" in text
    assert "unknown" in text
    assert "eski" not in text
    assert "bos" not in text
    assert SECRET not in text
    assert "db.internal" not in text
    code = main(["status"], catalog=catalog)
    captured = capsys.readouterr()
    assert code == 0
    assert SECRET not in captured.out + captured.err
    assert "dedicated:ozel" in captured.out
    assert "eski" not in captured.out


def test_legacy_company_is_not_unsealed(monkeypatch, capsys):
    def boom(_sealed):
        raise AssertionError("DSN çözülmemeli")

    monkeypatch.setattr("storage_migrations.targets._unseal", boom)
    catalog = Catalog([
        {
            "_id": "eski",
            storage_router.MODE_FIELD: storage_router.LEGACY,
            storage_router.DSN_FIELD: f"mysql://user:{SECRET}@h/db",
        },
    ])
    code = main(["apply", "--target", "dedicated:eski", "--confirm"], catalog=catalog)
    captured = capsys.readouterr()
    assert code == 2
    assert "Legacy" in captured.err
    assert SECRET not in captured.out + captured.err


def test_dedicated_sealed_dsn_applies_and_stays_masked(tmp_path, monkeypatch, capsys):
    from cryptography.fernet import Fernet

    previous_env = os.environ.get("CREDENTIAL_ENCRYPTION_KEY")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    import comm_service

    previous_fernet = comm_service._fernet
    comm_service.reset_fernet_for_tests()
    try:
        folder = tmp_path / SECRET
        path = folder / "co.db"
        dsn = f"sqlite:///{path}"
        sealed = storage_router.seal_dedicated_dsn(dsn)
        assert SECRET not in sealed
        catalog = Catalog([
            {
                "_id": "co1",
                storage_router.MODE_FIELD: storage_router.DEDICATED,
                storage_router.DSN_FIELD: sealed,
            },
        ])
        buffer = _capture_log()
        code = main(["apply", "--target", "dedicated:co1", "--confirm"], catalog=catalog)
        captured = capsys.readouterr()
        blob = captured.out + captured.err + buffer.getvalue()
        assert code == 0, blob
        assert SECRET not in blob
        assert "sqlite://***" in captured.out
        assert path.exists()
        conn = sqlite3.connect(path)
        names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master")}
        conn.close()
        assert "schema_version" in names
        assert "docs" not in names
    finally:
        if previous_env is None:
            monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
        else:
            monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", previous_env)
        comm_service._fernet = previous_fernet


def test_checksum_change_is_refused():
    session = _memory()
    apply(session, confirm=True, dry_run=False)
    pack = load_migrations()
    mutated = (
        Migration(pack[0].version, pack[0].name, "0" * 64, pack[0].steps),
        pack[1],
    )
    before = _count(session, "storage_meta")
    with pytest.raises(ChecksumError):
        apply(session, mutated, confirm=True, dry_run=False)
    assert _count(session, "storage_meta") == before


def _capture_log():
    import io

    buffer = io.StringIO()
    log = logging.getLogger("storage_migrations")
    handler = logging.StreamHandler(buffer)
    handler.setLevel(logging.DEBUG)
    log.addHandler(handler)
    log.setLevel(logging.DEBUG)
    return buffer
