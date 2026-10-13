"""POS kasiyer: fiyat, onaysız iptal, red rollback, çıkış ve yenileme atlatması."""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import pos_cashier as pc
from auth_utils import hash_password


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *a, **k):
        return self

    async def to_list(self, n):
        return self.rows[:n]


class FakeCol:
    def __init__(self):
        self.docs = {}

    async def find_one(self, q=None, *a, **k):
        q = q or {}
        for d in self.docs.values():
            if _match(d, q):
                return dict(d)
        return None

    def find(self, q=None, *a, **k):
        q = q or {}
        return FakeCursor([dict(d) for d in self.docs.values() if _match(d, q)])

    async def insert_one(self, doc):
        d = dict(doc)
        self.docs[d["_id"]] = d
        return MagicMock()

    async def update_one(self, q, upd):
        doc = None
        for d in self.docs.values():
            if _match(d, q):
                doc = d
                break
        if not doc:
            return MagicMock(matched_count=0)
        if "$set" in upd:
            doc.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                doc[k] = float(doc.get(k) or 0) + float(v)
        return MagicMock(matched_count=1)

    async def delete_one(self, q):
        for k, d in list(self.docs.items()):
            if _match(d, q):
                self.docs.pop(k)
                break
        return MagicMock()

    async def to_list(self, n):
        return list(self.docs.values())[:n]


def _match(doc, q):
    for k, v in (q or {}).items():
        if k == "$or":
            if not any(_match(doc, part) for part in v):
                return False
            continue
        if k == "$and":
            if not all(_match(doc, part) for part in v):
                return False
            continue
        dv = doc.get(k)
        if isinstance(v, dict):
            if "$in" in v and dv not in v["$in"]:
                return False
            if "$ne" in v and dv == v["$ne"]:
                return False
            if "$nin" in v and dv in v["$nin"]:
                return False
            if "$exists" in v:
                exists = k in doc and dv not in (None, "")
                if bool(v["$exists"]) != exists:
                    return False
            if "$gte" in v and str(dv or "") < str(v["$gte"]):
                return False
        elif isinstance(dv, list) and v in dv:
            continue
        elif dv != v:
            return False
    return True


class FakeDB:
    def __init__(self):
        self.users = FakeCol()
        self.roles = FakeCol()
        self.companies = FakeCol()
        self.pos_sessions = FakeCol()
        self.pos_approvals = FakeCol()
        self.pos_held_carts = FakeCol()
        self.pos_shifts = FakeCol()
        self.pos_events = FakeCol()
        self.activity_logs = FakeCol()
        self.products = FakeCol()
        self.notifications = FakeCol()
        self.push_tokens = FakeCol()


def _run(coro):
    return asyncio.run(coro)


CID = "comp_test_pos"


def _seed():
    db = FakeDB()
    sales_hash = hash_password("1234")
    mgr_hash = hash_password("9999")
    db.companies.docs[CID] = {"_id": CID, "name": "Test", "pos_idle_timeout_sec": 120}
    db.roles.docs["r_sales"] = {"_id": "r_sales", "company_id": CID, "code": "sales", "name": "Satış", "pos_rules": pc.RESTRICTED_DEFAULT, "permissions": {"/hizli-satis": "edit"}}
    db.roles.docs["r_admin"] = {"_id": "r_admin", "company_id": CID, "code": "admin", "name": "Yönetici", "pos_rules": pc.OPEN_DEFAULT, "permissions": {"/hizli-satis": "delete"}}
    db.users.docs["u_sales"] = {
        "_id": "u_sales", "name": "Kasiyer Ayşe", "email": "ayse@test", "role": "sales",
        "company_ids": [CID], "active_company_id": CID, "cashier_pin_hash": sales_hash, "is_active": True,
    }
    db.users.docs["u_mgr"] = {
        "_id": "u_mgr", "name": "Müdür", "email": "mudur@test", "role": "manager",
        "company_ids": [CID], "active_company_id": CID, "cashier_pin_hash": mgr_hash, "is_active": True,
    }
    db.products.docs["p1"] = {"_id": "p1", "company_id": CID, "name": "Çay", "sale_price": 100, "stock_quantity": 5}
    return db


def _init(db):
    pc.init(db, AsyncMock(return_value={"_id": "u_mgr", "role": "admin", "company_ids": [CID], "active_company_id": CID}))
    return db


def test_default_rules_cashier_cannot_change_price():
    r = pc.default_pos_rules("sales")
    assert r["can_change_price"] is False
    assert pc.price_change_needs_approval(r, 100, 130) is True
    assert pc.action_is_free(r, "price_change", {"catalog_price": 100, "unit_price": 130}) is False
    assert pc.action_is_free(pc.default_pos_rules("admin"), "price_change", {"catalog_price": 100, "unit_price": 130}) is True


def test_cancel_requires_approval():
    r = pc.default_pos_rules("sales")
    assert pc.action_is_free(r, "cancel_cart") is False
    assert pc.action_is_free(r, "cancel_sale") is False
    assert pc.action_is_free({**r, "can_cancel": True}, "cancel_cart") is True


def test_exit_blocked_and_refresh_keeps_lock():
    sess = {
        "cashier_user_id": "u_sales",
        "locked": False,
        "exit_granted": False,
        "rules": pc.RESTRICTED_DEFAULT,
        "last_activity": datetime.now(timezone.utc).isoformat(),
    }
    assert pc.exit_is_blocked(sess) is True
    assert pc.refresh_keeps_lock(sess) is True
    idle = dict(sess)
    idle["last_activity"] = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    assert pc.session_is_idle(idle, timeout_sec=120) is True
    assert pc.refresh_keeps_lock(idle, timeout_sec=120) is True
    opened = dict(sess)
    opened["exit_granted"] = True
    opened["ended_at"] = datetime.now(timezone.utc).isoformat()
    assert pc.refresh_keeps_lock(opened) is False


def test_restore_cart_on_reject():
    snap = {"items": [{"id": "a", "name": "Çay"}], "customer_name": "Perakende"}
    restored = pc.restore_cart_from_snapshot(snap)
    assert restored["items"][0]["name"] == "Çay"
    restored["items"].clear()
    assert snap["items"][0]["name"] == "Çay"


def test_pin_normalize():
    assert pc.normalize_pin("1234") == "1234"
    with pytest.raises(HTTPException):
        pc.normalize_pin("12")


def test_mixed_change():
    cash, card, change = pc.mixed_change(100, 40, 60, 50)
    assert cash == 40
    assert card == 60
    assert change == 10


def test_cashier_login_and_price_blocked_via_session():
    db = _init(_seed())

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.rbac, "ensure_roles", AsyncMock()):
            user = {"_id": "u_mgr", "role": "admin", "company_ids": [CID], "active_company_id": CID, "name": "Admin"}
            with patch.object(pc.tenant_access, "resolve_company_id", return_value=CID):
                data = await pc.session_login({"company_id": CID, "terminal_id": "t1", "pin": "1234"}, user, None)
            sess = data["session"]
            assert sess["cashier_name"] == "Kasiyer Ayşe"
            assert sess["rules"]["can_change_price"] is False
            assert pc.price_change_needs_approval(sess["rules"], 100, 150) is True
            return sess

    sess = _run(go())
    assert sess["cashier_user_id"] == "u_sales"


def test_cancel_without_approval_queues_and_reject_restores_cart():
    db = _init(_seed())

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.rbac, "ensure_roles", AsyncMock()), \
             patch.object(pc.notify, "insert_notification", AsyncMock()):
            user = {"_id": "u_mgr", "role": "admin", "company_ids": [CID], "active_company_id": CID, "name": "Admin"}
            with patch.object(pc.tenant_access, "resolve_company_id", return_value=CID):
                login = await pc.session_login({"company_id": CID, "terminal_id": "t1", "pin": "1234"}, user, None)
            sid = login["session"]["id"]
            cart = {"items": [{"id": "ln1", "name": "Çay", "unit_price": 100, "product_id": "p1"}], "customer_name": "P"}
            await db.pos_sessions.update_one({"_id": sid}, {"$set": {"cart": cart}})
            sess = await db.pos_sessions.find_one({"_id": sid})
            queued = await pc.maybe_gate(
                "cancel_cart", company_id=CID, session=sess, user=user,
                payload={}, summary="Sepet iptali",
            )
            assert queued["status"] == "pending_approval"
            sess_after = await db.pos_sessions.find_one({"_id": sid})
            assert len(sess_after["cart"]["items"]) == 1
            req_id = queued["request_id"]
            with patch.object(pc.tenant_access, "get_tenant_doc", AsyncMock(return_value=await db.pos_approvals.find_one({"_id": req_id}))):
                rejected = await pc.decide_approval(req_id, user, approve=False, pin="9999")
            assert rejected["status"] == "rejected"
            assert rejected["cart"]["items"][0]["name"] == "Çay"
            sess_final = await db.pos_sessions.find_one({"_id": sid})
            assert len(sess_final["cart"]["items"]) == 1
            events = list(db.pos_events.docs.values())
            assert any(e.get("kind") == "cancel_cart" and e.get("status") == "rejected" for e in events)
            return rejected

    _run(go())


def test_exit_without_permission_pending():
    db = _init(_seed())

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.rbac, "ensure_roles", AsyncMock()), \
             patch.object(pc.notify, "insert_notification", AsyncMock()), \
             patch.object(pc.tenant_access, "resolve_company_id", return_value=CID):
            user = {"_id": "u_mgr", "role": "admin", "company_ids": [CID], "active_company_id": CID, "name": "Admin"}
            await pc.session_login({"company_id": CID, "terminal_id": "t1", "pin": "1234"}, user, None)
            out = await pc.session_exit({"company_id": CID, "terminal_id": "t1"}, user, None)
            assert out["status"] == "pending_approval"
            sess = await db.pos_sessions.find_one({"terminal_id": "t1"})
            assert pc.exit_is_blocked(sess) is True
            assert pc.refresh_keeps_lock(sess) is True
            return out

    _run(go())


def test_preflight_blocks_cashier_price_change():
    db = _init(_seed())

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.rbac, "ensure_roles", AsyncMock()), \
             patch.object(pc.tenant_access, "resolve_company_id", return_value=CID):
            user = {"_id": "u_sales", "role": "sales", "company_ids": [CID], "active_company_id": CID, "name": "Ayşe"}
            req = {
                "company_id": CID,
                "payment_method": "cash",
                "items": [{"product_id": "p1", "quantity": 1, "unit_price": 150}],
            }
            with pytest.raises(HTTPException) as ei:
                await pc.preflight_checkout(user, req)
            assert ei.value.status_code == 403
            assert "Fiyat" in str(ei.value.detail) or "iskonto" in str(ei.value.detail).lower()

    _run(go())


def test_switch_cashier_holds_previous_cart():
    db = _init(_seed())
    db.users.docs["u_sales2"] = {
        "_id": "u_sales2", "name": "Kasiyer Ali", "email": "ali@test", "role": "sales",
        "company_ids": [CID], "active_company_id": CID, "cashier_pin_hash": hash_password("4321"),
        "is_active": True,
    }

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.rbac, "ensure_roles", AsyncMock()), \
             patch.object(pc.notify, "insert_notification", AsyncMock()), \
             patch.object(pc.tenant_access, "resolve_company_id", return_value=CID):
            user = {"_id": "u_mgr", "role": "admin", "company_ids": [CID], "active_company_id": CID, "name": "Admin"}
            login = await pc.session_login({"company_id": CID, "terminal_id": "t1", "pin": "1234"}, user, None)
            sid = login["session"]["id"]
            cart = {"items": [{"id": "ln1", "name": "Çay", "unit_price": 100, "product_id": "p1"}], "customer_name": "P"}
            await db.pos_sessions.update_one({"_id": sid}, {"$set": {"cart": cart}})
            switched = await pc.session_login({"company_id": CID, "terminal_id": "t1", "pin": "4321"}, user, None)
            assert switched["session"]["cashier_user_id"] == "u_sales2"
            holds = list(db.pos_held_carts.docs.values())
            assert any(h.get("cashier_user_id") == "u_sales" for h in holds)
            assert (holds[0]["cart"]["items"][0]["name"] == "Çay")
            return switched

    _run(go())


def test_reject_restores_mutated_session_cart():
    db = _init(_seed())

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.rbac, "ensure_roles", AsyncMock()), \
             patch.object(pc.notify, "insert_notification", AsyncMock()), \
             patch.object(pc.tenant_access, "resolve_company_id", return_value=CID):
            user = {"_id": "u_mgr", "role": "admin", "company_ids": [CID], "active_company_id": CID, "name": "Admin"}
            login = await pc.session_login({"company_id": CID, "terminal_id": "t1", "pin": "1234"}, user, None)
            sid = login["session"]["id"]
            cart = {"items": [{"id": "ln1", "name": "Çay", "unit_price": 100}], "customer_name": "P"}
            await db.pos_sessions.update_one({"_id": sid}, {"$set": {"cart": cart}})
            sess = await db.pos_sessions.find_one({"_id": sid})
            queued = await pc.maybe_gate(
                "cancel_cart", company_id=CID, session=sess, user=user,
                payload={}, summary="Sepet iptali",
            )
            await db.pos_sessions.update_one({"_id": sid}, {"$set": {"cart": pc.empty_cart()}})
            req_id = queued["request_id"]
            with patch.object(pc.tenant_access, "get_tenant_doc", AsyncMock(return_value=await db.pos_approvals.find_one({"_id": req_id}))):
                rejected = await pc.decide_approval(req_id, user, approve=False, pin="9999")
            assert rejected["status"] == "rejected"
            sess_final = await db.pos_sessions.find_one({"_id": sid})
            assert sess_final["cart"]["items"][0]["name"] == "Çay"
            assert sess_final.get("exit_granted") is False

    _run(go())


def test_approve_applies_delete_line():
    db = _init(_seed())

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.rbac, "ensure_roles", AsyncMock()), \
             patch.object(pc.notify, "insert_notification", AsyncMock()), \
             patch.object(pc.tenant_access, "resolve_company_id", return_value=CID):
            user = {"_id": "u_mgr", "role": "admin", "company_ids": [CID], "active_company_id": CID, "name": "Admin"}
            login = await pc.session_login({"company_id": CID, "terminal_id": "t1", "pin": "1234"}, user, None)
            sid = login["session"]["id"]
            cart = {"items": [{"id": "ln1", "name": "Çay"}, {"id": "ln2", "name": "Kahve"}], "customer_name": "P"}
            await db.pos_sessions.update_one({"_id": sid}, {"$set": {"cart": cart}})
            sess = await db.pos_sessions.find_one({"_id": sid})
            queued = await pc.maybe_gate(
                "delete_line", company_id=CID, session=sess, user=user,
                payload={"line_id": "ln1"}, summary="Satır silme",
            )
            with patch.object(pc.tenant_access, "get_tenant_doc", AsyncMock(return_value=await db.pos_approvals.find_one({"_id": queued["request_id"]}))):
                approved = await pc.decide_approval(queued["request_id"], user, approve=True, pin="9999")
            assert approved["status"] == "approved"
            sess_final = await db.pos_sessions.find_one({"_id": sid})
            assert [x["id"] for x in sess_final["cart"]["items"]] == ["ln2"]

    _run(go())


def test_daily_summary_notifies_admin():
    db = _init(_seed())

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.notify, "insert_notification", AsyncMock()) as ins:
            await db.pos_events.insert_one({
                "_id": "e1", "company_id": CID, "kind": "refund", "amount": 50,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.pos_events.insert_one({
                "_id": "e2", "company_id": CID, "kind": "cancel_cart", "amount": 20,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            out = await pc.send_daily_summary(CID, force=True)
            assert out["status"] == "sent"
            assert out["refunds"] == 1
            assert out["cancels"] == 1
            ins.assert_awaited()
            doc = ins.await_args.args[1]
            assert doc["type"] == "pos_daily_summary"

    _run(go())


def test_credit_sale_blocked_without_rule():
    db = _init(_seed())

    async def go():
        with patch.object(pc, "_db", db), patch.object(pc.rbac, "ensure_roles", AsyncMock()), \
             patch.object(pc.tenant_access, "resolve_company_id", return_value=CID):
            user = {"_id": "u_sales", "role": "sales", "company_ids": [CID], "active_company_id": CID, "name": "Ayşe"}
            req = {
                "company_id": CID,
                "payment_method": "credit",
                "items": [{"product_id": "p1", "quantity": 1, "unit_price": 100}],
            }
            with pytest.raises(HTTPException) as ei:
                await pc.preflight_checkout(user, req)
            assert ei.value.status_code == 403
            assert "Veresiye" in str(ei.value.detail)

    _run(go())
