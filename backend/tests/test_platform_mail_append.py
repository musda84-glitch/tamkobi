"""Gönderen kutusu ekleme: listeye ekler, mevcutları silmez, tekrar 409, varsayılan tek."""
import asyncio

import pytest
from fastapi import HTTPException

import platform_mail


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _match(doc, query):
    for key, cond in (query or {}).items():
        if isinstance(cond, dict) and "$ne" in cond:
            if doc.get(key) == cond["$ne"]:
                return False
            continue
        if isinstance(cond, dict) and "$in" in cond:
            if doc.get(key) not in cond["$in"]:
                return False
            continue
        if doc.get(key) != cond:
            return False
    return True


class _Col:
    def __init__(self, rows=None):
        self.rows = {r["_id"]: dict(r) for r in (rows or [])}
        self.deleted = []

    async def find_one(self, query, projection=None):
        for row in self.rows.values():
            if _match(row, query):
                return dict(row)
        return None

    def find(self, query=None, projection=None):
        rows = [dict(r) for r in self.rows.values() if _match(r, query or {})]
        col = self

        class _Cursor:
            def __init__(self):
                self._rows = rows

            def sort(self, key, direction=1):
                self._rows = sorted(self._rows, key=lambda r: r.get(key) or "", reverse=direction == -1)
                return self

            async def to_list(self, n=None):
                out = self._rows
                if n is not None:
                    out = out[:n]
                return [dict(r) for r in out]

        return _Cursor()

    async def insert_one(self, doc):
        if doc["_id"] in self.rows:
            raise AssertionError(f"insert replaced existing id {doc['_id']}")
        self.rows[doc["_id"]] = dict(doc)

    async def update_one(self, query, upd, upsert=False):
        for row in self.rows.values():
            if _match(row, query):
                row.update(upd.get("$set") or {})
                return
        assert not upsert

    async def update_many(self, query, upd, upsert=False):
        assert upsert is False
        assert set(upd) == {"$set"}
        assert set(upd["$set"]) <= {"is_default", "updated_at"}
        for row in self.rows.values():
            if _match(row, query):
                row.update(upd["$set"])

    async def delete_one(self, query):
        self.deleted.append(query)
        raise AssertionError("mailbox create/update must not delete")

    async def count_documents(self, query):
        return sum(1 for row in self.rows.values() if _match(row, query))


class _DB:
    def __init__(self):
        self.platform_mail_servers = _Col([
            {"_id": "pms_1", "name": "SES", "smtp_host": "smtp.example", "is_active": True},
        ])
        self.platform_mailboxes = _Col([
            {
                "_id": "pmb_old",
                "email": "bildirim@tamkobi.com",
                "display_name": "Bildirim",
                "password_enc": "enc-keep",
                "server_id": "pms_1",
                "is_default": True,
                "is_active": True,
                "purposes": ["transactional"],
                "created_at": "2020-01-01T00:00:00+00:00",
            }
        ])
        self.users = _Col([])


@pytest.fixture
def db():
    prev = platform_mail._db
    database = _DB()
    platform_mail.init(database)
    yield database
    platform_mail._db = prev


def test_second_mailbox_appends_and_keeps_existing(db):
    admin = {"email": "admin@nexus.com", "id": "u1"}
    created = _run(platform_mail.create_mailbox({
        "email": "destek@tamkobi.com",
        "display_name": "Destek",
        "server_id": "pms_1",
        "purposes": ["support"],
        "is_default": True,
        "_id": "pmb_old",
        "id": "pmb_old",
    }, admin))
    assert created["id"] != "pmb_old"
    assert created["email"] == "destek@tamkobi.com"
    assert created["is_default"] is True
    assert "pmb_old" in db.platform_mailboxes.rows
    old = db.platform_mailboxes.rows["pmb_old"]
    assert old["email"] == "bildirim@tamkobi.com"
    assert old["display_name"] == "Bildirim"
    assert old["password_enc"] == "enc-keep"
    assert old["is_default"] is False
    assert len(db.platform_mailboxes.rows) == 2
    defaults = [r for r in db.platform_mailboxes.rows.values() if r.get("is_default")]
    assert len(defaults) == 1 and defaults[0]["_id"] == created["id"]
    assert db.platform_mailboxes.deleted == []


def test_duplicate_email_is_409_and_does_not_replace(db):
    admin = {"email": "admin@nexus.com", "id": "u1"}
    with pytest.raises(HTTPException) as ei:
        _run(platform_mail.create_mailbox({
            "email": "Bildirim@Tamkobi.com",
            "server_id": "pms_1",
            "is_default": True,
        }, admin))
    assert ei.value.status_code == 409
    assert len(db.platform_mailboxes.rows) == 1
    old = db.platform_mailboxes.rows["pmb_old"]
    assert old["email"] == "bildirim@tamkobi.com"
    assert old["is_default"] is True
    assert old["password_enc"] == "enc-keep"


def test_missing_server_does_not_touch_mailboxes(db):
    admin = {"email": "admin@nexus.com", "id": "u1"}
    with pytest.raises(HTTPException) as ei:
        _run(platform_mail.create_mailbox({
            "email": "fatura@tamkobi.com",
            "server_id": "pms_deleted",
            "is_default": True,
        }, admin))
    assert ei.value.status_code == 404
    assert "sunucu" in str(ei.value.detail).lower()
    assert list(db.platform_mailboxes.rows) == ["pmb_old"]
    assert db.platform_mailboxes.rows["pmb_old"]["is_default"] is True
    assert db.platform_mailboxes.rows["pmb_old"]["email"] == "bildirim@tamkobi.com"


def test_non_default_add_keeps_previous_default_and_row(db):
    admin = {"email": "admin@nexus.com", "id": "u1"}
    created = _run(platform_mail.create_mailbox({
        "email": "info@tamkobi.com",
        "server_id": "pms_1",
        "is_default": False,
    }, admin))
    assert created["is_default"] is False
    assert db.platform_mailboxes.rows["pmb_old"]["is_default"] is True
    assert db.platform_mailboxes.rows["pmb_old"]["email"] == "bildirim@tamkobi.com"
    assert len(db.platform_mailboxes.rows) == 2


def test_make_default_clears_flag_without_deleting(db):
    _run(platform_mail.create_mailbox({
        "email": "destek@tamkobi.com",
        "server_id": "pms_1",
        "is_default": False,
    }, {"email": "admin@nexus.com"}))
    new_id = next(i for i in db.platform_mailboxes.rows if i != "pmb_old")
    updated = _run(platform_mail.update_mailbox(new_id, {"is_default": True}, {}))
    assert updated["is_default"] is True
    assert "pmb_old" in db.platform_mailboxes.rows
    assert db.platform_mailboxes.rows["pmb_old"]["email"] == "bildirim@tamkobi.com"
    assert db.platform_mailboxes.rows["pmb_old"]["is_default"] is False
    assert db.platform_mailboxes.rows["pmb_old"]["password_enc"] == "enc-keep"
