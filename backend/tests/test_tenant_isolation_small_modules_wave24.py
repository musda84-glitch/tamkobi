"""Küçük modül kiracı dalgası 24.

Bellek içi MemDB. Canlı veritabanına, MySQL'e, 8021 portuna ve ağa bağlanmaz.
Tutar, telefon, token ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import event_notify  # noqa: E402
import idempotency  # noqa: E402
import migration  # noqa: E402
import notify  # noqa: E402
import partner_pay  # noqa: E402
import phone_norm  # noqa: E402
import saas  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
import vpos.api as vpos_api  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import DuplicateKeyError as MysqlDuplicateKeyError  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
SHARED = "shared-id"
FAR = "2099-01-01T00:00:00+00:00"
OLD = "2020-01-01T00:00:00+00:00"
TOK_A = "ExponentPushToken[aaaa]"
TOK_B = "ExponentPushToken[bbbb]"
PHONE_B = "0532 111 22 33"
PHONE_A = "0533 222 33 44"

_SCOPE_FILES = (
    "event_notify.py",
    "idempotency.py",
    "notify.py",
    "trash.py",
    "partner_pay.py",
    "phone_norm.py",
    "vpos/api.py",
    "migration.py",
    "saas.py",
)

_REMOVED = (
    ("event_notify.py", "_dedupe_seen", "notify_event_dedupe", "find_one"),
    ("event_notify.py", "_defer_rows", "notify_outbox", "update_one"),
    ("event_notify.py", "_enqueue_order_outbox", "notify_outbox", "find_one"),
    ("event_notify.py", "_load_claimed", "notify_outbox", "find"),
    ("event_notify.py", "_release_stale_sending", "notify_outbox", "find"),
    ("event_notify.py", "_release_stale_sending", "notify_outbox", "update_one"),
    ("event_notify.py", "_retry_rows", "notify_outbox", "update_one"),
    ("event_notify.py", "_sms_sent_today", "notify_sms_daily", "find_one"),
    ("event_notify.py", "_update_claimed", "notify_outbox", "update_one"),
    ("event_notify.py", "enqueue_morning_summary_email", "notify_outbox", "find_one"),
    ("event_notify.py", "flush_notify_outbox", "notify_outbox", "find"),
    ("event_notify.py", "get_tenant_prefs", "company_notify_tenant", "find_one"),
    ("idempotency.py", "_reclaim_stale_in_progress", "idempotency_keys", "update_one"),
    ("idempotency.py", "_try_insert", "idempotency_keys", "insert_one"),
    ("idempotency.py", "abandon", "idempotency_keys", "delete_one"),
    ("idempotency.py", "begin", "idempotency_keys", "delete_one"),
    ("idempotency.py", "begin", "idempotency_keys", "find_one"),
    ("idempotency.py", "clear_payment_applied", "idempotency_keys", "update_one"),
    ("idempotency.py", "complete", "idempotency_keys", "update_one"),
    ("idempotency.py", "mark_payment_applied", "idempotency_keys", "update_one"),
    ("idempotency.py", "purge_expired", "idempotency_keys", "delete_one"),
    ("idempotency.py", "purge_expired", "idempotency_keys", "find"),
    ("migration.py", "_invoice_doc", "contacts", "insert_one"),
    ("migration.py", "bh_import", "products", "insert_one"),
    ("migration.py", "bh_import", "products", "update_one"),
    ("migration.py", "bh_import_customers", "contacts", "insert_one"),
    ("migration.py", "bh_import_customers", "contacts", "update_one"),
    ("migration.py", "migration_import", "migration_uploads", "delete_one"),
    ("migration.py", "migration_rollback", "contacts", "delete_many"),
    ("migration.py", "migration_rollback", "migration_batches", "update_one"),
    ("notify.py", "check_push_receipts", "push_tokens", "delete_many"),
    ("notify.py", "drop_invalid_push_tokens", "push_tokens", "delete_many"),
    ("notify.py", "insert_notification", "notifications", "insert_one"),
    ("notify.py", "remove_push_token", "push_tokens", "delete_many"),
    ("notify.py", "tokens_for_company", "push_tokens", "find"),
    ("notify.py", "tokens_for_users", "push_tokens", "find"),
    ("notify.py", "upsert_push_token", "push_tokens", "find_one"),
    ("partner_pay.py", "_partner_company_id", "partners", "find_one"),
    ("partner_pay.py", "accrue_due_for_all_companies", "partners", "find"),
    ("partner_pay.py", "repair_legacy_expense_withdrawals", "partner_transactions", "find"),
    ("partner_pay.py", "repair_legacy_expense_withdrawals", "partner_transactions", "update_one"),
    ("partner_pay.py", "reverse_one", "partner_transactions", "find_one"),
    ("partner_pay.py", "sync_partner_from_ledger", "partners", "find_one"),
    ("phone_norm.py", "backfill_phone_norm", "employees", "find"),
    ("phone_norm.py", "backfill_phone_norm", "employees", "update_one"),
    ("phone_norm.py", "find_user_by_phone", "employees", "find"),
    ("phone_norm.py", "find_user_by_phone", "employees", "find_one"),
    ("phone_norm.py", "find_user_by_phone", "employees", "update_one"),
    ("saas.py", "_usage", "files", "find"),
    ("saas.py", "apply_upgrade_resolution", "upgrade_requests", "find_one"),
    ("saas.py", "apply_upgrade_resolution", "upgrade_requests", "update_one"),
    ("saas.py", "overview_stats", "upgrade_requests", "count_documents"),
    ("saas.py", "quota_usage", "files", "find"),
    ("saas.py", "seed", "products", "find"),
    ("saas.py", "seed", "products", "update_one"),
    ("saas.py", "upgrade_request_rows", "upgrade_requests", "find"),
    ("trash.py", "_clear_sync_tombstones", "sync_tombstones", "delete_many"),
    ("trash.py", "get_trash_item", "trash", "find_one"),
    ("trash.py", "purge_expired", "trash", "delete_many"),
    ("trash.py", "purge_trash_item", "trash", "delete_one"),
    ("trash.py", "purge_trash_item", "trash", "find_one"),
    ("trash.py", "restore_trash_item", "trash", "delete_many"),
    ("trash.py", "restore_trash_item", "trash", "find_one"),
    ("vpos/api.py", "_allocate_order_id", "payment_intents", "find_one"),
    ("vpos/api.py", "iyzico_callback", "payment_intents", "find_one"),
    ("vpos/api.py", "paytr_notify", "payment_intents", "find_one"),
    ("vpos/api.py", "paytr_notify", "vpos_configs", "find_one"),
    ("vpos/api.py", "vpos_callback", "payment_intents", "find_one"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
        "password_hash": "hash-" + company_id,
    }


class _Coll(MemColl):
    def __init__(self, name, db):
        super().__init__(name, db)
        self.fail_insert = False

    async def create_index(self, *args, **kwargs):
        return "idx"

    async def insert_one(self, doc):
        if self.name == "idempotency_keys":
            for row in self.docs:
                if row.get("_id") == doc.get("_id") and row.get("company_id") == doc.get("company_id"):
                    raise MysqlDuplicateKeyError("duplicate")
        if self.fail_insert:
            raise RuntimeError("duplicate")
        return await super().insert_one(doc)

    async def delete_one(self, query=None):
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query=None):
        query = _split_field_ops(query or {})
        kept = []
        deleted = 0
        for doc in self.docs:
            if match_query(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


class _Req:
    def __init__(self, form=None, ip="203.0.113.50", path="/api/vpos/callback/shared-id"):
        self._form = form or {}
        self.client = SimpleNamespace(host=ip)
        self.headers = {}
        self.method = "POST"
        self.url = SimpleNamespace(path=path)
        self.query_params = {}

    async def form(self):
        return self._form


class _HttpResp:
    def __init__(self, payload):
        self._payload = payload
        self.content = b"{}"

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _HttpClient:
    payload = {"data": {}}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, *args, **kwargs):
        return _HttpResp(self.payload)


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


def _digest(db, company_id):
    payload = []
    for name in sorted(db._cols):
        rows = [copy.deepcopy(d) for d in db._cols[name].docs if d.get("company_id") == company_id]
        if not rows:
            continue
        rows.sort(key=lambda d: json.dumps(d, sort_keys=True, default=str))
        payload.append([name, rows])
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def _bind(db, user):
    prev = {
        "event": event_notify._db,
        "trash_db": trash._db,
        "trash_user": trash._current_user,
        "migration_db": migration._db,
        "migration_user": migration._current_user,
        "vpos": vpos_api._db,
        "saas_db": saas._db,
        "saas_user": saas._current_user,
        "addons": addons._db,
    }

    async def _current(request=None):
        return user

    event_notify._db = db
    trash.init(db, _current)
    migration.init(db, _current)
    vpos_api.init(db)
    saas.init(db, _current)
    addons.init(db)
    return prev


def _restore(prev):
    event_notify._db = prev["event"]
    trash._db = prev["trash_db"]
    trash._current_user = prev["trash_user"]
    migration._db = prev["migration_db"]
    migration._current_user = prev["migration_user"]
    vpos_api._db = prev["vpos"]
    saas._db = prev["saas_db"]
    saas._current_user = prev["saas_user"]
    addons._db = prev["addons"]
    saas.invalidate()
    idempotency._reset_indexed_for_tests()


def test_event_notify_company_scope():
    db = _DB()
    user = _user(CO_A)
    prev = _bind(db, user)
    try:
        day = event_notify._today()
        _add(db, "company_notify_tenant", {
            "_id": f"cnt_{CO_A}", "company_id": CO_B, "updated_by": "gizli",
            "events": {"order_new": {"inapp": False, "email": False}},
        })
        _add(db, "company_notify_tenant", {
            "_id": f"cnt_{CO_A}", "company_id": CO_A, "updated_by": "ali",
            "events": {
                "order_new": {"inapp": True, "email": False},
                "morning_summary": {"inapp": True, "email": True},
            },
        })
        _add(db, "company_notify_prefs", {
            "_id": f"cnp_{CO_A}", "company_id": CO_A,
            "events": {"morning_summary": {"inapp": True, "email": True, "sms": False, "digest": "instant"}},
        })
        _add(db, "notify_event_dedupe", {
            "_id": f"{CO_A}:siparis", "company_id": CO_B, "dedupe_key": "gizli",
        })
        _add(db, "notify_sms_daily", {
            "_id": f"{CO_A}:{day}", "company_id": CO_B, "count": 99,
        })
        _add(db, "notify_sms_daily", {
            "_id": f"{CO_A}:{day}", "company_id": CO_A, "count": 2,
        })
        claim = "claim-a"
        _add(db, "notify_outbox", {
            "_id": SHARED, "company_id": CO_B, "claim_id": claim, "status": "sending",
            "attempts": 0, "title": "gizli-kuyruk", "event": "morning_summary",
            "claimed_at": datetime.now(timezone.utc).isoformat(),
            "next_try_at": FAR, "due_at": FAR,
        })
        _add(db, "notify_outbox", {
            "_id": SHARED, "company_id": CO_A, "claim_id": claim, "status": "sending",
            "attempts": 0, "event": "morning_summary", "claimed_at": OLD,
            "next_try_at": FAR, "due_at": FAR,
        })
        _add(db, "notify_outbox", {
            "_id": f"out:{CO_A}:order:ord-1", "company_id": CO_B, "title": "gizli-siparis",
        })
        _add(db, "notify_outbox", {
            "_id": f"out:{CO_A}:morning_summary:2026-10-21:s", "company_id": CO_B,
            "subject": "gizli-ozet",
        })
        _add(db, "notify_outbox", {
            "_id": "upd-a", "company_id": CO_A, "claim_id": claim, "status": "sending", "attempts": 0,
        })
        _add(db, "notify_outbox", {
            "_id": "upd-a", "company_id": CO_B, "claim_id": claim, "status": "sending",
            "title": "gizli-guncelle", "claimed_at": datetime.now(timezone.utc).isoformat(), "next_try_at": FAR,
        })
        _add(db, "notify_outbox", {
            "_id": "defer-a", "company_id": CO_A, "claim_id": "defer-claim", "status": "sending", "attempts": 0,
            "claimed_at": datetime.now(timezone.utc).isoformat(),
        })
        _add(db, "notify_outbox", {
            "_id": "defer-a", "company_id": CO_B, "claim_id": "defer-claim", "status": "sending",
            "title": "gizli-ertele", "claimed_at": datetime.now(timezone.utc).isoformat(), "next_try_at": FAR,
        })
        _add(db, "notify_outbox", {
            "_id": "retry-a", "company_id": CO_A, "claim_id": "retry-claim", "status": "sending", "attempts": 0,
            "claimed_at": datetime.now(timezone.utc).isoformat(),
        })
        _add(db, "notify_outbox", {
            "_id": "retry-a", "company_id": CO_B, "claim_id": "retry-claim", "status": "sending",
            "title": "gizli-retry", "claimed_at": datetime.now(timezone.utc).isoformat(), "next_try_at": FAR,
        })
        before = _digest(db, CO_B)

        prefs = _run(event_notify.get_tenant_prefs(CO_A))
        assert prefs["updated_by"] == "ali"
        assert prefs["events"]["order_new"]["email"] is False
        assert _run(event_notify._dedupe_seen(CO_A, "siparis")) is False
        assert _run(event_notify._dedupe_seen(CO_A, "siparis")) is True
        assert _run(event_notify._sms_sent_today(CO_A)) == 2

        db.notify_outbox.fail_insert = True
        assert _run(event_notify._enqueue_order_outbox(
            CO_A, "ord-1", channels={"email": True}, digest="batch",
        )) is False
        queued = _run(event_notify.enqueue_morning_summary_email(
            CO_A, emails=["a@example.com"], subject="Ozet", html="<p>a</p>", text="a", day="2026-10-21",
        ))
        assert queued == "failed"
        db.notify_outbox.fail_insert = False
        assert _run(event_notify._enqueue_order_outbox(
            CO_A, "ord-1", channels={"email": True}, digest="batch",
        )) is True
        assert _run(event_notify.enqueue_morning_summary_email(
            CO_A, emails=["a@example.com"], subject="Ozet", html="<p>a</p>", text="a", day="2026-10-22",
        )) == "queued"

        loaded = _run(event_notify._load_claimed(claim, CO_A))
        assert sorted(row["_id"] for row in loaded) == [SHARED, "upd-a"]
        assert [row["company_id"] for row in loaded] == [CO_A, CO_A]
        _run(event_notify._update_claimed(
            [row for row in loaded if row["_id"] == "upd-a"], claim, {"status": "sent"},
        ))
        _run(event_notify._defer_rows(
            [_row(db, "notify_outbox", CO_A, "defer-a")], "defer-claim", FAR,
        ))
        _run(event_notify._retry_rows([_row(db, "notify_outbox", CO_A, "retry-a")], "retry-claim"))
        for doc in db.notify_outbox.docs:
            if doc.get("company_id") == CO_A and doc.get("status") in ("pending", "deferred"):
                doc["next_try_at"] = FAR
        flushed = _run(event_notify.flush_notify_outbox())
        assert flushed["flushed"] == 0

        assert _row(db, "notify_outbox", CO_A, SHARED)["status"] == "pending"
        assert _row(db, "notify_outbox", CO_B, SHARED)["status"] == "sending"
        assert _row(db, "notify_outbox", CO_B, SHARED)["title"] == "gizli-kuyruk"
        assert _row(db, "notify_outbox", CO_B, "defer-a")["title"] == "gizli-ertele"
        assert _row(db, "notify_outbox", CO_A, "defer-a")["status"] == "deferred"
        assert _row(db, "notify_outbox", CO_B, "retry-a")["title"] == "gizli-retry"
        assert _row(db, "notify_outbox", CO_A, "retry-a")["status"] == "pending"
        assert _row(db, "notify_outbox", CO_B, f"out:{CO_A}:order:ord-1")["title"] == "gizli-siparis"
        assert _row(db, "company_notify_tenant", CO_B, f"cnt_{CO_A}")["updated_by"] == "gizli"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_idempotency_same_key_two_companies():
    db = _DB()
    prev = _bind(db, _user(CO_A))
    try:
        now = datetime.now(timezone.utc).isoformat()
        stale = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
        _add(db, "idempotency_keys", {
            "_id": "co_a:ttl", "company_id": CO_B, "key": "ttl", "status": "completed",
            "response": {"secret": True}, "created_at": now, "updated_at": now, "endpoint": "/x",
        })
        _add(db, "idempotency_keys", {
            "_id": "co_a:ttl", "company_id": CO_A, "key": "ttl", "status": "completed",
            "response": {"own": True}, "created_at": OLD, "updated_at": OLD, "endpoint": "/x",
        })
        _add(db, "idempotency_keys", {
            "_id": "co_b:pay", "company_id": CO_B, "key": "pay", "status": "in_progress",
            "endpoint": "/orders/pay", "created_at": stale, "updated_at": stale, "payment_applied": False,
        })
        _add(db, "idempotency_keys", {
            "_id": "co_a:pay", "company_id": CO_A, "key": "pay", "status": "in_progress",
            "endpoint": "/orders/pay", "created_at": stale, "updated_at": stale, "payment_applied": False,
        })
        _add(db, "idempotency_keys", {
            "_id": "co_b:fresh", "company_id": CO_B, "key": "fresh", "status": "completed",
            "response": {"keep": True}, "created_at": now, "endpoint": "/x",
        })
        _add(db, "idempotency_keys", {
            "_id": "co_a:old", "company_id": CO_A, "key": "old", "status": "completed",
            "created_at": OLD, "endpoint": "/x",
        })
        other = _run(idempotency.begin(db, CO_B, "ortak", "/invoices"))
        before = _digest(db, CO_B)

        begun = _run(idempotency.begin(db, CO_A, "ttl", "/x"))
        assert begun["hit"] is False
        assert begun["company_id"] == CO_A
        assert _row(db, "idempotency_keys", CO_B, "co_a:ttl")["response"] == {"secret": True}

        own = _run(idempotency.begin(db, CO_A, "ortak", "/invoices"))
        assert other["hit"] is False and own["hit"] is False
        assert _row(db, "idempotency_keys", CO_B, "co_b:ortak")["company_id"] == CO_B
        _run(idempotency.complete(db, CO_A, "ortak", {"status": "ok"}))
        _run(idempotency.mark_payment_applied(db, CO_A, "ortak", {"id": "pay-a"}))
        _run(idempotency.clear_payment_applied(db, CO_A, "ortak"))
        assert _row(db, "idempotency_keys", CO_A, "co_a:ortak")["status"] == "completed"
        assert _row(db, "idempotency_keys", CO_B, "co_b:ortak")["status"] == "in_progress"
        _run(idempotency.abandon(db, CO_A, "ortak"))
        assert _row(db, "idempotency_keys", CO_A, "co_a:ortak") is None
        assert _row(db, "idempotency_keys", CO_B, "co_b:ortak") is not None

        reclaimed = _run(idempotency.begin(db, CO_A, "pay", "/orders/pay"))
        assert reclaimed.get("reclaimed") is True
        assert _row(db, "idempotency_keys", CO_B, "co_b:pay")["updated_at"] == stale

        inserted = _run(idempotency._try_insert(db, {
            "_id": "co_a:direct", "company_id": CO_A, "key": "direct",
        }))
        assert inserted is True
        again = _run(idempotency._try_insert(db, {
            "_id": "co_a:direct", "company_id": CO_A, "key": "direct",
        }))
        assert again is False

        removed = _run(idempotency.purge_expired(db))
        assert removed >= 1
        assert _row(db, "idempotency_keys", CO_A, "co_a:old") is None
        assert _row(db, "idempotency_keys", CO_B, "co_b:fresh")["response"] == {"keep": True}
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_notify_push_and_notification_scope(monkeypatch):
    db = _DB()
    prev = _bind(db, _user(CO_A))
    try:
        _add(db, "push_tokens", {
            "_id": SHARED, "token": TOK_A, "company_id": CO_B, "user_id": "user-shared", "device_id": "gizli",
        })
        _add(db, "push_tokens", {
            "_id": SHARED, "token": TOK_A, "company_id": CO_A, "user_id": "user-shared", "device_id": "a",
        })
        _add(db, "notifications", {
            "_id": SHARED, "company_id": CO_B, "title": "gizli-bildirim", "type": "info", "is_read": False,
        })
        _add(db, "push_receipts_pending", {
            "_id": "tkt-1", "ticket_id": "tkt-1", "token": TOK_B, "created_at": OLD, "expires_at": FAR,
        })
        before = _digest(db, CO_B)

        users = _run(notify.tokens_for_users(db, ["user-shared"], CO_A))
        assert [row["company_id"] for row in users] == [CO_A]
        company_rows = _run(notify.tokens_for_company(db, CO_A))
        assert [row["company_id"] for row in company_rows] == [CO_A]
        saved = _run(notify.upsert_push_token(
            db, user_id="user-a2", company_id=CO_A, token=TOK_A, device_id="a2",
        ))
        assert saved["status"] == "ok"
        assert _row(db, "push_tokens", CO_A, SHARED)["user_id"] == "user-a2"
        assert _row(db, "push_tokens", CO_B, SHARED)["user_id"] == "user-shared"

        removed = _run(notify.remove_push_token(db, TOK_A, company_id=CO_A))
        assert removed == 1
        assert _row(db, "push_tokens", CO_A, SHARED) is None
        assert _row(db, "push_tokens", CO_B, SHARED)["device_id"] == "gizli"

        _add(db, "push_tokens", {
            "_id": "tok-b-only", "token": TOK_B, "company_id": CO_B, "user_id": "user-b",
        })
        dropped = _run(notify.drop_invalid_push_tokens(
            db, [TOK_B], [{"status": "error", "details": {"error": "DeviceNotRegistered"}}],
        ))
        assert dropped == 1
        assert _row(db, "push_tokens", CO_B, "tok-b-only") is None
        assert _row(db, "push_tokens", CO_B, SHARED)["token"] == TOK_A

        _HttpClient.payload = {"data": {"tkt-1": {"status": "error", "details": {"error": "DeviceNotRegistered"}}}}
        monkeypatch.setattr("httpx.AsyncClient", _HttpClient)
        _add(db, "push_tokens", {
            "_id": "tok-b-only", "token": TOK_B, "company_id": CO_B, "user_id": "user-b",
        })
        receipt = _run(notify.check_push_receipts(db))
        assert receipt["dropped_tokens"] == 1
        assert _row(db, "push_tokens", CO_B, "tok-b-only") is None
        assert _row(db, "push_tokens", CO_B, SHARED)["token"] == TOK_A

        note = _run(notify.insert_notification(db, {
            "_id": SHARED, "company_id": CO_A, "type": "info", "title": "Bildirim A", "message": "a",
        }))
        assert note["company_id"] == CO_A
        assert _row(db, "notifications", CO_B, SHARED)["title"] == "gizli-bildirim"
        assert _row(db, "notifications", CO_A, SHARED)["title"] == "Bildirim A"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_trash_restore_and_purge_scope():
    db = _DB()
    user = _user(CO_A)
    prev = _bind(db, user)
    try:
        past = "2020-01-02T00:00:00+00:00"
        _add(db, "trash", {
            "_id": SHARED, "company_id": CO_B, "entity_type": "product", "label": "gizli",
            "collection": "products", "expires_at": past, "deleted_at": past,
            "doc": {"_id": "live-b", "company_id": CO_B, "name": "Gizli"},
        })
        _add(db, "trash", {
            "_id": SHARED, "company_id": CO_A, "entity_type": "product", "label": "Urun A",
            "collection": "products", "expires_at": past, "deleted_at": past,
            "doc": {"_id": "live-a", "company_id": CO_A, "name": "Urun A"},
        })
        _add(db, "trash", {
            "_id": "only-b", "company_id": CO_B, "entity_type": "product", "label": "yalniz-b",
            "collection": "products", "expires_at": FAR, "deleted_at": past,
            "doc": {"_id": "live-only-b", "company_id": CO_B, "name": "Yalniz"},
        })
        _add(db, "sync_tombstones", {
            "_id": "tomb-a", "company_id": CO_A, "collection": "products", "doc_id": "live-a",
        })
        _add(db, "sync_tombstones", {
            "_id": "tomb-b", "company_id": CO_B, "collection": "products", "doc_id": "live-a",
        })
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as denied:
            _run(trash.get_trash_item("only-b", user))
        assert denied.value.status_code == 404
        item = _run(trash.get_trash_item(SHARED, user))
        assert item["label"] == "Urun A"
        assert item["doc"]["name"] == "Urun A"
        restored = _run(trash.restore_trash_item(SHARED, user))
        assert restored["status"] == "success"
        assert _row(db, "products", CO_A, "live-a")["name"] == "Urun A"
        assert _row(db, "trash", CO_B, SHARED)["label"] == "gizli"
        assert _row(db, "sync_tombstones", CO_B, "tomb-b")["doc_id"] == "live-a"
        assert _row(db, "sync_tombstones", CO_A, "tomb-a") is None
        purged = _run(trash.purge_expired(CO_A))
        assert purged == 0
        _add(db, "trash", {
            "_id": "expire-a", "company_id": CO_A, "entity_type": "product", "label": "eski",
            "collection": "products", "expires_at": past, "doc": {"_id": "x", "company_id": CO_A},
        })
        assert _run(trash.purge_expired(CO_A)) == 1
        assert _row(db, "trash", CO_B, SHARED)["label"] == "gizli"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_trash_purge_other_company_is_missing():
    db = _DB()
    user = _user(CO_A)
    prev = _bind(db, user)
    try:
        _add(db, "trash", {
            "_id": "only-b", "company_id": CO_B, "entity_type": "product", "label": "yalniz-b",
            "collection": "products", "expires_at": FAR,
            "doc": {"_id": "live-only-b", "company_id": CO_B, "name": "Yalniz"},
        })
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as denied:
            _run(trash.purge_trash_item("only-b", user))
        assert denied.value.status_code == 404
        assert _row(db, "trash", CO_B, "only-b")["label"] == "yalniz-b"
        _add(db, "trash", {
            "_id": "only-b", "company_id": CO_A, "entity_type": "product", "label": "A",
            "collection": "products", "expires_at": FAR,
            "doc": {"_id": "live-only-a", "company_id": CO_A},
        })
        assert _run(trash.purge_trash_item("only-b", user))["status"] == "success"
        assert _row(db, "trash", CO_A, "only-b") is None
        assert _row(db, "trash", CO_B, "only-b")["label"] == "yalniz-b"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_partner_pay_scope():
    db = _DB()
    prev = _bind(db, _user(CO_A))
    try:
        _add(db, "partners", {
            "_id": SHARED, "company_id": CO_B, "name": "Gizli Ortak", "balance": 777,
            "monthly_salary": 0, "is_active": True,
        })
        _add(db, "partners", {
            "_id": SHARED, "company_id": CO_A, "name": "Ortak A", "balance": 1,
            "monthly_salary": 1000, "salary_day": 1, "salary_start_date": "2020-01-01", "is_active": True,
        })
        _add(db, "partner_transactions", {
            "_id": SHARED, "company_id": CO_B, "partner_id": SHARED, "type": "withdrawal",
            "amount": 50, "expense_id": "exp-b", "source": "expense",
        })
        _add(db, "partner_transactions", {
            "_id": "tx-a", "company_id": CO_A, "partner_id": SHARED, "type": "withdrawal",
            "amount": 10, "expense_id": "exp-a", "source": "expense",
        })
        _add(db, "partner_transactions", {
            "_id": "cap-a", "company_id": CO_A, "partner_id": SHARED, "type": "capital_in", "amount": 40,
        })
        before = _digest(db, CO_B)
        assert _run(partner_pay._partner_company_id(db, SHARED, CO_A)) == CO_A
        fixed = _run(partner_pay.repair_legacy_expense_withdrawals(db, partner_id=SHARED, company_id=CO_A))
        assert fixed == 1
        assert _row(db, "partner_transactions", CO_A, "tx-a")["type"] == "credit"
        assert _row(db, "partner_transactions", CO_B, SHARED)["type"] == "withdrawal"
        synced = _run(partner_pay.sync_partner_from_ledger(db, SHARED, company_id=CO_A))
        assert synced is not None
        assert _row(db, "partners", CO_B, SHARED)["balance"] == 777
        assert _row(db, "partners", CO_A, SHARED)["balance"] != 1
        assert _run(partner_pay.reverse_one(db, {"_id": "tx-a", "company_id": CO_A})) is True
        assert _row(db, "partner_transactions", CO_A, "tx-a") is None
        assert _row(db, "partner_transactions", CO_B, SHARED)["amount"] == 50
        posted = _run(partner_pay.accrue_due_for_all_companies(db, as_of="2026-10-21"))
        assert posted["posted_count"] >= 1
        assert _row(db, "partners", CO_B, SHARED)["balance"] == 777
        assert _row(db, "partners", CO_B, SHARED)["name"] == "Gizli Ortak"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_phone_norm_scope():
    db = _DB()
    prev = _bind(db, _user(CO_A))
    try:
        _add(db, "employees", {
            "_id": SHARED, "company_id": CO_B, "phone": PHONE_B, "full_name": "Gizli", "user_id": "user-b",
        })
        _add(db, "employees", {
            "_id": SHARED, "company_id": CO_A, "phone": PHONE_A, "full_name": "Ali", "user_id": "user-a",
        })
        _add(db, "users", {"_id": "user-b", "is_active": True, "password_hash": "hash-b"})
        before_b = _digest(db, CO_B)
        filled = _run(phone_norm.backfill_phone_norm(db, company_id=CO_A))
        assert filled["employees"] == 1
        assert _row(db, "employees", CO_A, SHARED)["phone_norm"] == "5332223344"
        assert _row(db, "employees", CO_B, SHARED).get("phone_norm") in (None, "")
        assert _digest(db, CO_B) == before_b

        _row(db, "employees", CO_B, SHARED)["phone_norm"] = "5321112233"
        found = _run(phone_norm.find_user_by_phone(db, PHONE_B))
        assert found["_id"] == "user-b"
        assert _row(db, "employees", CO_A, SHARED)["phone_norm"] == "5332223344"
        _row(db, "employees", CO_B, SHARED)["phone_norm"] = ""
        healed = _run(phone_norm.find_user_by_phone(db, PHONE_B))
        assert healed["_id"] == "user-b"
        assert _row(db, "employees", CO_B, SHARED)["phone_norm"] == "5321112233"
        assert _row(db, "employees", CO_A, SHARED)["phone_norm"] == "5332223344"
    finally:
        _restore(prev)


def test_vpos_fake_callback_does_not_touch_other_company(monkeypatch):
    db = _DB()
    prev = _bind(db, _user(CO_A))
    try:
        def _intent(company_id, **extra):
            row = {
                "_id": SHARED,
                "company_id": company_id,
                "status": "pending",
                "amount": "10.00" if company_id == CO_A else "99.00",
                "order_id": "order-a" if company_id == CO_A else "order-b",
                "expires_at": FAR,
                "provider_ref": "tok-a" if company_id == CO_A else "tok-b",
                "vpos_config_id": "cfg-missing",
            }
            row.update(extra)
            return row

        _add(db, "payment_intents", _intent(CO_A))
        _add(db, "payment_intents", _intent(CO_B))
        _add(db, "vpos_configs", {
            "_id": "cfg-shared", "company_id": CO_A, "family": "paytr",
            "merchant_key_enc": "k", "merchant_salt_enc": "s",
        })
        _add(db, "vpos_configs", {
            "_id": "cfg-shared", "company_id": CO_B, "family": "paytr", "label": "gizli",
        })
        before = _digest(db, CO_B)

        calls = {"n": 0}

        def _hex(_n):
            calls["n"] += 1
            return "order-b" if calls["n"] == 1 else "order-free"

        monkeypatch.setattr(vpos_api.secrets, "token_hex", _hex)
        allocated = _run(vpos_api._allocate_order_id(db))
        assert allocated == "order-free"
        assert _row(db, "payment_intents", CO_B, SHARED)["order_id"] == "order-b"

        _run(vpos_api.vpos_callback(SHARED, _Req(ip="203.0.113.61")))
        assert _row(db, "payment_intents", CO_A, SHARED)["status"] == "failed"
        assert _row(db, "payment_intents", CO_B, SHARED)["status"] == "pending"

        _row(db, "payment_intents", CO_A, SHARED)["status"] = "pending"
        _run(vpos_api.iyzico_callback(SHARED, _Req({"token": "tok-a"}, ip="203.0.113.62")))
        assert _row(db, "payment_intents", CO_A, SHARED)["status"] == "failed"
        assert _row(db, "payment_intents", CO_B, SHARED)["status"] == "pending"
        assert _row(db, "payment_intents", CO_B, SHARED)["amount"] == "99.00"

        async def _secret(_value, _label):
            return "secret"

        async def _confirm(_runtime, _intent, _form):
            return {"ok": False, "error": "declined"}

        monkeypatch.setattr(vpos_api, "_decrypt_secret", _secret)
        monkeypatch.setattr(vpos_api.paytr_family, "notification_hash_ok", lambda *_a, **_k: True)
        monkeypatch.setattr(vpos_api.paytr_family.ADAPTER, "confirm", _confirm)
        _row(db, "payment_intents", CO_A, SHARED)["status"] = "pending"
        _row(db, "payment_intents", CO_A, SHARED)["vpos_config_id"] = "cfg-shared"
        _run(vpos_api.paytr_notify("cfg-shared", _Req({"merchant_oid": "order-a"}, ip="203.0.113.63")))
        assert _row(db, "payment_intents", CO_A, SHARED)["status"] == "failed"
        assert _row(db, "payment_intents", CO_B, SHARED)["status"] == "pending"
        assert _row(db, "vpos_configs", CO_B, "cfg-shared")["label"] == "gizli"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_migration_import_rollback_and_bizimhesap(monkeypatch):
    db = _DB()
    user = _user(CO_A)
    prev = _bind(db, user)
    try:
        _add(db, "migration_uploads", {
            "_id": SHARED, "company_id": CO_A, "entity": "products", "source": "other",
            "filename": "a.csv", "columns": [], "rows": [],
        })
        _add(db, "migration_uploads", {
            "_id": SHARED, "company_id": CO_B, "entity": "products", "source": "other",
            "filename": "gizli.csv", "columns": [], "rows": [],
        })
        _add(db, "migration_batches", {
            "_id": SHARED, "company_id": CO_A, "entity": "invoices", "status": "done",
            "inserted_ids": ["inv-shared"], "updated": [{"id": "inv-upd", "prev": {"notes": "eski-a"}}],
        })
        _add(db, "migration_batches", {
            "_id": SHARED, "company_id": CO_B, "entity": "invoices", "status": "done",
            "inserted_ids": ["inv-shared"], "updated": [],
        })
        _add(db, "invoices", {"_id": "inv-shared", "company_id": CO_A, "notes": "a"})
        _add(db, "invoices", {"_id": "inv-shared", "company_id": CO_B, "notes": "gizli-fatura"})
        _add(db, "invoices", {"_id": "inv-upd", "company_id": CO_A, "notes": "yeni-a"})
        _add(db, "invoices", {"_id": "inv-upd", "company_id": CO_B, "notes": "gizli-upd"})
        _add(db, "contacts", {
            "_id": "cnt-shared", "company_id": CO_A, "name": "Cari A", "import_batch_id": SHARED,
        })
        _add(db, "contacts", {
            "_id": "cnt-shared", "company_id": CO_B, "name": "Gizli Cari", "import_batch_id": SHARED,
        })
        _add(db, "products", {
            "_id": SHARED, "company_id": CO_A, "name": "Eski A", "bizimhesap_id": "ext-1", "sku": "A1",
        })
        _add(db, "products", {
            "_id": SHARED, "company_id": CO_B, "name": "Gizli Urun", "bizimhesap_id": "ext-1", "sku": "B1",
        })
        _add(db, "contacts", {
            "_id": "cnt-api", "company_id": CO_A, "name": "Cari A",
        })
        _add(db, "contacts", {
            "_id": "cnt-api", "company_id": CO_B, "name": "Gizli API",
        })
        before = _digest(db, CO_B)

        async def _empty(_upload, _mapping):
            return [], []

        monkeypatch.setattr(migration, "_transform", _empty)
        imported = _run(migration.migration_import({"upload_id": SHARED, "company_id": CO_A}, user))
        assert imported["inserted"] == 0
        assert _row(db, "migration_uploads", CO_A, SHARED) is None
        assert _row(db, "migration_uploads", CO_B, SHARED)["filename"] == "gizli.csv"

        rolled = _run(migration.migration_rollback(SHARED, user))
        assert rolled["status"] == "success"
        assert _row(db, "invoices", CO_B, "inv-shared")["notes"] == "gizli-fatura"
        assert _row(db, "invoices", CO_A, "inv-shared") is None
        assert _row(db, "invoices", CO_B, "inv-upd")["notes"] == "gizli-upd"
        assert _row(db, "invoices", CO_A, "inv-upd")["notes"] == "eski-a"
        assert _row(db, "contacts", CO_B, "cnt-shared")["name"] == "Gizli Cari"
        assert _row(db, "contacts", CO_A, "cnt-shared") is None
        assert _row(db, "migration_batches", CO_B, SHARED)["status"] == "done"
        assert _row(db, "migration_batches", CO_A, SHARED)["status"] == "rolled_back"

        async def _creds(_company_id, token="", firm_id=""):
            return "tok", "firm"

        async def _products(_company_id, _token, _firm_id="", force=False):
            return [
                {"id": "ext-1", "title": "Guncel A", "isActive": "1", "code": "A1"},
                {"id": "ext-2", "title": "Yeni A", "isActive": "1", "code": "A2"},
            ], False

        async def _customers(_path, _token, _firm_id="", timeout=40.0):
            return [
                {"id": "c-1", "title": "Cari A", "balance": "10"},
                {"id": "c-2", "title": "Yeni Cari", "balance": "3"},
            ]

        monkeypatch.setattr(migration, "_bh_creds", _creds)
        monkeypatch.setattr(migration, "_bh_products", _products)
        monkeypatch.setattr(migration, "_bh_get", _customers)
        imported_products = _run(migration.bh_import({"company_id": CO_A, "with_stock": False, "with_images": False}, user))
        assert imported_products["status"] == "success"
        assert _row(db, "products", CO_A, SHARED)["name"] == "Guncel A"
        assert _row(db, "products", CO_B, SHARED)["name"] == "Gizli Urun"
        imported_customers = _run(migration.bh_import_customers({"company_id": CO_A}, user))
        assert imported_customers["status"] == "success"
        assert _row(db, "contacts", CO_B, "cnt-api")["name"] == "Gizli API"
        assert any(doc.get("company_id") == CO_A and doc.get("name") == "Yeni Cari" for doc in db.contacts.docs)

        created = _run(migration._invoice_doc(CO_A, {
            "contact_name": "Cari A", "invoice_number": "A-1", "issue_date": "2026-10-01", "grand_total": 12,
        }, "batch-inv"))
        assert created["company_id"] == CO_A
        assert _row(db, "contacts", CO_B, "cnt-api")["name"] == "Gizli API"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_saas_quota_admin_and_seed():
    db = _DB()
    prev = _bind(db, _user(CO_A))
    try:
        for cid, name in ((CO_A, "Firma A"), (CO_B, "Firma B")):
            _add(db, "companies", {
                "_id": cid, "company_id": cid, "name": name, "license_id": cid,
                "created_at": "2026-01-01T00:00:00+00:00",
            })
        _add(db, "files", {"_id": SHARED, "company_id": CO_B, "entity_id": CO_A, "size": 5000})
        _add(db, "files", {"_id": SHARED, "company_id": CO_A, "size": 12})
        _add(db, "upgrade_requests", {
            "_id": SHARED, "company_id": CO_A, "status": "pending", "plan_name": "Pro",
            "plan_id": "plan_pro", "created_at": "2026-10-01T00:00:00+00:00",
        })
        _add(db, "upgrade_requests", {
            "_id": SHARED, "company_id": CO_B, "status": "pending", "plan_name": "Gizli",
            "created_at": "2026-10-02T00:00:00+00:00", "note": "gizli-talep",
        })
        _add(db, "products", {"_id": SHARED, "company_id": CO_A, "name": "Nexus Kalem"})
        _add(db, "products", {"_id": SHARED, "company_id": CO_B, "name": "Gizli Urun"})
        before = _digest(db, CO_B)

        usage = _run(saas.quota_usage(CO_A))
        assert usage["storage_bytes"] == 12
        detail = _run(saas._usage(CO_A))
        assert detail["storage_bytes"] == 12
        stats = _run(saas.overview_stats())
        assert stats["pending_requests"] == 2
        rows = _run(saas.upgrade_request_rows(company_id=CO_A))
        assert len(rows) == 1
        assert rows[0]["company_id"] == CO_A
        resolved = _run(saas.apply_upgrade_resolution(SHARED, "rejected", "olmaz", False))
        assert resolved["status"] == "rejected"
        assert resolved["company_id"] == CO_A
        assert _row(db, "upgrade_requests", CO_B, SHARED)["status"] == "pending"
        assert _row(db, "upgrade_requests", CO_B, SHARED)["note"] == "gizli-talep"
        _run(saas.seed())
        assert _row(db, "products", CO_A, SHARED)["name"] == "TamKobi Kalem"
        assert _row(db, "products", CO_B, SHARED)["name"] == "Gizli Urun"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_wave24_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 68
    assert len(_REMOVED) == len(set(_REMOVED))
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout


def test_wave24_in_scope_files_have_zero_baseline():
    base = allowlist.TENANT_SCOPE_BASELINE
    for name in _SCOPE_FILES:
        assert sum(1 for key in base if key[0] == name) == 0
