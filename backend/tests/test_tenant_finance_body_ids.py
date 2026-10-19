"""Kasa/banka, ortak hareketi ve çek/senet: body id'leri kiracı şirketinde aranır.

Bellek içi MemDB. Canlı veritabanına, banka sağlayıcısına ve 8021'e bağlanmaz.
"""
from __future__ import annotations

import ast
import asyncio
import copy
import logging
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-tenant-finance-body-ids-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import cheques  # noqa: E402
import event_notify  # noqa: E402
import partner_pay  # noqa: E402
import rbac  # noqa: E402
import server  # noqa: E402
from dashboard_memdb import MemColl, MemDB  # noqa: E402
from models import BankAccount  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CO_C = "co_c"

B_COLS = (
    "bank_accounts",
    "bank_transactions",
    "partners",
    "partner_transactions",
    "contacts",
    "cheques",
    "cash_approval_requests",
)


def _run(coro):
    return asyncio.run(coro)


def _user(*company_ids, active=None, role="admin", super_admin=False):
    ids = list(company_ids)
    uid = "user-" + "-".join(ids) + ("-sa" if super_admin else "")
    return {
        "_id": uid,
        "id": uid,
        "email": uid + "@example.com",
        "name": "Kullanıcı",
        "role": role,
        "is_active": True,
        "is_super_admin": super_admin,
        "company_ids": ids,
        "active_company_id": active if active is not None else (ids[0] if ids else ""),
    }


class _Coll(MemColl):
    """MemColl'da olmayan silme metotları. dashboard_memdb değişmez."""

    async def delete_one(self, query=None):
        query = query or {}
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query=None):
        query = query or {}
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query):
                removed += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=removed)


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


def _bind():
    db = _DB()
    prev = {
        "server": server.db,
        "cheques": cheques._db,
        "rbac": rbac._db,
        "mail": event_notify.queue_event_email,
    }
    server.db = db
    cheques._db = db
    rbac._db = db

    async def _skip_mail(*_args, **_kwargs):
        return {"status": "skipped"}

    event_notify.queue_event_email = _skip_mail
    return db, prev


def _restore(prev):
    server.db = prev["server"]
    cheques._db = prev["cheques"]
    rbac._db = prev["rbac"]
    event_notify.queue_event_email = prev["mail"]


async def _seed(db):
    for cid, tag, name in ((CO_A, "a", "A"), (CO_B, "b", "B")):
        await db.companies.insert_one({"_id": cid, "name": name, "cash_dual_approval": False})
        await db.bank_accounts.insert_one({
            "_id": f"acc_{tag}",
            "company_id": cid,
            "type": "cash_box",
            "bank_name": "Kasa",
            "account_name": f"Kasa {name}",
            "currency": "TRY",
            "current_balance": 1000.0,
        })
        await db.partners.insert_one({
            "_id": f"partner_{tag}",
            "company_id": cid,
            "name": f"Ortak {name}",
            "balance": 0.0,
            "total_capital_in": 0.0,
            "total_withdrawn": 0.0,
            "total_profit_share": 0.0,
            "is_active": True,
        })
        await db.contacts.insert_one({
            "_id": f"contact_{tag}",
            "company_id": cid,
            "name": f"Cari {name}",
            "balance": 400.0,
            "cheque_bond_balance": 120.0,
        })
        await db.cheques.insert_one({
            "_id": f"cheque_{tag}_in",
            "company_id": cid,
            "number": f"CEK-{name}-IN",
            "instrument": "cheque",
            "direction": "received",
            "status": "open",
            "contact_id": f"contact_{tag}",
            "contact_name": f"Cari {name}",
            "amount": 120.0,
            "currency": "TRY",
            "events": [],
        })
        await db.cheques.insert_one({
            "_id": f"cheque_{tag}_out",
            "company_id": cid,
            "number": f"CEK-{name}-OUT",
            "instrument": "cheque",
            "direction": "issued",
            "status": "open",
            "contact_id": f"contact_{tag}",
            "contact_name": f"Cari {name}",
            "amount": 80.0,
            "currency": "TRY",
            "events": [],
        })
    await db.contacts.insert_one({
        "_id": "contact_a2",
        "company_id": CO_A,
        "name": "Cari A2",
        "balance": 50.0,
        "cheque_bond_balance": 0.0,
    })


def _snap_b(db):
    out = {}
    for name in B_COLS:
        rows = [copy.deepcopy(d) for d in db[name].docs if d.get("company_id") == CO_B]
        rows.sort(key=lambda d: str(d.get("_id")))
        out[name] = rows
    return out


async def _expect(coro, status, detail=None):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == status
    if detail is not None:
        assert exc.value.detail == detail
    elif status == 404:
        assert "bulunamadı" in str(exc.value.detail).lower()
    return exc.value


def _acc(db, account_id):
    return next(d for d in db.bank_accounts.docs if d["_id"] == account_id)


def _partner(db, partner_id):
    return next(d for d in db.partners.docs if d["_id"] == partner_id)


def _contact(db, contact_id):
    return next(d for d in db.contacts.docs if d["_id"] == contact_id)


def test_other_company_body_ids_do_not_write():
    """A kullanıcısı B kimlikleriyle yazamaz; B kayıtları birebir kalır."""
    db, prev = _bind()

    async def run():
        await _seed(db)
        user_a = _user(CO_A)
        user_ac = _user(CO_A, CO_C, active=CO_A)
        before = _snap_b(db)
        b_contact = copy.deepcopy(_contact(db, "contact_b"))

        await _expect(server.create_bank_account(BankAccount(
            company_id=CO_B, type="cash_box", bank_name="Kasa", account_name="Sızma",
            currency="TRY", current_balance=10,
        ), user_a), 403, "Bu şirket hesabına erişiminiz yok.")
        assert _snap_b(db) == before

        await _expect(server.create_bank_account(BankAccount(
            company_id=CO_B, type="cash_box", bank_name="Kasa", account_name="Sızma AC",
            currency="TRY", current_balance=10,
        ), user_ac), 403, "Bu şirket hesabına erişiminiz yok.")
        assert _snap_b(db) == before

        created = await server.create_bank_account(BankAccount(
            company_id="", type="cash_box", bank_name="Kasa", account_name="Bos sirket",
            currency="TRY", current_balance=15,
        ), user_ac)
        stored = await db.bank_accounts.find_one({"_id": created["id"]})
        assert stored["company_id"] == CO_A
        assert stored["current_balance"] == pytest.approx(15)
        openings = [t for t in db.bank_transactions.docs if t.get("account_id") == created["id"]]
        assert len(openings) == 1
        assert openings[0]["source"] == "opening"
        assert openings[0]["company_id"] == CO_A
        assert _snap_b(db) == before

        await _expect(server.create_partner_transaction({
            "partner_id": "partner_b",
            "type": "capital_in",
            "amount": 25,
            "account_id": "acc_b",
            "company_id": CO_B,
        }, user_a), 404, "Ortak bulunamadı.")
        assert _snap_b(db) == before

        await _expect(server.create_partner_transaction({
            "partner_id": "partner_a",
            "type": "capital_in",
            "amount": 25,
            "account_id": "acc_b",
            "company_id": CO_A,
        }, user_a), 404, "Kasa/Banka hesabı bulunamadı.")
        assert db.cash_approval_requests.docs == []
        assert _snap_b(db) == before

        posted = await server.create_partner_transaction({
            "partner_id": "partner_a",
            "type": "capital_in",
            "amount": 30,
            "account_id": "acc_a",
            "company_id": CO_B,
            "description": "A kaydı",
        }, user_a)
        assert posted["company_id"] == CO_A
        assert posted["partner_id"] == "partner_a"
        tx = await db.partner_transactions.find_one({"_id": posted["id"]})
        assert tx["company_id"] == CO_A
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(1030)
        assert _partner(db, "partner_a")["balance"] == pytest.approx(30)
        assert _snap_b(db) == before

        await _expect(cheques.create_cheque({
            "company_id": CO_A,
            "direction": "received",
            "instrument": "cheque",
            "contact_id": "contact_b",
            "amount": 80,
        }, user_a), 404, "Cari bulunamadı.")
        assert _contact(db, "contact_b")["balance"] == b_contact["balance"]
        assert _contact(db, "contact_b")["cheque_bond_balance"] == b_contact["cheque_bond_balance"]
        assert _snap_b(db) == before

        await _expect(cheques.update_cheque("cheque_a_in", {"contact_id": "contact_b"}, user_a), 404, "Cari bulunamadı.")
        assert _snap_b(db) == before

        await _expect(cheques.endorse_cheque("cheque_a_in", {"contact_id": "contact_b"}, user_a), 404, "Cari bulunamadı.")
        assert _snap_b(db) == before

        await _expect(cheques.collect_cheque("cheque_a_in", {"account_id": "acc_b"}, user_a), 404, "Kasa/Banka hesabı bulunamadı.")
        await _expect(cheques.collect_cheque("cheque_a_in", {"partner_id": "partner_b"}, user_a), 404, "Ortak bulunamadı.")
        assert _snap_b(db) == before
        assert next(d for d in db.cheques.docs if d["_id"] == "cheque_a_in")["status"] == "open"

        await _expect(cheques.pay_issued_cheque("cheque_a_out", {"account_id": "acc_b"}, user_a), 404, "Kasa/Banka hesabı bulunamadı.")
        await _expect(cheques.pay_issued_cheque("cheque_a_out", {"partner_id": "partner_b"}, user_a), 404, "Ortak bulunamadı.")
        assert _snap_b(db) == before
        assert next(d for d in db.cheques.docs if d["_id"] == "cheque_a_out")["status"] == "open"

        await _expect(partner_pay.move(db, CO_A, "partner_b", 15, "withdrawal", "sızma"), 404, "Ortak bulunamadı.")
        assert _partner(db, "partner_b")["balance"] == pytest.approx(0)
        assert _snap_b(db) == before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_same_company_flows_keep_current_results():
    """A kimlikleriyle hesap, ortak hareketi, onay kuyruğu ve çek akışı bugünkü sonucu verir."""
    db, prev = _bind()

    async def run():
        await _seed(db)
        user_a = _user(CO_A)
        approver = _user(CO_A)
        approver["_id"] = "user-approver"
        approver["id"] = "user-approver"
        approver["name"] = "Onaycı"
        before_b = _snap_b(db)

        created = await server.create_bank_account(BankAccount(
            company_id=CO_A, type="cash_box", bank_name="Kasa", account_name="Yeni kasa",
            currency="TRY", current_balance=75,
        ), user_a)
        aid = created["id"]
        stored = await db.bank_accounts.find_one({"_id": aid})
        assert stored["company_id"] == CO_A
        assert stored["current_balance"] == pytest.approx(75)
        openings = [t for t in db.bank_transactions.docs if t.get("account_id") == aid and t.get("source") == "opening"]
        assert len(openings) == 1
        assert openings[0]["type"] == "inflow"
        assert openings[0]["amount"] == pytest.approx(75)
        assert openings[0]["company_id"] == CO_A

        put_in = await server.create_partner_transaction({
            "partner_id": "partner_a",
            "type": "capital_in",
            "amount": 100,
            "account_id": "acc_a",
            "description": "Para koy",
        }, user_a)
        assert put_in["company_id"] == CO_A
        assert put_in["type"] == "capital_in"
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(1100)
        assert _partner(db, "partner_a")["balance"] == pytest.approx(100)
        assert _partner(db, "partner_a")["total_capital_in"] == pytest.approx(100)
        cash_in = [t for t in db.bank_transactions.docs if t.get("partner_tx_id") == put_in["id"]]
        assert len(cash_in) == 1
        assert cash_in[0]["type"] == "inflow"
        assert cash_in[0]["company_id"] == CO_A
        assert cash_in[0]["amount"] == pytest.approx(100)

        take = await server.create_partner_transaction({
            "partner_id": "partner_a",
            "type": "withdrawal",
            "amount": 40,
            "account_id": "acc_a",
            "description": "Para çek",
        }, user_a)
        assert take["company_id"] == CO_A
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(1060)
        assert _partner(db, "partner_a")["balance"] == pytest.approx(60)
        assert _partner(db, "partner_a")["total_withdrawn"] == pytest.approx(40)
        cash_out = [t for t in db.bank_transactions.docs if t.get("partner_tx_id") == take["id"]]
        assert len(cash_out) == 1
        assert cash_out[0]["type"] == "outflow"
        assert cash_out[0]["amount"] == pytest.approx(40)

        await db.companies.update_one({"_id": CO_A}, {"$set": {"cash_dual_approval": True}})
        bal_acc = _acc(db, "acc_a")["current_balance"]
        bal_partner = _partner(db, "partner_a")["balance"]
        pending = await server.create_partner_transaction({
            "partner_id": "partner_a",
            "type": "capital_in",
            "amount": 10,
            "account_id": "acc_a",
            "company_id": CO_B,
            "description": "Onaylı giriş",
        }, user_a)
        assert pending["status"] == "pending_approval"
        queued = [d for d in db.cash_approval_requests.docs if d.get("company_id") == CO_A]
        assert len(queued) == 1
        assert queued[0]["kind"] == "partner_tx"
        assert queued[0]["status"] == "pending"
        assert queued[0]["payload"]["company_id"] == CO_A
        assert queued[0]["payload"]["partner_id"] == "partner_a"
        assert queued[0]["payload"]["account_id"] == "acc_a"
        assert not any(d.get("company_id") == CO_B for d in db.cash_approval_requests.docs)
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(bal_acc)
        assert _partner(db, "partner_a")["balance"] == pytest.approx(bal_partner)
        assert not any(t.get("description") == "Ortak A: Onaylı giriş" for t in db.partner_transactions.docs)

        prev_user = server.get_current_user

        async def _as_approver(_request):
            return approver

        server.get_current_user = _as_approver
        try:
            approved = await server.approve_cash_request(queued[0]["_id"], SimpleNamespace())
        finally:
            server.get_current_user = prev_user
        assert approved["status"] == "success"
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(bal_acc + 10)
        assert _partner(db, "partner_a")["balance"] == pytest.approx(bal_partner + 10)
        executed = await db.partner_transactions.find_one({"description": "Onaylı giriş"})
        assert executed["company_id"] == CO_A
        assert executed["partner_id"] == "partner_a"
        assert (await db.cash_approval_requests.find_one({"_id": queued[0]["_id"]}))["status"] == "approved"

        missing = await _expect(cheques.create_cheque({
            "company_id": CO_A, "amount": 10, "direction": "received", "instrument": "cheque",
        }, user_a), 400)
        assert missing.detail == "Cari seçin."

        contact_before = _contact(db, "contact_a")["balance"]
        cheque = await cheques.create_cheque({
            "company_id": CO_A,
            "direction": "received",
            "instrument": "cheque",
            "contact_id": "contact_a",
            "amount": 175,
            "serial_no": "CK-A",
        }, user_a)
        assert cheque["company_id"] == CO_A
        assert cheque["status"] == "open"
        assert _contact(db, "contact_a")["balance"] == pytest.approx(contact_before - 175)
        portfolio = [
            t for t in db.bank_transactions.docs
            if t.get("cheque_id") == cheque["id"] and t.get("source") == "cheque"
        ]
        assert len(portfolio) == 1
        assert portfolio[0]["company_id"] == CO_A
        assert portfolio[0]["contact_id"] == "contact_a"
        assert portfolio[0]["account_name"] == "Çek Portföyü"
        assert portfolio[0]["type"] == "inflow"
        assert portfolio[0]["amount"] == pytest.approx(175)
        assert portfolio[0].get("account_id") in (None, "")

        updated = await cheques.update_cheque(cheque["id"], {"amount": 180, "serial_no": "CK-A2"}, user_a)
        assert updated["serial_no"] == "CK-A2"
        assert float(updated["amount"]) == pytest.approx(180)
        assert _contact(db, "contact_a")["balance"] == pytest.approx(contact_before - 180)

        endorsed = await cheques.endorse_cheque(cheque["id"], {"contact_id": "contact_a2"}, user_a)
        assert endorsed["status"] == "endorsed"
        assert endorsed["endorsed_to_contact_id"] == "contact_a2"
        assert _contact(db, "contact_a2")["balance"] == pytest.approx(50 + 180)
        assert any(ev.get("action") == "endorsed" for ev in next(d for d in db.cheques.docs if d["_id"] == cheque["id"])["events"])

        bare = await _expect(cheques.endorse_cheque("cheque_a_in", {}, user_a), 400)
        assert bare.detail == "Ciro edilecek cariyi seçin."

        recv = await cheques.create_cheque({
            "company_id": CO_A,
            "direction": "received",
            "instrument": "cheque",
            "contact_id": "contact_a",
            "amount": 200,
        }, user_a)
        acc_before = _acc(db, "acc_a")["current_balance"]
        collected = await cheques.collect_cheque(recv["id"], {"account_id": "acc_a"}, user_a)
        assert collected["status"] == "collected"
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(acc_before + 200)
        bank_hit = [
            t for t in db.bank_transactions.docs
            if t.get("cheque_id") == recv["id"] and t.get("source") == "cheque_bank"
        ]
        assert len(bank_hit) == 1
        assert bank_hit[0]["type"] == "inflow"
        assert bank_hit[0]["company_id"] == CO_A
        assert bank_hit[0]["category"] == "Çek/Senet Tahsilatı"

        recv_p = await cheques.create_cheque({
            "company_id": CO_A,
            "direction": "received",
            "instrument": "cheque",
            "contact_id": "contact_a",
            "amount": 50,
        }, user_a)
        partner_before = _partner(db, "partner_a")["balance"]
        acc_hold = _acc(db, "acc_a")["current_balance"]
        collected_p = await cheques.collect_cheque(recv_p["id"], {"partner_id": "partner_a"}, user_a)
        assert collected_p["status"] == "collected"
        assert "Ortak" in (collected_p.get("account_name") or "")
        assert _partner(db, "partner_a")["balance"] == pytest.approx(partner_before - 50)
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(acc_hold)

        contact_before_issue = _contact(db, "contact_a")["balance"]
        issued = await cheques.create_cheque({
            "company_id": CO_A,
            "direction": "issued",
            "instrument": "cheque",
            "contact_id": "contact_a",
            "amount": 90,
        }, user_a)
        assert _contact(db, "contact_a")["balance"] == pytest.approx(contact_before_issue + 90)
        contact_after_issue = _contact(db, "contact_a")["balance"]
        acc_before = _acc(db, "acc_a")["current_balance"]
        paid = await cheques.pay_issued_cheque(issued["id"], {"account_id": "acc_a"}, user_a)
        assert paid["status"] == "paid"
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(acc_before - 90)
        assert _contact(db, "contact_a")["balance"] == pytest.approx(contact_after_issue)
        pay_tx = [
            t for t in db.bank_transactions.docs
            if t.get("cheque_id") == issued["id"] and t.get("source") == "cheque_bank"
        ]
        assert len(pay_tx) == 1
        assert pay_tx[0]["type"] == "outflow"
        assert pay_tx[0]["company_id"] == CO_A

        issued_p = await cheques.create_cheque({
            "company_id": CO_A,
            "direction": "issued",
            "instrument": "cheque",
            "contact_id": "contact_a",
            "amount": 30,
        }, user_a)
        partner_before = _partner(db, "partner_a")["balance"]
        paid_p = await cheques.pay_issued_cheque(issued_p["id"], {"partner_id": "partner_a"}, user_a)
        assert paid_p["status"] == "paid"
        assert "Ortak" in (paid_p.get("account_name") or "")
        assert _partner(db, "partner_a")["balance"] == pytest.approx(partner_before - 30)

        internal = await cheques.create_cheque({
            "company_id": CO_A,
            "direction": "issued",
            "instrument": "promissory",
            "contact_id": "contact_a",
            "amount": 20,
            "skip_ledger": True,
            "notes": "Taksit",
        })
        assert internal["company_id"] == CO_A
        assert internal["instrument"] == "promissory"
        assert internal.get("skip_ledger") is True

        assert _snap_b(db) == before_b

    try:
        _run(run())
    finally:
        _restore(prev)


def test_legacy_queue_without_company_id_still_executes():
    """company_id'siz eski kuyruk kaydı ortağı bugünkü gibi _id ile bulur."""
    db, prev = _bind()

    async def run():
        await _seed(db)
        out = await server._execute_partner_tx({
            "partner_id": "partner_a",
            "type": "withdrawal",
            "amount": 12,
            "account_id": "acc_a",
            "description": "eski kuyruk",
        })
        assert out["company_id"] == CO_A
        assert out["partner_id"] == "partner_a"
        assert _acc(db, "acc_a")["current_balance"] == pytest.approx(988)
        assert _partner(db, "partner_a")["balance"] == pytest.approx(-12)
        assert _acc(db, "acc_b")["current_balance"] == pytest.approx(1000)
        assert _partner(db, "partner_b")["balance"] == pytest.approx(0)

    try:
        _run(run())
    finally:
        _restore(prev)


def test_move_without_company_id_keeps_lookup_and_warns(caplog):
    """company_id boşken move bugünkü sorguyu kullanır ve uyarı yazar."""
    db, prev = _bind()

    async def run():
        await _seed(db)
        with caplog.at_level(logging.WARNING, logger="partner_pay"):
            name = await partner_pay.move(db, "", "partner_b", 7, "withdrawal", "eski çağrı")
        assert name == "Ortak B"
        assert _partner(db, "partner_b")["balance"] == pytest.approx(-7)
        assert _partner(db, "partner_b")["total_withdrawn"] == pytest.approx(7)
        assert any(
            r.name == "partner_pay" and "company_id" in r.getMessage()
            for r in caplog.records
        )

    try:
        _run(run())
    finally:
        _restore(prev)


def test_super_admin_follows_resolve_company_rules():
    """Süper admin resolve_company_id / get_tenant_doc ile diğer şirkette çalışır."""
    db, prev = _bind()

    async def run():
        await _seed(db)
        sa = _user(CO_A, super_admin=True)
        created = await server.create_bank_account(BankAccount(
            company_id=CO_B, type="cash_box", bank_name="Kasa", account_name="SA kasa",
            currency="TRY", current_balance=5,
        ), sa)
        stored = await db.bank_accounts.find_one({"_id": created["id"]})
        assert stored["company_id"] == CO_B
        posted = await server.create_partner_transaction({
            "partner_id": "partner_b",
            "type": "capital_in",
            "amount": 5,
            "account_id": "acc_b",
        }, sa)
        assert posted["company_id"] == CO_B
        assert _acc(db, "acc_b")["current_balance"] == pytest.approx(1005)
        assert _partner(db, "partner_b")["balance"] == pytest.approx(5)

    try:
        _run(run())
    finally:
        _restore(prev)


def _fn_map(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _depends_on_current_user(fn: ast.AST) -> bool:
    args = fn.args.args
    defaults = fn.args.defaults
    offset = len(args) - len(defaults)
    for i, arg in enumerate(args):
        if arg.arg != "user":
            continue
        di = i - offset
        if di < 0 or not isinstance(defaults[di], ast.Call):
            return False
        call = defaults[di]
        fname = call.func.id if isinstance(call.func, ast.Name) else getattr(call.func, "attr", "")
        if fname != "Depends" or not call.args:
            return False
        dep = call.args[0]
        return isinstance(dep, ast.Name) and dep.id == "get_current_user"
    return False


def _unscoped_find_ones(fn: ast.AST):
    """contacts / bank_accounts / partners find_one dict filtresinde company_id yoksa satır."""
    collections = {"contacts", "bank_accounts", "partners"}
    hits = []
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr != "find_one":
            continue
        recv = node.func.value
        if not isinstance(recv, ast.Attribute) or recv.attr not in collections:
            continue
        if not node.args or not isinstance(node.args[0], ast.Dict):
            continue
        keys = [k.value for k in node.args[0].keys if isinstance(k, ast.Constant)]
        if "_id" in keys and "company_id" not in keys:
            hits.append(node.lineno)
    return hits


def test_finance_body_id_queries_are_company_scoped():
    """İmzalar oturum kullanıcısı alır; hedef gövdelerde şirketsiz _id find_one kalmaz."""
    fns = {
        "server.py": _fn_map(_BACKEND / "server.py"),
        "cheques.py": _fn_map(_BACKEND / "cheques.py"),
        "partner_pay.py": _fn_map(_BACKEND / "partner_pay.py"),
    }
    assert _depends_on_current_user(fns["server.py"]["create_bank_account"])
    assert _depends_on_current_user(fns["server.py"]["create_partner_transaction"])
    watched = {
        "cheques.py": ["create_cheque", "update_cheque", "endorse_cheque", "_bank_move"],
        "server.py": ["_post_partner_cash_movement"],
        "partner_pay.py": ["move"],
    }
    missing = []
    for filename, names in watched.items():
        for name in names:
            for lineno in _unscoped_find_ones(fns[filename][name]):
                missing.append(f"{filename}:{name}:{lineno}")
    assert not missing, missing
