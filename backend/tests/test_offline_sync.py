"""Offline delta, idempotency, çakışma ve şirket izolasyonu."""
import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import idempotency
import offline_sync
from idempotency import DuplicateKeyError


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, limit):
        return [dict(row) for row in self.rows[:limit]]


def _match(doc, query):
    if not isinstance(query, dict):
        return False
    for key, expected in query.items():
        if key == "$or":
            if not any(_match(doc, item) for item in expected):
                return False
            continue
        if key == "$and":
            if not all(_match(doc, item) for item in expected):
                return False
            continue
        value = doc.get(key)
        if isinstance(expected, dict) and "$gt" in expected:
            if value is None or not (str(value) > str(expected["$gt"])):
                return False
            continue
        if value != expected:
            return False
    return True


class Coll:
    def __init__(self):
        self.docs = []

    def find(self, query, proj=None):
        return _Cursor([row for row in self.docs if _match(row, query)])

    async def find_one(self, query):
        for row in self.docs:
            if _match(row, query):
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


class IdempoColl(Coll):
    async def create_index(self, *args, **kwargs):
        return None

    async def insert_one(self, doc):
        if any(row.get("_id") == doc.get("_id") for row in self.docs):
            raise DuplicateKeyError("dup")
        self.docs.append(dict(doc))

    async def update_one(self, query, upd):
        for row in self.docs:
            if _match(row, {k: v for k, v in query.items() if k != "$or"}):
                if "$set" in upd:
                    row.update(upd["$set"])
                if "$unset" in upd:
                    for key in upd["$unset"]:
                        row.pop(key, None)
                return MagicMock(matched_count=1)
        return MagicMock(matched_count=0)

    async def delete_one(self, query):
        before = len(self.docs)
        self.docs = [row for row in self.docs if not _match(row, query)]
        return MagicMock(deleted_count=before - len(self.docs))


class DB:
    def __init__(self):
        self.companies = Coll()
        self.products = Coll()
        self.contacts = Coll()
        self.orders = Coll()
        self.idempotency_keys = IdempoColl()


class Req:
    def __init__(self, key):
        self.headers = {"Idempotency-Key": key}


def test_offline_max_minutes_defaults_to_10():
    assert offline_sync.offline_max_minutes({}) == 10
    assert offline_sync.offline_max_minutes(None) == 10
    assert offline_sync.clamp_offline_max_minutes("25") == 25
    assert offline_sync.clamp_offline_max_minutes(0) == 1
    assert offline_sync.clamp_offline_max_minutes("nope") == 10


def test_updated_since_filters_and_keeps_existing_or():
    query = {"company_id": "A", "$or": [{"_id": {"$in": ["1"]}}]}
    offline_sync.apply_updated_since(query, "2026-01-01T00:00:00+00:00")
    assert "$or" not in query
    assert query["company_id"] == "A"
    assert len(query["$and"]) == 2
    untouched = {"company_id": "A"}
    offline_sync.apply_updated_since(untouched, "  ")
    assert untouched == {"company_id": "A"}


def test_delta_is_company_scoped_and_incremental():
    db = DB()
    db.companies.docs.append({"_id": "A", "offline_max_minutes": 15})
    db.companies.docs.append({"_id": "B", "name": "Diğer"})
    db.products.docs.extend([
        {"_id": "p1", "company_id": "A", "name": "Kalem", "sale_price": 5, "stock_quantity": 3,
         "updated_at": "2026-02-01T00:00:00+00:00", "tax_number": "111", "password": "gizli"},
        {"_id": "p2", "company_id": "A", "name": "Defter", "sale_price": 8, "stock_quantity": 1,
         "updated_at": "2026-03-01T00:00:00+00:00"},
        {"_id": "pB", "company_id": "B", "name": "Yabancı", "sale_price": 99, "stock_quantity": 50,
         "updated_at": "2026-03-02T00:00:00+00:00", "iban": "TR00"},
    ])
    db.contacts.docs.append({
        "_id": "c1", "company_id": "A", "name": "Ada", "updated_at": "2026-03-01T00:00:00+00:00",
        "tax_number_or_id": "1234567890", "iban": "TR99", "pin": "4321",
    })
    db.contacts.docs.append({
        "_id": "cB", "company_id": "B", "name": "Başka", "updated_at": "2026-03-02T00:00:00+00:00",
    })

    full = _run(offline_sync.build_delta(db, "A", None))
    assert full["offline_max_minutes"] == 15
    assert [row["id"] for row in full["products"]] == ["p1", "p2"]
    assert [row["id"] for row in full["stock"]] == ["p1", "p2"]
    assert [row["id"] for row in full["price_lists"]] == ["p1", "p2"]
    assert [row["id"] for row in full["contacts"]] == ["c1"]
    blob = str(full)
    assert "gizli" not in blob
    assert "1234567890" not in blob
    assert "TR99" not in blob
    assert "4321" not in blob
    assert "Yabancı" not in blob

    delta = _run(offline_sync.build_delta(db, "A", "2026-02-15T00:00:00+00:00"))
    assert [row["id"] for row in delta["products"]] == ["p2"]
    assert delta["stock"][0]["stock_quantity"] == 1
    assert delta["price_lists"][0]["sale_price"] == 8


def test_same_idempotency_key_inserts_one_order_and_companies_stay_apart():
    db = DB()
    calls = {"A": 0, "B": 0}

    async def insert(company_id):
        calls[company_id] += 1
        doc = {"_id": f"ord-{company_id}-{calls[company_id]}", "company_id": company_id, "order_number": f"N-{calls[company_id]}"}
        await db.orders.insert_one(doc)
        return {"id": doc["_id"], "company_id": company_id}

    req = Req("same-key")
    first = _run(idempotency.run(db, "A", req, "orders/create", lambda: insert("A")))
    second = _run(idempotency.run(db, "A", req, "orders/create", lambda: insert("A")))
    other = _run(idempotency.run(db, "B", req, "orders/create", lambda: insert("B")))
    assert first == second
    assert calls == {"A": 1, "B": 1}
    assert len(db.orders.docs) == 2
    assert {row["company_id"] for row in db.orders.docs} == {"A", "B"}
    assert other["company_id"] == "B"


def test_stock_amount_and_document_conflicts():
    db = DB()
    db.products.docs.append({"_id": "p1", "company_id": "A", "name": "Kalem", "stock_quantity": 1, "track_stock": True})
    db.orders.docs.append({"_id": "ord-1", "company_id": "A", "order_number": "ORD-1"})
    db.orders.docs.append({"_id": "ord-b", "company_id": "B", "order_number": "ORD-1"})

    with pytest.raises(HTTPException) as raised:
        _run(offline_sync.assert_stock_available(
            db, "A", [{"product_id": "p1", "quantity": 2}], {"p1": 5},
        ))
    assert raised.value.status_code == 409
    assert raised.value.detail["code"] == "stock_conflict"
    assert raised.value.detail["conflicts"][0]["available"] == 1
    _run(offline_sync.assert_stock_available(db, "A", [{"product_id": "p1", "quantity": 2}], None))

    amount = offline_sync.amount_decision(10, 12.5)
    assert amount["decision"] == "server"
    assert amount["server_total"] == 12.5
    assert offline_sync.amount_decision(12.5, 12.5) is None

    own = _run(offline_sync.document_number_conflict(db, "A", "ORD-1"))
    assert own["code"] == "document_conflict"
    assert own["existing_id"] == "ord-1"
    assert own["decision"] == "rejected"
    assert _run(offline_sync.document_number_conflict(db, "A", "ORD-2")) is None
    other = _run(offline_sync.document_number_conflict(db, "B", "ORD-9"))
    assert other is None
