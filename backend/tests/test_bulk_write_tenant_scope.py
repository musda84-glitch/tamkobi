"""Toplu yazma uçları oturum firmasıyla sınırlıdır.

bulk_product_flags, mark_labels_printed ve mark_form_printed başka firmanın
kayıtlarını güncellemez. Bellek içi koleksiyon mysql_store.match_query /
apply_update kullanır (dashboard_memdb.MemDB). Canlı veritabanına ve 8021
portuna bağlanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-bulk-write-tenant-scope-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import server  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CO_C = "co_c"
_OMIT = object()


def _run(coro):
    return asyncio.run(coro)


def _user(*company_ids, active=None, role="admin"):
    ids = list(company_ids)
    return {
        "_id": "user-" + "-".join(ids),
        "id": "user-" + "-".join(ids),
        "email": "user@example.com",
        "name": "Kullanıcı",
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": ids,
        "active_company_id": active or ids[0],
    }


def _bind():
    db = MemDB()
    seen = []
    prev = server.db
    server.db = db

    def _wrap(coll):
        orig = coll.update_many

        async def wrapped(query, update, upsert=False):
            result = await orig(query, update, upsert=upsert)
            seen.append((copy.deepcopy(query), result))
            return result

        coll.update_many = wrapped

    _wrap(db.products)
    _wrap(db.orders)
    return db, seen, prev


def _restore(prev):
    server.db = prev


async def _seed(db):
    await db.products.insert_one({
        "_id": "prod_a",
        "company_id": CO_A,
        "name": "A ürün",
        "show_in_b2b": True,
        "track_stock": True,
    })
    await db.products.insert_one({
        "_id": "prod_b",
        "company_id": CO_B,
        "name": "B ürün",
        "show_in_b2b": True,
        "track_stock": True,
    })
    await db.orders.insert_one({
        "_id": "ord_a",
        "company_id": CO_A,
        "order_number": "A-1",
    })
    await db.orders.insert_one({
        "_id": "ord_b",
        "company_id": CO_B,
        "order_number": "B-1",
    })


async def _call(kind, ids, user, company_id=_OMIT, *, show_in_b2b=False):
    body = {"ids": list(ids)}
    if company_id is not _OMIT:
        body["company_id"] = company_id
    if kind == "flags":
        body["show_in_b2b"] = show_in_b2b
        body["track_stock"] = False
        return await server.bulk_product_flags(body, user)
    if kind == "labels":
        return await server.mark_labels_printed(body, user)
    if kind == "form":
        return await server.mark_form_printed(body, user)
    raise AssertionError(kind)


def _unchanged_b(db, products_before, orders_before):
    prod_b = next(d for d in db.products.docs if d["_id"] == "prod_b")
    ord_b = next(d for d in db.orders.docs if d["_id"] == "ord_b")
    before_p = next(d for d in products_before if d["_id"] == "prod_b")
    before_o = next(d for d in orders_before if d["_id"] == "ord_b")
    assert prod_b == before_p
    assert ord_b == before_o
    assert prod_b["show_in_b2b"] is True
    assert prod_b["track_stock"] is True
    assert "label_printed_at" not in ord_b
    assert "form_printed_at" not in ord_b


@pytest.mark.parametrize("kind", ["flags", "labels", "form"])
def test_other_company_ids_are_not_modified(kind):
    """Firma A, firma B kayıt kimlikleriyle çağırınca B değişmez (modified_count=0)."""
    db, seen, prev = _bind()

    async def run():
        await _seed(db)
        products_before = copy.deepcopy(db.products.docs)
        orders_before = copy.deepcopy(db.orders.docs)
        user = _user(CO_A)
        ids = ["prod_b"] if kind == "flags" else ["ord_b"]
        out = await _call(kind, ids, user, CO_A)
        assert out["status"] == "success"
        if kind == "flags":
            assert out["matched"] == 0
            assert out["modified"] == 0
            assert out["count"] == 1
            assert out["show_in_b2b"] is False
            assert out["track_stock"] is False
        else:
            assert out["count"] == 0
        if kind == "form":
            assert out.get("form_printed_at")
        _unchanged_b(db, products_before, orders_before)
        assert seen, "update_many çağrılmadı"
        for query, result in seen:
            assert query["company_id"] == CO_A
            assert result.modified_count == 0
            assert result.matched_count == 0

    try:
        _run(run())
    finally:
        _restore(prev)


@pytest.mark.parametrize("kind", ["flags", "labels", "form"])
def test_own_company_ids_are_updated(kind):
    """Firma A kendi kayıtlarında güncelleme çalışır."""
    db, seen, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        if kind == "flags":
            out = await _call(kind, ["prod_a"], user, CO_A, show_in_b2b=False)
            assert out["status"] == "success"
            assert out["matched"] == 1
            assert out["modified"] == 1
            assert out["count"] == 1
            prod = await db.products.find_one({"_id": "prod_a"})
            assert prod["show_in_b2b"] is False
            assert prod["track_stock"] is False
            assert prod.get("updated_at")
        elif kind == "labels":
            out = await _call(kind, ["ord_a"], user, CO_A)
            assert out == {"status": "success", "count": 1}
            order = await db.orders.find_one({"_id": "ord_a"})
            assert order.get("label_printed_at")
        else:
            out = await _call(kind, ["ord_a"], user, CO_A)
            assert out["status"] == "success"
            assert out["count"] == 1
            assert out.get("form_printed_at")
            order = await db.orders.find_one({"_id": "ord_a"})
            assert order.get("form_printed_at") == out["form_printed_at"]
        other_p = await db.products.find_one({"_id": "prod_b"})
        other_o = await db.orders.find_one({"_id": "ord_b"})
        assert other_p["show_in_b2b"] is True
        assert "label_printed_at" not in other_o
        assert "form_printed_at" not in other_o
        assert sum(result.modified_count for _query, result in seen) == 1
        assert all(query["company_id"] == CO_A for query, _result in seen)

    try:
        _run(run())
    finally:
        _restore(prev)


@pytest.mark.parametrize("kind", ["flags", "labels", "form"])
def test_omitted_body_company_id_does_not_touch_other_company(kind):
    """Gövdede company_id yokken B kimlikleri aktif firmaya yazılmaz."""
    db, seen, prev = _bind()

    async def run():
        await _seed(db)
        products_before = copy.deepcopy(db.products.docs)
        orders_before = copy.deepcopy(db.orders.docs)
        user = _user(CO_A)
        ids = ["prod_b"] if kind == "flags" else ["ord_b"]
        out = await _call(kind, ids, user)
        assert out["status"] == "success"
        if kind == "flags":
            assert out["modified"] == 0
            assert out["matched"] == 0
        else:
            assert out["count"] == 0
        _unchanged_b(db, products_before, orders_before)
        assert seen
        for query, result in seen:
            assert query["company_id"] == CO_A
            assert "company_id" in query
            assert result.modified_count == 0
            assert result.matched_count == 0

    try:
        _run(run())
    finally:
        _restore(prev)


@pytest.mark.parametrize("kind", ["flags", "labels", "form"])
def test_body_company_outside_membership_is_forbidden(kind):
    """Üyelik dışı company_id 403 döner ve hiçbir kayıt yazılmaz."""
    db, seen, prev = _bind()

    async def run():
        await _seed(db)
        products_before = copy.deepcopy(db.products.docs)
        orders_before = copy.deepcopy(db.orders.docs)
        user = _user(CO_A)
        ids = ["prod_b"] if kind == "flags" else ["ord_b"]
        with pytest.raises(HTTPException) as exc:
            await _call(kind, ids, user, CO_B)
        assert exc.value.status_code == 403
        assert db.products.docs == products_before
        assert db.orders.docs == orders_before
        assert seen == []

    try:
        _run(run())
    finally:
        _restore(prev)


@pytest.mark.parametrize("kind", ["flags", "labels", "form"])
def test_multi_company_user_stays_on_active_company(kind):
    """Muhasebeci company_id göndermezse seçili (aktif) firma kapsamı kalır."""
    db, seen, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A, CO_B, active=CO_A, role="accountant")
        if kind == "flags":
            out = await _call(kind, ["prod_a", "prod_b"], user, show_in_b2b=False)
            assert out["matched"] == 1
            assert out["modified"] == 1
            assert out["count"] == 2
            own = await db.products.find_one({"_id": "prod_a"})
            other = await db.products.find_one({"_id": "prod_b"})
            assert own["show_in_b2b"] is False
            assert other["show_in_b2b"] is True
            assert other["track_stock"] is True
        elif kind == "labels":
            out = await _call(kind, ["ord_a", "ord_b"], user)
            assert out["count"] == 1
            assert (await db.orders.find_one({"_id": "ord_a"})).get("label_printed_at")
            assert "label_printed_at" not in await db.orders.find_one({"_id": "ord_b"})
        else:
            out = await _call(kind, ["ord_a", "ord_b"], user)
            assert out["count"] == 1
            assert (await db.orders.find_one({"_id": "ord_a"})).get("form_printed_at")
            assert "form_printed_at" not in await db.orders.find_one({"_id": "ord_b"})
        assert all(query["company_id"] == CO_A for query, _result in seen)
        assert sum(result.modified_count for _query, result in seen) == 1

    try:
        _run(run())
    finally:
        _restore(prev)


@pytest.mark.parametrize("kind", ["flags", "labels", "form"])
def test_multi_company_user_can_select_member_company(kind):
    """Üye olunan firma gövdede seçilirse resolve_company_id o firmayı kullanır."""
    db, seen, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A, CO_B, active=CO_A, role="accountant")
        if kind == "flags":
            out = await _call(kind, ["prod_a", "prod_b"], user, CO_B, show_in_b2b=False)
            assert out["matched"] == 1
            assert out["modified"] == 1
            own = await db.products.find_one({"_id": "prod_a"})
            other = await db.products.find_one({"_id": "prod_b"})
            assert own["show_in_b2b"] is True
            assert other["show_in_b2b"] is False
        elif kind == "labels":
            out = await _call(kind, ["ord_a", "ord_b"], user, CO_B)
            assert out["count"] == 1
            assert "label_printed_at" not in await db.orders.find_one({"_id": "ord_a"})
            assert (await db.orders.find_one({"_id": "ord_b"})).get("label_printed_at")
        else:
            out = await _call(kind, ["ord_a", "ord_b"], user, CO_B)
            assert out["count"] == 1
            assert "form_printed_at" not in await db.orders.find_one({"_id": "ord_a"})
            assert (await db.orders.find_one({"_id": "ord_b"})).get("form_printed_at")
        assert all(query["company_id"] == CO_B for query, _result in seen)

    try:
        _run(run())
    finally:
        _restore(prev)


def test_foreign_company_outside_accountant_membership_is_forbidden():
    db, seen, prev = _bind()

    async def run():
        await _seed(db)
        products_before = copy.deepcopy(db.products.docs)
        user = _user(CO_A, CO_B, active=CO_A, role="accountant")
        with pytest.raises(HTTPException) as exc:
            await _call("flags", ["prod_b"], user, CO_C, show_in_b2b=False)
        assert exc.value.status_code == 403
        assert db.products.docs == products_before
        assert seen == []

    try:
        _run(run())
    finally:
        _restore(prev)


def test_bulk_flags_chunks_always_filter_company():
    """Parça parça update_many her parçada company_id taşır; yabancı kimlik yazılmaz."""
    db, seen, prev = _bind()

    async def run():
        own_ids = [f"pa{i}" for i in range(server.BULK_FLAGS_CHUNK + 1)]
        for pid in own_ids:
            await db.products.insert_one({
                "_id": pid,
                "company_id": CO_A,
                "show_in_b2b": True,
                "track_stock": True,
            })
        await db.products.insert_one({
            "_id": "prod_b",
            "company_id": CO_B,
            "show_in_b2b": True,
            "track_stock": True,
        })
        user = _user(CO_A)
        out = await server.bulk_product_flags(
            {"ids": own_ids + ["prod_b"], "show_in_b2b": False, "track_stock": False},
            user,
        )
        assert out["status"] == "success"
        assert out["matched"] == len(own_ids)
        assert out["modified"] == len(own_ids)
        assert out["count"] == len(own_ids) + 1
        assert len(seen) == 2
        covered = []
        for query, result in seen:
            assert query["company_id"] == CO_A
            part = list(query["_id"]["$in"])
            covered.extend(part)
            foreign_in_part = sum(1 for item in part if item == "prod_b")
            assert result.matched_count == len(part) - foreign_in_part
            assert result.modified_count == result.matched_count
        assert set(covered) == set(own_ids) | {"prod_b"}
        foreign = await db.products.find_one({"_id": "prod_b"})
        assert foreign["show_in_b2b"] is True
        assert foreign["track_stock"] is True
        sample = await db.products.find_one({"_id": own_ids[0]})
        tail = await db.products.find_one({"_id": own_ids[-1]})
        assert sample["show_in_b2b"] is False
        assert tail["show_in_b2b"] is False
        assert tail["track_stock"] is False

    try:
        _run(run())
    finally:
        _restore(prev)


def test_empty_ids_stay_400():
    db, seen, prev = _bind()

    async def run():
        user = _user(CO_A)
        with pytest.raises(HTTPException) as flags_exc:
            await server.bulk_product_flags({"ids": [], "show_in_b2b": False}, user)
        assert flags_exc.value.status_code == 400
        with pytest.raises(HTTPException) as form_exc:
            await server.mark_form_printed({"ids": []}, user)
        assert form_exc.value.status_code == 400
        with pytest.raises(HTTPException) as blank_exc:
            await server.mark_form_printed({"ids": ["", None]}, user)
        assert blank_exc.value.status_code == 400
        assert seen == []

    try:
        _run(run())
    finally:
        _restore(prev)
