"""Expo push ticket/receipt hataları: in-memory db, httpx mock, canlı Expo yok."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import notify

KEEP = "ExponentPushToken[keepTOKENKEEP99]"
DROP = "ExponentPushToken[dropTOKENDROP99]"
BAD = "ExponentPushToken[badTOKENBAD999]"
SECRET = "expo-access-test-token"


class JsonResponse:
    def __init__(self, payload):
        self._payload = payload
        self.content = b"{}"

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class RecordingClient:
    calls = []
    handler = staticmethod(lambda url, body: {"data": []})

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None, headers=None):
        RecordingClient.calls.append({
            "url": url,
            "json": json,
            "headers": dict(headers or {}),
        })
        return JsonResponse(RecordingClient.handler(url, json))


class MemColl:
    def __init__(self):
        self.docs = {}

    def _match(self, doc, query):
        for key, expected in (query or {}).items():
            if key == "$or":
                if not any(self._match(doc, clause) for clause in expected):
                    return False
                continue
            if str(key).startswith("$"):
                continue
            current = doc.get(key)
            if isinstance(expected, dict):
                if "$in" in expected and current not in expected["$in"]:
                    return False
                if "$ne" in expected and current == expected["$ne"]:
                    return False
                if "$lt" in expected and not (current is not None and current < expected["$lt"]):
                    return False
                if "$gte" in expected and not (current is not None and current >= expected["$gte"]):
                    return False
                continue
            if current != expected:
                return False
        return True

    async def find_one(self, query=None, *args, **kwargs):
        for doc in self.docs.values():
            if self._match(doc, query or {}):
                return dict(doc)
        return None

    def find(self, query=None, *args, **kwargs):
        rows = [dict(doc) for doc in self.docs.values() if self._match(doc, query or {})]

        class Cursor:
            def sort(self, *args, **kwargs):
                return self

            async def to_list(self, limit=None):
                if limit is None:
                    return list(rows)
                return list(rows)[:limit]

        return Cursor()

    async def insert_one(self, doc):
        stored = dict(doc)
        self.docs[str(stored["_id"])] = stored
        return SimpleNamespace(inserted_id=stored["_id"])

    async def update_one(self, filt, upd, upsert=False):
        found = None
        for doc in self.docs.values():
            if self._match(doc, filt or {}):
                found = doc
                break
        if found is None:
            if not upsert:
                return SimpleNamespace(modified_count=0, deleted_count=0)
            doc = {}
            if "$setOnInsert" in (upd or {}):
                doc.update(upd["$setOnInsert"])
            if "$set" in (upd or {}):
                doc.update(upd["$set"])
            for key, value in (filt or {}).items():
                if not str(key).startswith("$") and not isinstance(value, dict):
                    doc.setdefault(key, value)
            if not doc.get("_id"):
                doc["_id"] = "generated"
            self.docs[str(doc["_id"])] = doc
            return SimpleNamespace(modified_count=1, upserted_id=doc["_id"], deleted_count=0)
        if "$set" in (upd or {}):
            found.update(upd["$set"])
        return SimpleNamespace(modified_count=1, deleted_count=0)

    async def delete_many(self, query):
        doomed = [key for key, doc in self.docs.items() if self._match(doc, query or {})]
        for key in doomed:
            del self.docs[key]
        return SimpleNamespace(deleted_count=len(doomed))


class MemDB:
    def __init__(self):
        self.push_tokens = MemColl()
        self.push_receipts_pending = MemColl()
        self.users = MemColl()


def _db_with(*tokens):
    db = MemDB()
    for idx, token in enumerate(tokens):
        db.push_tokens.docs[f"t{idx}"] = {
            "_id": f"t{idx}",
            "user_id": "usr_1",
            "company_id": "c1",
            "token": token,
            "platform": "android",
        }
    return db


def _note():
    return {
        "_id": "n1",
        "company_id": "c1",
        "type": "task_assigned",
        "title": "Görev",
        "message": "bak",
        "user_id": "usr_1",
        "roles": [],
        "link": "/tasks",
    }


def _tokens(db):
    return [doc["token"] for doc in db.push_tokens.docs.values()]


def _pending_ids(db):
    return set(db.push_receipts_pending.docs)


def _run(coro):
    return asyncio.run(coro)


def test_invalid_credentials_warns_and_keeps_token(caplog, monkeypatch):
    monkeypatch.delenv("EXPO_ACCESS_TOKEN", raising=False)
    db = _db_with(KEEP)
    RecordingClient.calls = []
    RecordingClient.handler = staticmethod(lambda url, body: {
        "data": [{"status": "error", "message": "bad creds", "details": {"error": "InvalidCredentials"}}],
    })

    async def go():
        with patch("httpx.AsyncClient", RecordingClient), caplog.at_level(logging.WARNING):
            return await notify.dispatch_push(db, _note())

    result = _run(go())
    assert result["errors"] == 1
    assert KEEP in _tokens(db)
    assert _pending_ids(db) == set()
    assert "InvalidCredentials" in caplog.text
    assert KEEP not in caplog.text
    assert KEEP[-6:] in caplog.text
    assert SECRET not in caplog.text


def test_device_not_registered_ticket_deletes_token(caplog, monkeypatch):
    monkeypatch.delenv("EXPO_ACCESS_TOKEN", raising=False)
    db = _db_with(DROP)
    RecordingClient.calls = []
    RecordingClient.handler = staticmethod(lambda url, body: {
        "data": [{"status": "error", "details": {"error": "DeviceNotRegistered"}}],
    })

    async def go():
        with patch("httpx.AsyncClient", RecordingClient), caplog.at_level(logging.WARNING):
            return await notify.dispatch_push(db, _note())

    _run(go())
    assert _tokens(db) == []
    assert "DeviceNotRegistered" in caplog.text
    assert DROP not in caplog.text
    assert DROP[-6:] in caplog.text


def test_receipts_drop_unregistered_and_clear_ok(caplog, monkeypatch):
    monkeypatch.delenv("EXPO_ACCESS_TOKEN", raising=False)
    db = _db_with(KEEP, DROP, BAD)
    now = datetime.now(timezone.utc)
    future = (now + timedelta(hours=12)).isoformat()
    past = (now - timedelta(hours=48)).isoformat()
    db.push_receipts_pending.docs["id-ok"] = {
        "_id": "id-ok", "ticket_id": "id-ok", "token": KEEP,
        "created_at": now.isoformat(), "expires_at": future,
    }
    db.push_receipts_pending.docs["id-dnr"] = {
        "_id": "id-dnr", "ticket_id": "id-dnr", "token": DROP,
        "created_at": now.isoformat(), "expires_at": future,
    }
    db.push_receipts_pending.docs["id-bad"] = {
        "_id": "id-bad", "ticket_id": "id-bad", "token": BAD,
        "created_at": now.isoformat(), "expires_at": future,
    }
    db.push_receipts_pending.docs["id-wait"] = {
        "_id": "id-wait", "ticket_id": "id-wait", "token": KEEP,
        "created_at": now.isoformat(), "expires_at": future,
    }
    db.push_receipts_pending.docs["id-old"] = {
        "_id": "id-old", "ticket_id": "id-old", "token": KEEP,
        "created_at": past, "expires_at": past,
    }
    RecordingClient.calls = []

    def handler(url, body):
        assert str(url).endswith("/getReceipts")
        assert "id-old" not in (body or {}).get("ids", [])
        return {"data": {
            "id-ok": {"status": "ok"},
            "id-dnr": {"status": "error", "message": "gone", "details": {"error": "DeviceNotRegistered"}},
            "id-bad": {"status": "error", "details": {"error": "InvalidCredentials"}},
        }}

    RecordingClient.handler = staticmethod(handler)

    async def go():
        with patch("httpx.AsyncClient", RecordingClient), caplog.at_level(logging.WARNING):
            return await notify.check_push_receipts(db)

    result = _run(go())
    assert result["checked"] >= 1
    assert KEEP in _tokens(db)
    assert BAD in _tokens(db)
    assert DROP not in _tokens(db)
    pending = _pending_ids(db)
    assert "id-ok" not in pending
    assert "id-dnr" not in pending
    assert "id-bad" not in pending
    assert "id-old" not in pending
    assert "id-wait" in pending
    assert "InvalidCredentials" in caplog.text
    assert DROP not in caplog.text
    assert BAD not in caplog.text
    assert KEEP not in caplog.text
    posted = RecordingClient.calls[0]["json"]["ids"]
    assert "id-wait" in posted
    assert "id-old" not in posted
    assert len(posted) <= 300
    assert RecordingClient.calls[0]["url"] == "https://exp.host/--/api/v2/push/getReceipts"
    assert "Authorization" not in RecordingClient.calls[0]["headers"]


def test_expo_access_token_header_only_when_set(caplog, monkeypatch):
    RecordingClient.calls = []
    RecordingClient.handler = staticmethod(lambda url, body: {
        "data": [{"status": "error", "details": {"error": "MismatchSenderId"}}],
    })
    messages = [{"to": KEEP, "title": "t", "body": "b"}]

    async def send():
        with patch("httpx.AsyncClient", RecordingClient), caplog.at_level(logging.WARNING):
            return await notify.send_expo_push(messages)

    monkeypatch.setenv("EXPO_ACCESS_TOKEN", SECRET)
    _run(send())
    assert RecordingClient.calls[-1]["headers"]["Authorization"] == f"Bearer {SECRET}"
    assert SECRET not in caplog.text
    assert KEEP not in caplog.text
    assert "MismatchSenderId" in caplog.text

    monkeypatch.delenv("EXPO_ACCESS_TOKEN", raising=False)
    _run(send())
    assert "Authorization" not in RecordingClient.calls[-1]["headers"]
    assert SECRET not in caplog.text


def test_receipt_batch_does_not_delete_unchecked(monkeypatch):
    monkeypatch.delenv("EXPO_ACCESS_TOKEN", raising=False)
    db = MemDB()
    now = datetime.now(timezone.utc)
    future = (now + timedelta(hours=2)).isoformat()
    for ticket_id in ("id-a", "id-b"):
        db.push_receipts_pending.docs[ticket_id] = {
            "_id": ticket_id,
            "ticket_id": ticket_id,
            "token": KEEP,
            "created_at": now.isoformat(),
            "expires_at": future,
        }
    RecordingClient.calls = []
    RecordingClient.handler = staticmethod(lambda url, body: {
        "data": {ticket_id: {"status": "ok"} for ticket_id in (body or {}).get("ids", [])},
    })

    async def go():
        with patch("httpx.AsyncClient", RecordingClient):
            return await notify.check_push_receipts(db, limit=1)

    result = _run(go())
    assert result["checked"] == 1
    assert len(RecordingClient.calls[0]["json"]["ids"]) == 1
    assert len(_pending_ids(db)) == 1
