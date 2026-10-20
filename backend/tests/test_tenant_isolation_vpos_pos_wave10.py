"""Sanal POS tahsilatı ve kasa kiracı dalgası 10. Bellek içi MemDB.

Canlı veritabanına, 8021'deki sunucuya, ağa ve gerçek sağlayıcıya bağlanmaz.
Kart numarası, CVV, son kullanma ve sağlayıcı ham yanıtı loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import pos_cashier as pc  # noqa: E402
import public_url  # noqa: E402
import rbac  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import vpos.api as vpos_api  # noqa: E402
import vpos.collect as collect  # noqa: E402
from auth_utils import hash_password  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
INTENT = "intent-shared"
CFG = "cfg-shared"
ACCT = "acct-shared"
CONTACT = "contact-shared"
TX = "vpos:intent-shared"
FEE = "vpos:intent-shared:fee"
SESS = "sess-shared"
SHIFT = "shift-shared"
APPR = "appr-shared"
HOLD = "hold-shared"
ROLE = "role-shared"
PROD = "prod-shared"
PAN = "4531440099991234"
CVV = "cvvX7421Z"
EXPIRY = "12/29"
_CARD_KEYS = {"pan", "cvv", "expiry", "card_number", "expire_month", "expire_year"}

_REMOVED = (
    ("pos_cashier.py", "_apply_payload", "pos_sessions", "update_one"),
    ("pos_cashier.py", "_open_cashier_session", "pos_sessions", "update_one"),
    ("pos_cashier.py", "_restore_snapshot", "pos_sessions", "update_one"),
    ("pos_cashier.py", "_write_event", "pos_events", "insert_one"),
    ("pos_cashier.py", "cancel_sale", "pos_shifts", "update_one"),
    ("pos_cashier.py", "close_shift", "pos_shifts", "find_one"),
    ("pos_cashier.py", "close_shift", "pos_shifts", "update_one"),
    ("pos_cashier.py", "consume_kind_approval", "pos_approvals", "update_one"),
    ("pos_cashier.py", "decide_approval", "pos_approvals", "update_one"),
    ("pos_cashier.py", "decide_approval", "pos_sessions", "find_one"),
    ("pos_cashier.py", "get_session", "pos_approvals", "find"),
    ("pos_cashier.py", "get_session", "pos_sessions", "update_one"),
    ("pos_cashier.py", "get_session", "pos_shifts", "find_one"),
    ("pos_cashier.py", "hold_cart", "pos_sessions", "update_one"),
    ("pos_cashier.py", "on_checkout_done", "pos_sessions", "update_one"),
    ("pos_cashier.py", "on_checkout_done", "pos_shifts", "update_one"),
    ("pos_cashier.py", "on_return_done", "pos_shifts", "update_one"),
    ("pos_cashier.py", "open_shift", "pos_sessions", "update_one"),
    ("pos_cashier.py", "preflight_checkout", "products", "find_one"),
    ("pos_cashier.py", "put_cart", "pos_sessions", "update_one"),
    ("pos_cashier.py", "put_cart", "products", "find_one"),
    ("pos_cashier.py", "put_pos_rules", "roles", "update_one"),
    ("pos_cashier.py", "require_session", "pos_sessions", "update_one"),
    ("pos_cashier.py", "resume_hold", "pos_held_carts", "delete_one"),
    ("pos_cashier.py", "resume_hold", "pos_sessions", "update_one"),
    ("pos_cashier.py", "session_exit", "pos_sessions", "update_one"),
    ("pos_cashier.py", "session_lock", "pos_sessions", "update_one"),
    ("pos_cashier.py", "session_ping", "pos_sessions", "update_one"),
    ("pos_cashier.py", "session_unlock", "pos_sessions", "update_one"),
    ("vpos/api.py", "_record_paid_collection", "payment_intents", "find_one"),
    ("vpos/api.py", "_result_redirect", "contacts", "find_one"),
    ("vpos/api.py", "_result_redirect", "payment_intents", "find_one"),
    ("vpos/api.py", "_retry_paid_collection", "payment_intents", "find_one"),
    ("vpos/api.py", "iyzico_callback", "vpos_configs", "find_one"),
    ("vpos/api.py", "put_vpos_config", "vpos_configs", "update_one"),
    ("vpos/api.py", "vpos_callback", "vpos_configs", "find_one"),
    ("vpos/collect.py", "_apply_balances", "bank_accounts", "update_one"),
    ("vpos/collect.py", "_apply_balances", "bank_transactions", "find_one"),
    ("vpos/collect.py", "_apply_balances", "contacts", "update_one"),
    ("vpos/collect.py", "_drop_if_unsettled", "bank_transactions", "delete_one"),
    ("vpos/collect.py", "_drop_if_unsettled", "bank_transactions", "find_one"),
    ("vpos/collect.py", "_ensure_fee", "bank_accounts", "update_one"),
    ("vpos/collect.py", "_ensure_fee", "bank_transactions", "find_one"),
    ("vpos/collect.py", "_ensure_fee", "bank_transactions", "update_one"),
    ("vpos/collect.py", "_link", "payment_intents", "update_one"),
    ("vpos/collect.py", "_notify_b2b_collection", "contacts", "find_one"),
    ("vpos/collect.py", "_notify_b2b_collection", "payment_intents", "update_one"),
    ("vpos/collect.py", "_save_effects", "bank_transactions", "update_one"),
    ("vpos/collect.py", "post_collection", "bank_accounts", "find_one"),
    ("vpos/collect.py", "post_collection", "bank_transactions", "find_one"),
    ("vpos/collect.py", "post_collection", "contacts", "find_one"),
    ("vpos/collect.py", "post_collection", "payment_intents", "update_one"),
    ("vpos/collect.py", "post_collection", "vpos_configs", "find_one"),
)
_KEPT = (
    ("vpos/api.py", "_allocate_order_id", "payment_intents", "find_one"),
    ("vpos/api.py", "iyzico_callback", "payment_intents", "find_one"),
    ("vpos/api.py", "paytr_notify", "payment_intents", "find_one"),
    ("vpos/api.py", "paytr_notify", "vpos_configs", "find_one"),
    ("vpos/api.py", "vpos_callback", "payment_intents", "find_one"),
)
_NOTES = (
    "# tenant-ok değil: banka okUrl/failUrl geri çağrısı oturumsuz; company_id intent'ten çıkar, ardından cfg.company_id ile eşleşme (company_mismatch) ve hash doğrulanır.",
    "# tenant-ok değil: iyzico Checkout Form dönüşü oturumsuz; company_id intent'ten çıkar, ardından cfg.company_id ile eşleşme (company_mismatch) ve token + retrieve yanıtı doğrulanır.",
    "# tenant-ok değil: PayTR sunucu bildirimi oturumsuz; config_id URL'den gelir, şirket cfg'den çözülür ve hash bu cfg sırlarıyla doğrulanır.",
    "# tenant-ok değil: PayTR yalnız merchant_oid döner; intent order_id ile bulunur, sonra vpos_config_id + company_id eşleşmesi (same) şart. order_id global benzersiz olduğundan şirket filtresi anlamsız; yine de hash doğrulamasından SONRA çalışır.",
    "# tenant-ok değil: order_id tüm platformda benzersiz olmalı (paytr_notify yalnız order_id ile arar); şirket filtresi eklemek çakışma riskini açar. Okuma yalnız varlık kontrolü, belge döndürmez.",
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id, role="admin"):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


class _Coll(MemColl):
    async def delete_one(self, query=None):
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[i]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


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
    def __init__(self, form=None, ip="203.0.113.8", path="/api/vpos/callback/intent-shared"):
        self._form = form or {}
        self.client = SimpleNamespace(host=ip)
        self.headers = {}
        self.method = "POST"
        self.url = SimpleNamespace(path=path)
        self.query_params = {}

    async def form(self):
        return self._form


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _doc(db, coll, doc_id, company_id):
    for row in db[coll].docs:
        if row.get("_id") == doc_id and row.get("company_id") == company_id:
            return row
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


def _bind(db):
    prev = (pc._db, vpos_api._db, rbac._db, dict(pc._checkout_hooks))
    pc.init(db)
    vpos_api.init(db)
    rbac.init(db, None, None)
    return prev


def _unbind(prev):
    pc._db, vpos_api._db, rbac._db, pc._checkout_hooks = prev


def _now():
    return datetime.now(timezone.utc).isoformat()


def _pair_money(db):
    """B önce: kapsamsız ilk eşleşme B'yi vurur."""
    _add(db, "bank_accounts", {
        "_id": ACCT, "company_id": CO_B, "type": "pos", "account_name": "POS B", "current_balance": 9000.0,
    })
    _add(db, "bank_accounts", {
        "_id": ACCT, "company_id": CO_A, "type": "pos", "account_name": "POS A", "current_balance": 1000.0,
    })
    _add(db, "contacts", {
        "_id": CONTACT, "company_id": CO_B, "name": "Cari B", "balance": 500.0, "b2b_token": "token-b",
    })
    _add(db, "contacts", {
        "_id": CONTACT, "company_id": CO_A, "name": "Cari A", "balance": 100.0, "b2b_token": "token-a",
    })
    _add(db, "vpos_configs", {
        "_id": CFG, "company_id": CO_B, "family": "nestpay", "account_id": ACCT, "enabled": True,
    })
    _add(db, "vpos_configs", {
        "_id": CFG, "company_id": CO_A, "family": "nestpay", "account_id": ACCT, "enabled": True,
    })


def _intent(company_id, **extra):
    doc = {
        "_id": INTENT,
        "company_id": company_id,
        "purpose": "b2b_collection",
        "status": "paid",
        "amount": "30.00",
        "ledger_amount": "25.00",
        "commission_payer": "buyer",
        "contact_id": CONTACT,
        "vpos_config_id": CFG,
        "description": "Kart",
        "order_id": "order-" + company_id,
    }
    doc.update(extra)
    return doc


def _tx(company_id, amount, effects=None):
    return {
        "_id": TX,
        "company_id": company_id,
        "account_id": ACCT,
        "contact_id": CONTACT,
        "amount": amount,
        "effects": effects or {"account": False, "contact": False, "fee": False},
        "mark": company_id,
    }


def _fee(company_id):
    return {
        "_id": FEE,
        "company_id": company_id,
        "account_id": ACCT,
        "amount": 5.0,
        "effects": {"account": False},
        "mark": company_id,
    }


def _rules():
    return dict(pc.OPEN_DEFAULT)


def _sess(company_id, *, locked=False, items=True, shift_id=SHIFT, last=None):
    cart_items = []
    if items:
        cart_items.append({
            "id": "l1", "product_id": PROD, "name": company_id, "quantity": 1, "unit_price": 10,
        })
    return {
        "_id": SESS,
        "company_id": company_id,
        "terminal_id": "t1",
        "cashier_user_id": "user-a",
        "cashier_name": "Ayse",
        "cashier_role": "sales",
        "rules": _rules(),
        "cart": {"items": cart_items, "customer_name": company_id},
        "locked": locked,
        "exit_granted": True,
        "shift_id": shift_id,
        "last_activity": last or _now(),
        "ended_at": None,
        "mark": company_id,
    }


def _shift(company_id, **extra):
    doc = {
        "_id": SHIFT,
        "company_id": company_id,
        "cashier_user_id": "user-a",
        "cashier_name": company_id,
        "status": "open",
        "opening_cash": 77.0 if company_id == CO_B else 10.0,
        "sales_cash": 0.0,
        "sales_card": 0.0,
        "sales_credit": 0.0,
        "sales_count": 0,
        "refunds_amount": 0.0,
        "refunds_count": 0,
        "cancels_count": 0,
        "mark": company_id,
    }
    doc.update(extra)
    return doc


def _pair_pos(db, *, shifts=True):
    _add(db, "companies", {"_id": CO_B, "name": "B", "pos_idle_timeout_sec": 600})
    _add(db, "companies", {"_id": CO_A, "name": "A", "pos_idle_timeout_sec": 600})
    _add(db, "products", {"_id": PROD, "company_id": CO_B, "name": "Urun B", "sale_price": 1, "stock_quantity": 0, "type": "product"})
    _add(db, "products", {"_id": PROD, "company_id": CO_A, "name": "Urun A", "sale_price": 10, "stock_quantity": 20, "type": "product"})
    _add(db, "roles", {"_id": ROLE, "company_id": CO_B, "code": "pos_custom", "name": "Satış B", "pos_rules": {"max_discount_pct": 9}})
    _add(db, "roles", {"_id": ROLE, "company_id": CO_A, "code": "pos_custom", "name": "Satış A", "pos_rules": {"max_discount_pct": 5}})
    _add(db, "pos_sessions", _sess(CO_B))
    _add(db, "pos_sessions", _sess(CO_A))
    if shifts:
        _add(db, "pos_shifts", _shift(CO_B))
        _add(db, "pos_shifts", _shift(CO_A))
    _add(db, "pos_approvals", {
        "_id": APPR, "company_id": CO_B, "status": "pending", "kind": "cancel_cart",
        "session_id": SESS, "requested_by": "other", "summary": "B", "payload": {},
        "snapshot": {"items": [{"id": "b"}], "customer_name": "B"}, "mark": CO_B,
    })
    _add(db, "pos_approvals", {
        "_id": APPR, "company_id": CO_A, "status": "pending", "kind": "cancel_cart",
        "session_id": SESS, "requested_by": "other", "summary": "A", "payload": {},
        "snapshot": {"items": [{"id": "a"}], "customer_name": "A"}, "mark": CO_A,
    })
    _add(db, "pos_held_carts", {
        "_id": HOLD, "company_id": CO_B, "cashier_user_id": "user-a", "label": "hold-b",
        "cart": {"items": [{"id": "hb", "name": "B"}], "customer_name": "B"}, "mark": CO_B,
    })
    _add(db, "pos_held_carts", {
        "_id": HOLD, "company_id": CO_A, "cashier_user_id": "user-a", "label": "hold-a",
        "cart": {"items": [{"id": "ha", "name": "A"}], "customer_name": "A"}, "mark": CO_A,
    })
    _add(db, "users", {
        "_id": "user-a", "name": "Ayse", "role": "sales", "is_active": True, "is_super_admin": False,
        "company_ids": [CO_A], "active_company_id": CO_A, "cashier_pin_hash": hash_password("1234"),
    })


def _card_hits(docs):
    bad = []

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if str(key).lower() in _CARD_KEYS:
                    bad.append(key)
                if isinstance(value, str) and (PAN in value or CVV in value or EXPIRY in value):
                    bad.append(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for doc in docs:
        walk(doc)
    return bad


def test_post_collection_leaves_other_company(caplog):
    db = _DB()
    _pair_money(db)
    _add(db, "bank_transactions", _tx(CO_B, 77.0))
    _add(db, "bank_transactions", _fee(CO_B))
    _add(db, "payment_intents", _intent(CO_B, amount="9.00", ledger_amount="9.00"))
    _add(db, "payment_intents", _intent(CO_A))
    notes = []

    async def _note(_db, doc):
        notes.append(doc)
        return doc

    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        passed = _intent(CO_A, result={
            "pan": PAN, "cvv": CVV, "expiry": EXPIRY,
            "masked_pan": "453144******1234", "auth_code": "A1",
        })
        with caplog.at_level(logging.DEBUG):
            with patch("notify.insert_notification", _note):
                _run(collect.post_collection(db, passed))
    finally:
        _unbind(prev)
    assert _doc(db, "bank_accounts", ACCT, CO_A)["current_balance"] == 1030.0
    assert _doc(db, "contacts", CONTACT, CO_A)["balance"] == 75.0
    assert _doc(db, "bank_accounts", ACCT, CO_B)["current_balance"] == 9000.0
    assert _doc(db, "contacts", CONTACT, CO_B)["balance"] == 500.0
    assert _doc(db, "bank_transactions", TX, CO_B)["amount"] == 77.0
    assert _doc(db, "bank_transactions", TX, CO_B)["mark"] == CO_B
    fee_a = _doc(db, "bank_transactions", FEE, CO_A)
    assert fee_a["company_id"] == CO_A
    assert fee_a["effects"]["account"] is True
    assert _doc(db, "bank_transactions", FEE, CO_B)["effects"]["account"] is False
    assert _doc(db, "payment_intents", INTENT, CO_A)["collection_tx_id"] == TX
    assert _doc(db, "payment_intents", INTENT, CO_A).get("collection_notified") is True
    assert "collection_tx_id" not in _doc(db, "payment_intents", INTENT, CO_B)
    assert notes and notes[0]["company_id"] == CO_A
    assert "Cari A" in notes[0]["message"]
    assert "Cari B" not in notes[0]["message"]
    stored = db.bank_transactions.docs + db.payment_intents.docs
    assert _card_hits(stored) == []
    assert _doc(db, "bank_transactions", TX, CO_A)["masked_pan"] == "453144******1234"
    assert _doc(db, "bank_transactions", TX, CO_A)["auth_code"] == "A1"
    assert PAN not in caplog.text
    assert CVV not in caplog.text
    assert EXPIRY not in caplog.text
    assert _digest(db, CO_B) == before


def test_post_collection_without_company_writes_nothing():
    db = _DB()
    _pair_money(db)
    _add(db, "payment_intents", _intent(CO_A))
    _add(db, "payment_intents", _intent(CO_B))
    prev = _bind(db)
    try:
        before_a = _digest(db, CO_A)
        before_b = _digest(db, CO_B)
        blank = _intent(CO_A)
        blank.pop("company_id")
        _run(collect.post_collection(db, blank))
        empty = _intent(CO_A)
        empty["company_id"] = ""
        _run(collect.post_collection(db, empty))
        missing = _intent(CO_A)
        missing["company_id"] = None
        _run(collect.post_collection(db, missing))
        _run(collect._link(db, INTENT, TX, company_id=""))
        _run(collect._link(db, INTENT, TX, company_id=None))
        _run(collect._save_effects(db, TX, {"account": True, "contact": True}, company_id=""))
        _run(collect._save_effects(db, TX, {"account": True, "contact": True}, company_id=None))
        _run(collect._ensure_fee(db, {"company_id": "", "amount": 5, "intent_id": INTENT, "account_id": ACCT}, company_id=""))
        _run(collect._ensure_fee(db, {"company_id": CO_A, "amount": 5, "intent_id": INTENT, "account_id": ACCT}, company_id=""))
        _run(collect._ensure_fee(db, {"amount": 5, "intent_id": INTENT, "account_id": ACCT}, company_id=CO_A))
        _run(collect._apply_balances(db, TX, ACCT, CONTACT, 25, company_id=""))
        _run(collect._apply_balances(db, TX, ACCT, CONTACT, 25, company_id=None))
        _run(collect._drop_if_unsettled(db, TX, company_id=""))
        _run(collect._drop_if_unsettled(db, TX, company_id=None))
        _run(collect._notify_b2b_collection(db, _intent(CO_A), company_id=""))
        mismatched = _intent(CO_A)
        mismatched["company_id"] = ""
        _run(collect._notify_b2b_collection(db, mismatched, company_id=CO_A))
    finally:
        _unbind(prev)
    assert db.bank_transactions.docs == []
    assert "collection_error" not in _doc(db, "payment_intents", INTENT, CO_A)
    assert "collection_tx_id" not in _doc(db, "payment_intents", INTENT, CO_A)
    assert _digest(db, CO_A) == before_a
    assert _digest(db, CO_B) == before_b


def test_record_and_redirect_use_loaded_company():
    db = _DB()
    _pair_money(db)
    _add(db, "payment_intents", _intent(CO_B, purpose="contact_collection", amount="40.00", ledger_amount="40.00"))
    _add(db, "payment_intents", _intent(CO_A, purpose="contact_collection", amount="25.00", ledger_amount="25.00"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        _run(vpos_api._record_paid_collection(INTENT, company_id=CO_A))
        _run(vpos_api._record_paid_collection(INTENT, company_id=""))
        _run(vpos_api._record_paid_collection(INTENT, company_id=None))
    finally:
        _unbind(prev)
    assert _doc(db, "bank_accounts", ACCT, CO_A)["current_balance"] == 1025.0
    assert _doc(db, "contacts", CONTACT, CO_A)["balance"] == 75.0
    assert _doc(db, "payment_intents", INTENT, CO_A)["collection_tx_id"] == TX
    assert _digest(db, CO_B) == before

    db = _DB()
    _pair_money(db)
    _add(db, "payment_intents", _intent(
        CO_B, purpose="contact_collection", amount="40.00", ledger_amount="40.00",
        collection_error="post_failed",
    ))
    _add(db, "payment_intents", _intent(
        CO_A, purpose="contact_collection", amount="25.00", ledger_amount="25.00",
        collection_error="post_failed",
    ))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        _run(vpos_api._retry_paid_collection(INTENT, company_id=CO_A))
        _run(vpos_api._retry_paid_collection(INTENT, company_id=""))
    finally:
        _unbind(prev)
    assert _doc(db, "bank_accounts", ACCT, CO_A)["current_balance"] == 1025.0
    assert _doc(db, "payment_intents", INTENT, CO_B).get("collection_tx_id") is None
    assert _digest(db, CO_B) == before

    db = _DB()
    _pair_money(db)
    _add(db, "payment_intents", _intent(CO_B, source="b2b_portal", status="pending"))
    _add(db, "payment_intents", _intent(CO_A, source="b2b_portal", status="pending"))
    prev = _bind(db)
    try:
        async def _go():
            hit = await vpos_api._result_redirect("https://app.example.com", INTENT, company_id=CO_A)
            quiet = await vpos_api._result_redirect("https://app.example.com", INTENT, company_id="")
            return hit, quiet
        with patch.object(public_url, "public_base_url_for", _fake_base):
            hit, quiet = _run(_go())
    finally:
        _unbind(prev)
    assert hit.status_code == 303
    assert "token-a" in hit.headers["location"]
    assert "token-b" not in hit.headers["location"]
    assert quiet.status_code == 303
    assert quiet.headers["location"] == "https://app.example.com/vpos/result/" + INTENT


async def _fake_base(*_args, **_kwargs):
    return "https://b2b.example.com"


def test_vpos_callback_cfg_company_mismatch_skips_other_company():
    db = _DB()
    _pair_money(db)
    later = (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()
    # Oturumsuz geri çağrı intent'i _id ile okur; A önde kalsın ki yüklenen belge A olsun.
    _add(db, "payment_intents", _intent(
        CO_A, status="pending", expires_at=later, purpose="contact_collection", vpos_config_id=CFG,
    ))
    _add(db, "payment_intents", _intent(CO_B, status="pending", expires_at=later, purpose="contact_collection"))
    # A'nın cfg satırını kaldır: intent CO_B cfg kimliğini gösterir, şirket filtresi bulamaz.
    db.vpos_configs.docs = [row for row in db.vpos_configs.docs if row.get("company_id") != CO_A]
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        vpos_api.reset_callback_rate_limit()
        with patch.object(public_url, "public_base_url_for", _fake_base):
            resp = _run(vpos_api.vpos_callback(INTENT, _Req()))
    finally:
        _unbind(prev)
    assert resp.status_code == 303
    assert _doc(db, "payment_intents", INTENT, CO_A)["status"] == "failed"
    assert _doc(db, "payment_intents", INTENT, CO_A)["result"]["error"] == "company_mismatch"
    assert _doc(db, "payment_intents", INTENT, CO_B)["status"] == "pending"
    assert _doc(db, "vpos_configs", CFG, CO_B)["enabled"] is True
    assert db.bank_transactions.docs == []
    assert _digest(db, CO_B) == before


def test_write_event_keeps_caller_company():
    db = _DB()
    prev = _bind(db)
    try:
        doc = _run(pc._write_event(CO_A, kind="sale", summary="satis", extra={"company_id": CO_B, "note": "x"}))
    finally:
        _unbind(prev)
    assert doc["company_id"] == CO_A
    assert doc["note"] == "x"
    assert db.pos_events.docs[0]["company_id"] == CO_A
    assert db.activity_logs.docs[0]["company_id"] == CO_A
    assert all(row.get("company_id") != CO_B for row in db.pos_events.docs)


def test_pos_actions_leave_other_company():
    user = _user(CO_A)

    async def _own(db_arg, collection, doc_id, actor, **kwargs):
        allowed = {str(item) for item in (actor.get("company_ids") or [])}
        for row in db_arg[collection].docs:
            if str(row.get("_id")) == str(doc_id) and str(row.get("company_id") or "") in allowed:
                return copy.deepcopy(row)
        raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Kayıt bulunamadı.")

    def _case(build):
        db = _DB()
        _pair_pos(db)
        prev = _bind(db)
        try:
            before = _digest(db, CO_B)
            with patch.object(pc.tenant_access, "get_tenant_doc", _own):
                _run(build(db))
        finally:
            _unbind(prev)
        assert _digest(db, CO_B) == before
        return db

    db = _case(lambda _db: pc.decide_approval(APPR, user, approve=True))
    assert _doc(db, "pos_approvals", APPR, CO_A)["status"] == "approved"
    assert _doc(db, "pos_approvals", APPR, CO_B)["status"] == "pending"
    assert _doc(db, "pos_sessions", SESS, CO_A)["cart"]["items"] == []
    assert _doc(db, "pos_sessions", SESS, CO_B)["cart"]["customer_name"] == CO_B

    db = _DB()
    _pair_pos(db)
    for row in db.pos_approvals.docs:
        if row["company_id"] == CO_A:
            row["kind"] = "price_change"
            row["status"] = "approved"
        else:
            row["kind"] = "price_change"
            row["status"] = "approved"
            row["mark"] = "keep"
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        consumed = _run(pc.consume_kind_approval(CO_A, {"_id": SESS}, "price_change"))
    finally:
        _unbind(prev)
    assert consumed is True
    assert _doc(db, "pos_approvals", APPR, CO_A)["consumed"] is True
    assert _doc(db, "pos_approvals", APPR, CO_B).get("consumed") is not True
    assert _doc(db, "pos_approvals", APPR, CO_B)["mark"] == "keep"
    assert _digest(db, CO_B) == before

    db = _case(lambda _db: pc.put_cart(
        {"company_id": CO_A, "terminal_id": "t1", "items": [{
            "id": "l1", "product_id": PROD, "name": "Urun A", "quantity": 1, "unit_price": 12,
        }]},
        user, None,
    ))
    assert _doc(db, "pos_sessions", SESS, CO_A)["cart"]["items"][0]["unit_price"] == 12
    assert _doc(db, "pos_sessions", SESS, CO_B)["cart"]["items"][0]["unit_price"] == 10
    assert _doc(db, "products", PROD, CO_B)["stock_quantity"] == 0

    db = _case(lambda _db: pc.hold_cart({"company_id": CO_A, "terminal_id": "t1"}, user, None))
    assert _doc(db, "pos_sessions", SESS, CO_A)["cart"]["items"] == []
    assert _doc(db, "pos_sessions", SESS, CO_B)["cart"]["items"]
    assert _doc(db, "pos_held_carts", HOLD, CO_B)["label"] == "hold-b"

    db = _case(lambda _db: _resume(user))
    assert _doc(db, "pos_held_carts", HOLD, CO_A) is None
    assert _doc(db, "pos_held_carts", HOLD, CO_B)["label"] == "hold-b"
    assert _doc(db, "pos_sessions", SESS, CO_A)["cart"]["items"][0]["id"] == "ha"
    assert _doc(db, "pos_sessions", SESS, CO_B)["cart"]["customer_name"] == CO_B

    db = _case(lambda _db: pc.session_lock({"company_id": CO_A, "terminal_id": "t1"}, user, None))
    assert _doc(db, "pos_sessions", SESS, CO_A)["locked"] is True
    assert _doc(db, "pos_sessions", SESS, CO_B)["locked"] is False

    db = _DB()
    _pair_pos(db)
    for row in db.pos_sessions.docs:
        row["locked"] = True
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        _run(pc.session_unlock({"company_id": CO_A, "terminal_id": "t1", "pin": "1234"}, user, None))
    finally:
        _unbind(prev)
    assert _doc(db, "pos_sessions", SESS, CO_A)["locked"] is False
    assert _doc(db, "pos_sessions", SESS, CO_B)["locked"] is True
    assert _digest(db, CO_B) == before

    db = _case(lambda _db: pc.session_ping({"company_id": CO_A, "terminal_id": "t1"}, user, None))
    assert _doc(db, "pos_sessions", SESS, CO_B)["mark"] == CO_B
    assert _doc(db, "pos_sessions", SESS, CO_A)["last_activity"] != _doc(db, "pos_sessions", SESS, CO_B)["last_activity"]

    db = _case(lambda _db: pc.session_exit({"company_id": CO_A, "terminal_id": "t1"}, user, None))
    assert _doc(db, "pos_sessions", SESS, CO_A)["ended_at"]
    assert _doc(db, "pos_sessions", SESS, CO_B)["ended_at"] is None

    db = _DB()
    _pair_pos(db, shifts=False)
    _add(db, "pos_shifts", _shift(CO_B))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        _run(pc.open_shift({"company_id": CO_A, "terminal_id": "t1", "opening_cash": 3}, user, None))
    finally:
        _unbind(prev)
    assert _doc(db, "pos_sessions", SESS, CO_A)["shift_id"] != SHIFT
    assert _doc(db, "pos_sessions", SESS, CO_B)["shift_id"] == SHIFT
    assert _doc(db, "pos_shifts", SHIFT, CO_B)["opening_cash"] == 77.0
    assert _digest(db, CO_B) == before

    db = _case(lambda _db: pc.close_shift(SHIFT, {"company_id": CO_A, "counted_cash": 10, "counted_card": 0}, user))
    assert _doc(db, "pos_shifts", SHIFT, CO_A)["status"] == "closed"
    assert _doc(db, "pos_shifts", SHIFT, CO_B)["status"] == "open"
    assert _doc(db, "pos_shifts", SHIFT, CO_B)["opening_cash"] == 77.0

    async def _cancel(payload):
        return {"status": "cancelled", "company_id": payload.get("company_id")}

    db = _DB()
    _pair_pos(db)
    prev = _bind(db)
    pc._checkout_hooks["do_cancel_sale"] = _cancel
    try:
        before = _digest(db, CO_B)
        out = _run(pc.cancel_sale({"company_id": CO_A, "terminal_id": "t1", "invoice_id": "inv-a"}, user, None))
    finally:
        _unbind(prev)
    assert out["status"] == "cancelled"
    assert _doc(db, "pos_shifts", SHIFT, CO_A)["cancels_count"] == 1
    assert _doc(db, "pos_shifts", SHIFT, CO_B)["cancels_count"] == 0
    assert _digest(db, CO_B) == before

    db = _case(lambda _db: pc.put_pos_rules(
        {"company_id": CO_A, "roles": [{"id": ROLE, "pos_rules": {"max_discount_pct": 40}}]},
        user,
    ))
    assert _doc(db, "roles", ROLE, CO_A)["pos_rules"]["max_discount_pct"] == 40
    assert _doc(db, "roles", ROLE, CO_B)["pos_rules"]["max_discount_pct"] == 9

    invoice = {"_id": "inv-a", "company_id": CO_A, "invoice_number": "SF-A", "grand_total": 40}
    meta = {"session": _sess(CO_A), "shift_id": SHIFT, "payment_method": "cash"}
    db = _case(lambda _db: pc.on_checkout_done(user, invoice, meta))
    assert _doc(db, "pos_sessions", SESS, CO_A)["cart"]["items"] == []
    assert _doc(db, "pos_shifts", SHIFT, CO_A)["sales_count"] == 1
    assert _doc(db, "pos_shifts", SHIFT, CO_A)["sales_cash"] == 40
    assert _doc(db, "pos_sessions", SESS, CO_B)["cart"]["items"]
    assert _doc(db, "pos_shifts", SHIFT, CO_B)["sales_count"] == 0

    original = {"_id": "inv-b", "company_id": CO_A, "invoice_number": "SF-B", "grand_total": 15}
    ret = {"_id": "inv-r", "company_id": CO_A, "invoice_number": "IA-1"}
    db = _case(lambda _db: pc.on_return_done(user, original, ret, {"shift_id": SHIFT}))
    assert _doc(db, "pos_shifts", SHIFT, CO_A)["refunds_count"] == 1
    assert _doc(db, "pos_shifts", SHIFT, CO_A)["refunds_amount"] == 15
    assert _doc(db, "pos_shifts", SHIFT, CO_B)["refunds_count"] == 0

    db = _DB()
    _pair_pos(db)
    prev = _bind(db)
    try:
        before_b = _digest(db, CO_B)
        before_cart = copy.deepcopy(_doc(db, "pos_sessions", SESS, CO_A)["cart"])
        before_shift = copy.deepcopy(_doc(db, "pos_shifts", SHIFT, CO_A))
        _run(pc.on_checkout_done(user, {"invoice_number": "X", "grand_total": 9}, meta))
        _run(pc.on_return_done(user, {"invoice_number": "Y", "grand_total": 4}, ret, {"shift_id": SHIFT}))
    finally:
        _unbind(prev)
    assert _doc(db, "pos_sessions", SESS, CO_A)["cart"] == before_cart
    assert _doc(db, "pos_shifts", SHIFT, CO_A)["sales_count"] == before_shift["sales_count"]
    assert _doc(db, "pos_shifts", SHIFT, CO_A)["refunds_count"] == before_shift["refunds_count"]
    assert _digest(db, CO_B) == before_b

    db = _DB()
    _pair_pos(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(pc.preflight_checkout(user, {
            "company_id": CO_A,
            "items": [{"product_id": PROD, "quantity": 2, "unit_price": 10}],
            "payment_method": "cash",
        }))
    finally:
        _unbind(prev)
    assert out["company_id"] == CO_A
    assert _doc(db, "products", PROD, CO_B)["stock_quantity"] == 0
    assert _doc(db, "products", PROD, CO_B)["name"] == "Urun B"
    assert _digest(db, CO_B) == before


async def _resume(user):
    db_sess = None
    # resume_hold reads the bound db; empty the caller cart so only the hold is restored.
    for row in pc._db.pos_sessions.docs:
        if row.get("company_id") == CO_A:
            row["cart"] = {"items": [], "customer_name": CO_A}
            db_sess = row
    assert db_sess
    return await pc.resume_hold({"company_id": CO_A, "terminal_id": "t1", "hold_id": HOLD}, user, None)


def test_wave10_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 53
    assert len({key for key in _REMOVED}) == 53
    assert not any(key[0] == "server.py" for key in _REMOVED)
    for key in _KEPT:
        assert key in base
    text = Path(vpos_api.__file__).read_text(encoding="utf-8")
    for note in _NOTES:
        assert note in text
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
