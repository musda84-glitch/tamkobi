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
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from storage_migrations.cli import main  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.errors import ChecksumError, LegacyTargetError, MigrationError  # noqa: E402
from storage_migrations.loader import Migration, load_migrations, steps_for  # noqa: E402
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


def _by_version(pack=None):
    items = pack if pack is not None else load_migrations()
    return {item.version: item for item in items}


def _view(rows, version):
    return next(row for row in rows if row.version == version)


def test_pack_versions_are_addressed_by_number():
    pack = load_migrations()
    by_version = _by_version(pack)
    assert list(by_version) == sorted(by_version)
    assert min(by_version) == 1
    assert by_version[1].name == "storage_meta"
    assert by_version[2].name == "marker_steps"
    assert by_version[3].name == "docs_v2"
    assert by_version[4].name == "storage_records"
    assert len(by_version[1].steps) == 2
    assert len(by_version[2].steps) == 2
    assert by_version[3].mysql_steps
    assert by_version[1].mysql_steps == ()
    records = by_version[4].steps
    table = next(step for step in records if step.lower().startswith("create table"))
    unique = next(step for step in records if step.lower().startswith("create unique index"))
    index = next(step for step in records if step.lower().startswith("create index "))
    lowered = "\n".join(step.lower() for step in records)
    assert "docs" not in lowered
    assert "longtext" in table.lower()
    assert "json_unquote(json_extract(" in table.lower()
    assert "varchar(128)" in table.lower()
    assert "varchar(191)" in table.lower()
    assert "varchar(64)" in table.lower()
    assert unique.lower().startswith("create unique index")
    assert index.lower().startswith("create index")


def test_empty_target_then_second_apply_writes_nothing():
    session = _memory()
    first = apply(session, confirm=True, dry_run=False)
    assert first.wrote is True
    assert first.advanced == len(load_migrations())
    assert [row.state for row in first.rows] == ["uygulandı"] * len(first.rows)
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
    applied_before = session.fetchall(
        "SELECT version FROM schema_version WHERE state = ?",
        ("applied",),
    )
    done = apply(session, confirm=True, dry_run=False)
    assert done.advanced == len(load_migrations()) - len(applied_before)
    assert [row.state for row in done.rows] == ["uygulandı"] * len(done.rows)
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
    docs = _by_version()[3]
    last = len(steps_for(docs, session.dialect))
    name = "idx_v2_unique_doc"
    found = session.fetchall(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
        (name,),
    )
    assert found
    session.execute(
        "UPDATE schema_version SET state = ?, step_no = ? WHERE version = ?",
        ("applying", last - 1, docs.version),
    )
    session.commit()
    session.calls.clear()
    done = apply(session, confirm=True, dry_run=False)
    row = _view(done.rows, docs.version)
    assert row.state == "uygulandı"
    assert row.step == last
    created = [sql for sql in session.calls if sql.lstrip().upper().startswith("CREATE")]
    assert created == []
    found = session.fetchall(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
        (name,),
    )
    assert len(found) == 1


def test_create_index_rerun_skips_existing_index():
    session = _memory()
    first = apply(session, confirm=True, dry_run=False)
    assert first.advanced == len(load_migrations())
    indexes = {
        row[0]
        for row in session.fetchall("SELECT name FROM sqlite_master WHERE type = 'index'")
    }
    assert "idx_storage_records_company" in indexes
    assert "uq_storage_records_doc" in indexes
    records = _by_version()[4]
    total = len(steps_for(records, session.dialect))
    session.execute(
        "UPDATE schema_version SET state = ?, step_no = ?, applied_at = ? WHERE version = ?",
        ("applying", 1, "", records.version),
    )
    session.commit()
    applied = session.fetchall(
        "SELECT version FROM schema_version WHERE state = ?",
        ("applied",),
    )
    resumed = apply(session, confirm=True, dry_run=False)
    assert resumed.advanced == len(load_migrations()) - len(applied)
    row = session.fetchall(
        "SELECT state, step_no FROM schema_version WHERE version = ?",
        (records.version,),
    )[0]
    assert row[0] == "applied"
    assert int(row[1]) == total
    count = session.fetchall(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
        ("idx_storage_records_company",),
    )[0][0]
    assert count == 1
    session.execute(
        "INSERT INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)",
        ("products", "p1", '{"company_id":"co_a","name":"kalem"}'),
    )
    company = session.fetchall(
        "SELECT company_id FROM storage_records WHERE doc_id = ?",
        ("p1",),
    )[0][0]
    assert company == "co_a"
    with pytest.raises(sqlite3.IntegrityError):
        session.execute(
            "INSERT INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)",
            ("products", "p1", '{"company_id":"co_b","name":"ikinci"}'),
        )


def test_0003_and_0004_do_not_depend_on_each_other():
    """0003 docs_v2 ve 0004 storage_records birbirinin tablosuna bakmaz.

    Biri olmadan diğeri uygulanır. Sıra fark etmez; eksik olan sonra gelir.
    """
    pack = load_migrations()
    by_version = _by_version(pack)
    earlier = tuple(item for item in pack if item.version < 3)
    v3 = by_version[3]
    v4 = by_version[4]
    text3 = "\n".join(v3.steps + v3.mysql_steps).lower()
    text4 = "\n".join(steps_for(v4, "sqlite") + steps_for(v4, "mysql")).lower()
    assert "storage_records" not in text3
    assert "docs_v2" not in text4

    only_v3 = _memory()
    apply(only_v3, earlier + (v3,), confirm=True, dry_run=False)
    assert "docs_v2" in only_v3.tables()
    assert "storage_records" not in only_v3.tables()
    added_v4 = apply(only_v3, confirm=True, dry_run=False)
    assert added_v4.advanced == len(pack) - (len(earlier) + 1)
    assert _view(added_v4.rows, 4).state == "uygulandı"
    assert "storage_records" in only_v3.tables()

    only_v4 = _memory()
    apply(only_v4, earlier + (v4,), confirm=True, dry_run=False)
    assert "storage_records" in only_v4.tables()
    assert "docs_v2" not in only_v4.tables()
    added_v3 = apply(only_v4, confirm=True, dry_run=False)
    assert added_v3.advanced == len(pack) - (len(earlier) + 1)
    assert _view(added_v3.rows, 3).state == "uygulandı"
    assert "docs_v2" in only_v4.tables()


def test_later_0003_applies_after_0004():
    session = _memory()
    pack = load_migrations()
    early = tuple(item for item in pack if item.version != 3)
    first = apply(session, early, confirm=True, dry_run=False)
    assert first.advanced == len(early)
    assert 3 not in {row.version for row in first.rows}
    assert _view(first.rows, 4).state == "uygulandı"
    present = {int(row[0]) for row in session.fetchall("SELECT version FROM schema_version")}
    assert 4 in present
    assert 3 not in present
    second = apply(session, confirm=True, dry_run=False)
    assert second.advanced == len(pack) - len(early)
    assert {row.version for row in second.rows} == {item.version for item in pack}
    assert [row.state for row in second.rows] == ["uygulandı"] * len(second.rows)
    arrived = _view(second.rows, 3)
    assert arrived.name == "docs_v2"
    assert arrived.step == arrived.total
    assert _view(second.rows, 4).state == "uygulandı"
    names = session.tables()
    assert "docs_v2" in names
    assert "storage_records" in names
    stored = session.fetchall(
        "SELECT version, name, state FROM schema_version ORDER BY version"
    )
    assert [(int(row[0]), str(row[1]), str(row[2])) for row in stored] == [
        (item.version, item.name, "applied") for item in pack
    ]
    third = apply(session, confirm=True, dry_run=False)
    assert third.advanced == 0


def test_mariadb_migration_applies_twice():
    dsn = os.environ.get("STORAGE_MARIADB_DSN", "").strip()
    if not dsn:
        pytest.skip("STORAGE_MARIADB_DSN yok")
    from mariadb_fixture import isolated_dsn
    dsn = isolated_dsn(dsn)
    session = connect(dsn, write=True)
    try:
        session.execute(
            "SET SESSION sql_mode = "
            "'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
        )
        _drop_storage(session)
        pack = load_migrations()
        first = apply(session, confirm=True, dry_run=False)
        assert first.advanced == len(pack)
        assert {row.version for row in first.rows} == {item.version for item in pack}
        assert [row.state for row in first.rows] == ["uygulandı"] * len(first.rows)
        second = apply(session, confirm=True, dry_run=False)
        assert second.advanced == 0
        _assert_mariadb_schema(session)
        records = _by_version(pack)[4]
        total = len(steps_for(records, session.dialect))
        session.execute(
            "UPDATE schema_version SET state = ?, step_no = ?, applied_at = ? WHERE version = ?",
            ("applying", 1, "", records.version),
        )
        session.commit()
        applied = session.fetchall(
            "SELECT version FROM schema_version WHERE state = ?",
            ("applied",),
        )
        resumed = apply(session, confirm=True, dry_run=False)
        assert resumed.advanced == len(pack) - len(applied)
        done = session.fetchall(
            "SELECT state, step_no FROM schema_version WHERE version = ?",
            (records.version,),
        )[0]
        assert done[0] == "applied"
        assert int(done[1]) == total
        session.execute(
            "INSERT INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)",
            ("products", "p1", '{"company_id":"co_a","name":"kalem"}'),
        )
        session.commit()
        company = session.fetchall(
            "SELECT company_id FROM storage_records WHERE doc_id = ?",
            ("p1",),
        )[0][0]
        assert company == "co_a"
        with pytest.raises(Exception) as caught:
            session.execute(
                "INSERT INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)",
                ("products", "p1", '{"company_id":"co_b","name":"ikinci"}'),
            )
        assert "integrity" in type(caught.value).__name__.lower() or "duplicate" in str(caught.value).lower()
        session.rollback()
        _drop_storage(session)
        # 0006 mevcut docs_v2 tablosunu çevirir; docs_v2 yokken çalışmaz.
        early = tuple(
            item for item in pack
            if item.version != 3 and "docs_v2" not in "\n".join(item.mysql_steps).lower()
        )
        primed = apply(session, early, confirm=True, dry_run=False)
        assert primed.advanced == len(early)
        assert 3 not in {int(row[0]) for row in session.fetchall("SELECT version FROM schema_version")}
        arrived = apply(session, confirm=True, dry_run=False)
        assert arrived.advanced == len(pack) - len(early)
        stored = session.fetchall(
            "SELECT version, name, state FROM schema_version ORDER BY version"
        )
        assert [(int(row[0]), str(row[1]), str(row[2])) for row in stored] == [
            (item.version, item.name, "applied") for item in pack
        ]
        again = apply(session, confirm=True, dry_run=False)
        assert again.advanced == 0
        _assert_mariadb_schema(session)
    finally:
        try:
            session.rollback()
            _drop_storage(session)
        finally:
            session.close()


def _assert_mariadb_schema(session):
    columns = {
        str(row[0]).lower(): row
        for row in session.fetchall(
            "SELECT column_name, data_type, generation_expression "
            "FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 'storage_records'"
        )
    }
    assert columns["collection"][1].lower() == "varchar"
    assert columns["doc_id"][1].lower() == "varchar"
    assert columns["company_id"][1].lower() == "varchar"
    assert columns["doc"][1].lower() == "longtext"
    generated = str(columns["company_id"][2]).lower()
    assert "json_unquote" in generated
    assert "json_extract" in generated
    stats = session.fetchall(
        "SELECT index_name, non_unique, column_name "
        "FROM information_schema.statistics "
        "WHERE table_schema = DATABASE() AND table_name = 'storage_records'"
    )
    unique = [row for row in stats if str(row[0]).lower() == "uq_storage_records_doc"]
    assert unique
    assert all(int(row[1]) == 0 for row in unique)
    assert {str(row[2]).lower() for row in unique} == {"collection", "doc_id"}
    indexed = session.fetchall(
        "SELECT c.data_type FROM information_schema.statistics s "
        "JOIN information_schema.columns c "
        "ON c.table_schema = s.table_schema AND c.table_name = s.table_name "
        "AND c.column_name = s.column_name "
        "WHERE s.table_schema = DATABASE() AND s.table_name = 'storage_records'"
    )
    for (kind,) in indexed:
        assert str(kind).lower() == "varchar"
    doc_type = session.fetchall(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = 'docs_v2' AND column_name = 'doc'"
    )[0][0]
    assert str(doc_type).lower() in ("json", "longtext")
    status = session.fetchall(
        "SELECT column_type FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = 'docs_v2' AND column_name = 'g_status'"
    )
    assert status and "varchar" in str(status[0][0]).lower()


def _drop_storage(session):
    for table in (
        "t_row_unique",
        "t_orders",
        "t_invoices",
        "t_stock_moves",
        "t_bank_transactions",
        "docs_v2_unique",
        "docs_v2",
        "storage_records",
        "storage_marker",
        "storage_meta",
        "schema_version",
    ):
        session.execute(f"DROP TABLE IF EXISTS {table}")
    session.commit()


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


def test_plaintext_dedicated_dsn_is_rejected(monkeypatch, capsys):
    def boom(*_args, **_kwargs):
        raise AssertionError("bağlantı açılmamalı")

    monkeypatch.setattr("storage_migrations.session._connect_sqlite", boom)
    monkeypatch.setattr("storage_migrations.session._connect_mysql", boom)
    catalog = Catalog([
        {
            "_id": "co1",
            storage_router.MODE_FIELD: storage_router.DEDICATED,
            storage_router.DSN_FIELD: f"mysql://user:{SECRET}@db.internal/firm",
        },
    ])
    code = main(["apply", "--target", "dedicated:co1", "--confirm"], catalog=catalog)
    captured = capsys.readouterr()
    assert code == 2
    assert SECRET not in captured.out + captured.err
    assert "db.internal" not in captured.out + captured.err


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


def test_loopback_hosts_share_live_identity(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("bağlantı açılmamalı")

    monkeypatch.setattr("storage_migrations.session._connect_mysql", boom)

    def host(name):
        if name == "::1":
            return "[::1]"
        return name

    pairs = (
        ("localhost", "127.0.0.1"),
        ("127.0.0.1", "::1"),
        ("::1", "localhost"),
        ("localhost", "localhost"),
    )
    for live_host, target_host in pairs:
        monkeypatch.setenv("MYSQL_URL", f"mysql://app:{SECRET}@{host(live_host)}:3306/tamkobi")
        with pytest.raises(LegacyTargetError, match="Canlı") as caught:
            connect(f"mysql://other:{SECRET}@{host(target_host)}:3306/tamkobi", write=False)
        assert SECRET not in str(caught.value)
        assert "127.0.0.1" not in str(caught.value)
        assert "localhost" not in str(caught.value)

    monkeypatch.delenv("MYSQL_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("MYSQL_HOST", "::1")
    monkeypatch.setenv("MYSQL_PORT", "3306")
    monkeypatch.setenv("MYSQL_DATABASE", "tamkobi")
    with pytest.raises(LegacyTargetError, match="Canlı"):
        connect(f"mysql://other:{SECRET}@127.0.0.1:3306/tamkobi", write=False)

    monkeypatch.setenv("MYSQL_URL", f"mysql://app:{SECRET}@localhost:3306/tamkobi")
    with pytest.raises(AssertionError):
        connect(f"mysql://other:{SECRET}@127.0.0.1:3307/tamkobi", write=False)
    with pytest.raises(AssertionError):
        connect(f"mysql://other:{SECRET}@127.0.0.1:3306/otherdb", write=False)


def test_cli_catalog_rejects_mysql_and_missing_file(tmp_path, monkeypatch):
    from storage_migrations.catalog import load_cli_catalog
    from storage_migrations.errors import CatalogError

    def boom(*_args, **_kwargs):
        raise AssertionError("bağlantı açılmamalı")

    monkeypatch.setattr("storage_migrations.session._connect_mysql", boom)
    monkeypatch.setenv("STORAGE_COMPANY_CATALOG", f"mysql://app:{SECRET}@10.9.9.9:3306/tamkobi")
    with pytest.raises(CatalogError, match="canlı") as caught:
        load_cli_catalog()
    assert SECRET not in str(caught.value)
    missing = tmp_path / "yok.db"
    monkeypatch.setenv("STORAGE_COMPANY_CATALOG", f"sqlite:///{missing}")
    with pytest.raises(CatalogError, match="yok"):
        load_cli_catalog()
    assert not missing.exists()


def test_module_resolves_dedicated_company_only(tmp_path, monkeypatch):
    import subprocess

    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()
    previous_env = os.environ.get("CREDENTIAL_ENCRYPTION_KEY")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", key)
    import comm_service

    previous_fernet = comm_service._fernet
    comm_service.reset_fernet_for_tests()
    try:
        folder = tmp_path / SECRET
        folder.mkdir()
        dedicated = folder / "co.db"
        dsn = f"sqlite:///{dedicated}"
        sealed = storage_router.seal_dedicated_dsn(dsn)
        assert SECRET not in sealed
        catalog_path = tmp_path / "catalog.db"
        conn = sqlite3.connect(catalog_path)
        conn.execute(
            "CREATE TABLE company_catalog (company_id TEXT, storage_mode TEXT, dedicated_dsn_ref TEXT)"
        )
        conn.execute(
            "INSERT INTO company_catalog (company_id, storage_mode, dedicated_dsn_ref) VALUES (?, ?, ?)",
            ("co1", "dedicated", sealed),
        )
        conn.execute(
            "INSERT INTO company_catalog (company_id, storage_mode, dedicated_dsn_ref) VALUES (?, ?, ?)",
            ("eski", "legacy", sealed),
        )
        conn.commit()
        conn.close()
        env = os.environ.copy()
        env["CREDENTIAL_ENCRYPTION_KEY"] = key
        env["STORAGE_COMPANY_CATALOG"] = f"sqlite:///{catalog_path}"
        env["DATA_DIR"] = str(tmp_path)
        env.pop("MYSQL_URL", None)
        env.pop("DATABASE_URL", None)
        env.pop("MYSQL_HOST", None)
        legacy = subprocess.run(
            [sys.executable, "-m", "storage_migrations", "apply", "--target", "dedicated:eski", "--confirm"],
            cwd=str(_BACKEND),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        blob = legacy.stdout + legacy.stderr
        assert legacy.returncode == 2
        assert "Legacy" in blob
        assert SECRET not in blob
        assert not dedicated.exists()
        listed = subprocess.run(
            [sys.executable, "-m", "storage_migrations", "status"],
            cwd=str(_BACKEND),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        assert listed.returncode == 0
        assert "dedicated:co1" in listed.stdout
        assert "eski" not in listed.stdout
        assert SECRET not in listed.stdout + listed.stderr
        applied = subprocess.run(
            [sys.executable, "-m", "storage_migrations", "apply", "--target", "dedicated:co1", "--confirm"],
            cwd=str(_BACKEND),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        blob = applied.stdout + applied.stderr
        assert applied.returncode == 0, blob
        assert SECRET not in blob
        assert "sqlite://***" in applied.stdout
        assert dedicated.exists()
        conn = sqlite3.connect(dedicated)
        names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master")}
        conn.close()
        assert "storage_records" in names
        assert "docs" not in names
    finally:
        if previous_env is None:
            monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
        else:
            monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", previous_env)
        comm_service._fernet = previous_fernet


def _capture_log():
    import io

    buffer = io.StringIO()
    log = logging.getLogger("storage_migrations")
    handler = logging.StreamHandler(buffer)
    handler.setLevel(logging.DEBUG)
    log.addHandler(handler)
    log.setLevel(logging.DEBUG)
    return buffer
