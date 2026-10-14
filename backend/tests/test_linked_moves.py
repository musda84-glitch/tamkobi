"""Linked movement cleanup: link fields, reverse, guards, integrity, restore."""
import asyncio
import os
import re
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import auth_utils  # noqa: E402
import host_audience as ha  # noqa: E402
import linked_moves  # noqa: E402
import partner_pay  # noqa: E402
import saas  # noqa: E402
from auth_utils import create_access_token  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *a, **k):
        return self

    async def to_list(self, n):
        return [dict(x) for x in self.rows[:n]]


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        if not q:
            return True
        if "$or" in q:
            rest = {k: v for k, v in q.items() if k != "$or"}
            if rest and not self._match(d, rest):
                return False
            return any(self._match(d, clause) for clause in q["$or"])
        if "$and" in q:
            return all(self._match(d, clause) for clause in q["$and"])
        for k, v in q.items():
            if isinstance(v, dict):
                if "$exists" in v:
                    exists = k in d and d[k] is not None
                    want = bool(v["$exists"])
                    if exists != want:
                        return False
                    if "$nin" in v and d.get(k) in v["$nin"]:
                        return False
                    continue
                if "$in" in v:
                    if d.get(k) not in v["$in"]:
                        return False
                    continue
                if "$nin" in v and d.get(k) in v["$nin"]:
                    return False
                if "$regex" in v:
                    flags = re.I if "i" in str(v.get("$options") or "") else 0
                    if not re.search(v["$regex"], str(d.get(k) or ""), flags):
                        return False
                    continue
                if d.get(k) != v:
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        d = next((x for x in self.docs if self._match(x, q)), None)
        return dict(d) if d else None

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, q, upd):
        d = next((x for x in self.docs if self._match(x, q)), None)
        if not d:
            return
        if "$set" in upd:
            d.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                d[k] = float(d.get(k) or 0) + float(v)
        if "$unset" in upd:
            for k in upd["$unset"]:
                d.pop(k, None)

    async def delete_one(self, q):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not self._match(d, q)]
        return MagicMock(deleted_count=before - len(self.docs))

    async def delete_many(self, q):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not self._match(d, q)]
        return MagicMock(deleted_count=before - len(self.docs))

    async def count_documents(self, q=None):
        return len([d for d in self.docs if self._match(d, q)])


class FakeDb:
    def __init__(self):
        names = [
            "bank_accounts", "bank_transactions", "partners", "partner_transactions",
            "bonus_payments", "payrolls", "loans", "installments", "expenses",
            "contacts", "companies", "activity_logs", "trash", "products", "stock_movements",
            "invoices", "personnel_movements", "personnel_receipts",
        ]
        for n in names:
            setattr(self, n, FakeCollection())

    def __getitem__(self, name):
        if not hasattr(self, name):
            setattr(self, name, FakeCollection())
        return getattr(self, name)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def db():
    fake = FakeDb()
    fake.companies.docs.append({"_id": "c1", "name": "Demo"})
    fake.bank_accounts.docs.append({
        "_id": "acc1", "company_id": "c1", "account_name": "Kasa",
        "type": "cash_box", "current_balance": 1000.0,
    })
    fake.partners.docs.append({
        "_id": "p1", "company_id": "c1", "name": "Ortak", "balance": 500.0, "total_withdrawn": 0,
    })

    async def reverse_tx(tx, sign=-1):
        amt = float(tx.get("amount") or 0) * sign
        change = amt if tx.get("type") == "inflow" else -amt
        if tx.get("account_id"):
            await fake.bank_accounts.update_one({"_id": tx["account_id"]}, {"$inc": {"current_balance": change}})
        if tx.get("contact_id"):
            await fake.contacts.update_one({"_id": tx["contact_id"]}, {"$inc": {"balance": -change}})

    linked_moves.init(fake, reverse_tx_fn=reverse_tx)
    return fake


def test_link_fields_specialty():
    f = linked_moves.link_fields("personnel_bonus", "b1")
    assert f["bonus_id"] == "b1" and f["source_type"] == "personnel_bonus" and f["source"] == "personnel_bonus"
    f2 = linked_moves.link_fields("payroll", "pay1")
    assert f2["payroll_id"] == "pay1" and f2["source"] == "payroll"
    f3 = linked_moves.link_fields("loan", "L1")
    assert f3["loan_id"] == "L1"
    f4 = linked_moves.link_fields("installment", "i1")
    assert f4["installment_id"] == "i1"
    f5 = linked_moves.link_fields("personnel_payment", "mov1")
    assert f5["source_type"] == "personnel_payment" and f5["source_id"] == "mov1"
    assert f5["personnel_movement_id"] == "mov1" and f5["source"] == "personnel_payment"


def test_source_guard_blocks_linked_tx():
    with pytest.raises(Exception) as ei:
        linked_moves.assert_not_source_linked({"bonus_id": "b1", "amount": 10})
    assert ei.value.status_code == 400
    assert "Kaynak kayıttan geri alın" in str(ei.value.detail)
    with pytest.raises(Exception) as ei2:
        linked_moves.assert_not_source_linked({"payroll_id": "p1"})
    assert ei2.value.status_code == 400
    linked_moves.assert_not_source_linked({"amount": 5, "source": "manual"})  # no raise


def test_bonus_pay_delete_clears_move_and_balance(db):
    bid = "bonus1"
    link = linked_moves.link_fields("personnel_bonus", bid)
    db.bonus_payments.docs.append({
        "_id": bid, "company_id": "c1", "status": "paid", "amount": 100,
        "account_id": "acc1", "employee_name": "Ali", "type": "bonus",
    })
    db.bank_transactions.docs.append({
        "_id": "open1", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, "source": "opening", "description": "Açılış",
    })
    db.bank_transactions.docs.append({
        "_id": "tx1", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 100, "description": "Ali prim", **link,
    })
    db.bank_accounts.docs[0]["current_balance"] = 900.0

    related = _run(linked_moves.prepare_source_trash(db, "personnel_bonus", bid))
    assert related and related[0]["collection"] == "bank_transactions"
    # soft_delete simulation then recalc (production order)
    for block in related:
        for d in block["docs"]:
            _run(db[block["collection"]].delete_one({"_id": d["_id"]}))
    _run(linked_moves.recalc_after_trash(db, related))
    assert not any(t.get("bonus_id") == bid for t in db.bank_transactions.docs)
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(1000.0, abs=0.01)

    # restore: re-insert related then apply effects
    for block in related:
        for d in block["docs"]:
            _run(db[block["collection"]].insert_one(d))
    _run(linked_moves.restore_linked_from_related(db, related))
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(900.0, abs=0.01)


def test_payroll_same_pattern(db):
    pid = "pay1"
    link = linked_moves.link_fields("payroll", pid)
    db.payrolls.docs.append({"_id": pid, "company_id": "c1", "status": "paid", "final_payable": 50, "account_id": "acc1"})
    db.bank_transactions.docs.append({
        "_id": "open1", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, "source": "opening", "description": "Açılış",
    })
    db.bank_transactions.docs.append({
        "_id": "txp", "company_id": "c1", "account_id": "acc1", "type": "outflow", "amount": 50, **link,
    })
    db.bank_accounts.docs[0]["current_balance"] = 950.0
    related = _run(linked_moves.prepare_source_trash(db, "payroll", pid))
    for block in related:
        for d in block["docs"]:
            _run(db[block["collection"]].delete_one({"_id": d["_id"]}))
    _run(linked_moves.recalc_after_trash(db, related))
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(1000.0, abs=0.01)


def test_loan_and_installment_delete_reverses_all(db):
    lid = "loan1"
    link = linked_moves.link_fields("loan", lid)
    db.loans.docs.append({"_id": lid, "company_id": "c1", "name": "Kredi", "principal": 1000})
    db.bank_transactions.docs.append({
        "_id": "tx_in", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, **link,
    })
    db.bank_transactions.docs.append({
        "_id": "tx_out", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 200, **link, "installment_no": 1,
    })
    db.expenses.docs.append({"_id": "e1", "company_id": "c1", "loan_id": lid, "amount": 30, "total": 30})
    db.bank_accounts.docs[0]["current_balance"] = 1800.0  # +1000 -200
    related = _run(linked_moves.prepare_source_trash(db, "loan", lid))
    assert len(related) >= 2  # bank + expenses
    bank_n = sum(len(b["docs"]) for b in related if b["collection"] == "bank_transactions")
    assert bank_n == 2
    for block in related:
        for d in block["docs"]:
            _run(db[block["collection"]].delete_one({"_id": d["_id"]}))
    assert not any(t.get("loan_id") == lid for t in db.bank_transactions.docs)
    assert not any(e.get("loan_id") == lid for e in db.expenses.docs)


def test_installment_unpay_via_reverse_linked(db):
    iid = "inst1"
    link = linked_moves.link_fields("installment", iid)
    db.contacts.docs.append({"_id": "cnt1", "company_id": "c1", "balance": 0})
    db.installments.docs.append({
        "_id": iid, "company_id": "c1", "status": "paid", "paid_amount": 75,
        "amount": 75, "contact_id": "cnt1", "direction": "receivable",
    })
    # Açılış hareketi — kasa sync hareket toplamına kilitler
    db.bank_transactions.docs.append({
        "_id": "open1", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, "source": "opening", "description": "Açılış",
    })
    db.bank_transactions.docs.append({
        "_id": "txi", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 75, "contact_id": "cnt1", **link,
    })
    db.bank_accounts.docs[0]["current_balance"] = 1075.0
    db.contacts.docs[0]["balance"] = -75.0

    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "tid"

    with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
        rev = _run(linked_moves.reverse_linked(db, "installment", iid, mode="delete", reason="unpay"))
    assert rev["bank"] == 1
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(1000.0, abs=0.01)
    assert not any(t.get("installment_id") == iid for t in db.bank_transactions.docs)


def test_reverse_linked_idempotent(db):
    r1 = _run(linked_moves.reverse_linked(db, "personnel_bonus", "missing", mode="delete"))
    assert r1["idempotent"] is True and r1["reversed"] == 0
    r2 = _run(linked_moves.reverse_linked(db, "personnel_bonus", "missing", mode="delete"))
    assert r2["idempotent"] is True


def test_integrity_orphans_and_dry_run(db):
    # orphan move: bonus_id set but bonus gone
    db.bank_transactions.docs.append({
        "_id": "orphan1", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 40, "bonus_id": "gone", "description": "ghost",
    })
    # paid bonus without move + heuristic candidate
    db.bonus_payments.docs.append({
        "_id": "b_old", "company_id": "c1", "status": "paid", "amount": 55,
        "account_id": "acc1", "employee_name": "Zeynep", "period": "2026-01", "type_label": "Prim",
    })
    db.bank_transactions.docs.append({
        "_id": "legacy", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 55, "description": "Zeynep - 2026-01 Prim", "category": "Personel Prim",
    })
    # drift
    db.bank_accounts.docs[0]["current_balance"] = 9999.0

    report = _run(linked_moves.scan_orphans(db, "c1"))
    assert report["summary"]["orphan_moves"] >= 1
    assert report["paid_bonus_without_moves"]
    assert report["heuristic_bonus_links"]
    assert report["cash_balance_drift"]

    before_tx = len(db.bank_transactions.docs)
    before_bal = db.bank_accounts.docs[0]["current_balance"]
    dry = _run(linked_moves.cleanup_orphans(db, "c1", dry_run=True))
    assert dry["dry_run"] is True
    assert len(db.bank_transactions.docs) == before_tx
    assert db.bank_accounts.docs[0]["current_balance"] == before_bal

    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "t"

    with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
        applied = _run(linked_moves.cleanup_orphans(db, "c1", dry_run=False, actor={"name": "test"}))
    assert applied["dry_run"] is False
    assert db.activity_logs.docs, "cleanup should write activity_logs audit"
    # cash drift synced to movement sum
    assert db.bank_accounts.docs[0]["current_balance"] != pytest.approx(9999.0)


def test_integrity_other_company_403(db):
    user = {"role": "admin", "company_ids": ["c1"], "active_company_id": "c1"}
    with pytest.raises(Exception) as ei:
        linked_moves._require_integrity_access(user, "other_co")
    assert ei.value.status_code in (403, 404)
    sa = {"is_super_admin": True}
    linked_moves._require_integrity_access(sa, "other_co")  # ok


def test_require_integrity_access_normalize_role(db):
    base = {"company_ids": ["c1"], "active_company_id": "c1"}
    linked_moves._require_integrity_access({**base, "role": "Yönetici"}, "c1")
    linked_moves._require_integrity_access({**base, "role": "owner"}, "c1")
    linked_moves._require_integrity_access({**base, "role": "admin"}, "c1")
    with pytest.raises(Exception) as ei:
        linked_moves._require_integrity_access({**base, "role": "sales"}, "c1")
    assert ei.value.status_code == 403


def test_cleanup_foreign_company_payroll_skipped(db):
    """A şirketi admini B'nin payroll_id'siyle cleanup → B hareketleri değişmez."""
    db.companies.docs.append({"_id": "c2", "name": "Other Co"})
    db.bank_accounts.docs.append({
        "_id": "acc2", "company_id": "c2", "account_name": "Kasa B",
        "type": "cash_box", "current_balance": 500.0,
    })
    db.payrolls.docs.append({
        "_id": "pay_b", "company_id": "c2", "status": "paid",
        "final_payable": 80, "account_id": "acc2", "employee_name": "Bora",
    })
    db.bank_transactions.docs.append({
        "_id": "tx_b", "company_id": "c2", "account_id": "acc2", "type": "outflow",
        "amount": 80, "payroll_id": "pay_b", "description": "Bora maaş",
        **linked_moves.link_fields("payroll", "pay_b"),
    })
    before = [dict(t) for t in db.bank_transactions.docs if t.get("_id") == "tx_b"]
    assert before

    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "t"

    with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
        result = _run(linked_moves.cleanup_orphans(
            db, "c1", dry_run=False,
            items=[{"source_type": "payroll", "source_id": "pay_b"}],
            actor={"name": "admin-a"},
        ))
    assert result["actions"]
    assert result["actions"][0]["result"]["status"] == "skip"
    assert result["actions"][0]["result"]["reason"] == "foreign_company"
    assert any(t.get("_id") == "tx_b" for t in db.bank_transactions.docs)
    assert db.bank_accounts.docs[1]["current_balance"] == pytest.approx(500.0)


def test_personnel_payment_orphan_scan(db):
    db.bank_transactions.docs.append({
        "_id": "pp_orphan", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 25, "personnel_movement_id": "gone_mov", "description": "ghost pay",
        **linked_moves.link_fields("personnel_payment", "gone_mov"),
    })
    report = _run(linked_moves.scan_orphans(db, "c1"))
    assert any(r["source_id"] == "gone_mov" for r in report["orphan_personnel_payment_moves"])
    assert report["summary"]["orphan_moves"] >= 1


def test_link_query_scopes_company_id(db):
    db.bank_transactions.docs.append({
        "_id": "tx_a", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 10, **linked_moves.link_fields("payroll", "pay_shared"),
    })
    db.bank_transactions.docs.append({
        "_id": "tx_b2", "company_id": "c2", "account_id": "accX", "type": "outflow",
        "amount": 10, **linked_moves.link_fields("payroll", "pay_shared"),
    })
    found = _run(linked_moves.find_linked(db, "payroll", "pay_shared", company_id="c1"))
    ids = {t["_id"] for t in found["bank_transactions"]}
    assert ids == {"tx_a"}


def test_legacy_bonus_orphans_scan_and_cleanup(db):
    """Eski formatta bonus öde → bonus sil → tarama gösterir → dry_run no-op → cleanup kaldırır."""
    bid = "legacy_bonus_1"
    db.bank_transactions.docs.append({
        "_id": "open1", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, "source": "opening", "description": "Açılış",
    })
    # Eski format: Gayri Resmi kategori, bonus_id yok
    db.bank_transactions.docs.append({
        "_id": "legacy_tx", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 120, "description": "Ayşe - 2026-02 Prim",
        "category": "Personel Prim (Gayri Resmi)",
    })
    db.bonus_payments.docs.append({
        "_id": bid, "company_id": "c1", "status": "paid", "amount": 120,
        "account_id": "acc1", "employee_name": "Ayşe", "period": "2026-02",
        "type": "bonus", "type_label": "Prim",
    })
    db.bank_accounts.docs[0]["current_balance"] = 880.0

    # Bonus'u çöpe taşı (eski silme: hareket bağlantısız kaldı)
    bonus_doc = next(b for b in db.bonus_payments.docs if b["_id"] == bid)
    db.bonus_payments.docs[:] = [b for b in db.bonus_payments.docs if b["_id"] != bid]
    db.trash.docs.append({
        "_id": "trash_bonus_1",
        "collection": "bonus_payments",
        "entity_type": "bonus",
        "company_id": "c1",
        "doc": bonus_doc,
    })

    report = _run(linked_moves.scan_orphans(db, "c1"))
    assert report["legacy_bonus_orphans"]
    leg = report["legacy_bonus_orphans"][0]
    assert leg["tx_id"] == "legacy_tx"
    assert leg["trash_id"] == "trash_bonus_1"
    assert report["summary"]["legacy_bonus_orphans"] >= 1

    before_n = len(db.bank_transactions.docs)
    before_bal = db.bank_accounts.docs[0]["current_balance"]
    dry = _run(linked_moves.cleanup_orphans(
        db, "c1", dry_run=True,
        items=[{"tx_id": "legacy_tx"}],
    ))
    assert dry["dry_run"] is True
    assert dry["actions"][0]["result"]["status"] == "would_reverse"
    assert len(db.bank_transactions.docs) == before_n
    assert db.bank_accounts.docs[0]["current_balance"] == before_bal

    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "t"

    with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
        applied = _run(linked_moves.cleanup_orphans(
            db, "c1", dry_run=False,
            items=[{"tx_id": "legacy_tx"}],
            actor={"name": "admin"},
        ))
    assert applied["actions"][0]["result"]["status"] == "reversed"
    assert not any(t.get("_id") == "legacy_tx" for t in db.bank_transactions.docs)
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(1000.0, abs=0.01)


def test_stock_count_reverse(db):
    db.products.docs.append({"_id": "prod1", "stock_quantity": 10})
    sc = {
        "_id": "sc1", "status": "completed", "applied": True, "name": "Sayım",
        "items": [{"product_id": "prod1", "product_name": "X", "expected": 8, "counted": 10}],
    }
    n = _run(linked_moves.reverse_applied_stock_count(db, sc))
    assert n == 1
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(8.0)
    assert db.stock_movements.docs and db.stock_movements.docs[0]["change"] == pytest.approx(-2.0)


def test_heuristic_bonus_match_score():
    bonus = {"amount": 100, "account_id": "a1", "employee_name": "Ali Veli", "period": "2026-03", "type_label": "Avans"}
    tx = {"amount": 100, "account_id": "a1", "description": "Ali Veli - 2026-03 Avans", "category": "Personel Avans"}
    ok, conf = linked_moves._heuristic_bonus_match(bonus, tx)
    assert ok and conf >= 0.55
    bad = {"amount": 99, "account_id": "a1", "description": "x", "category": "Diğer"}
    ok2, _ = linked_moves._heuristic_bonus_match(bonus, bad)
    assert not ok2


def _integrity_http(monkeypatch):
    """linked_moves router + gerçek token audience / require_super_admin."""
    monkeypatch.setenv("JWT_SECRET", "test-system-integrity-jwt-secret-not-default-32b")
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    db = FakeDb()
    db.users = FakeCollection()
    db.platform_settings = FakeCollection()
    db.companies.docs.append({"_id": "c1", "name": "Acme"})
    db.bank_transactions.docs.append({
        "_id": "orphan1", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 40, "bonus_id": "gone", "description": "ghost",
    })
    db.users.docs.append({
        "_id": "sa1", "email": "sa@test.com", "name": "SA",
        "is_super_admin": True, "is_active": True, "role": "admin",
    })
    db.users.docs.append({
        "_id": "admin1", "email": "admin@firma.com", "name": "Firma",
        "is_super_admin": False, "is_active": True, "role": "admin",
        "company_ids": ["c1"], "active_company_id": "c1",
    })

    async def current_user(request: Request):
        token = auth_utils.session_token(request)
        if not token:
            raise HTTPException(status_code=401, detail="Giriş gerekli")
        return await auth_utils.get_user_from_token(
            token, db, request=request, path=request.url.path,
        )

    prev_lm = (linked_moves._db, linked_moves._current_user, linked_moves._reverse_tx_effects)
    prev_saas = (saas._db, saas._current_user)
    linked_moves.init(db, get_current_user=current_user)
    saas.init(db, current_user)
    app = FastAPI()
    app.include_router(linked_moves.router)
    client = TestClient(app)

    def cookie(*, user_id, email, role, sa, aud):
        tok = create_access_token(user_id, email, role, is_super_admin=sa, mfa=sa, aud=aud)
        return {"access_token": tok}

    def restore():
        linked_moves._db, linked_moves._current_user, linked_moves._reverse_tx_effects = prev_lm
        saas._db, saas._current_user = prev_saas
        client.close()

    return client, db, cookie, restore


def test_system_integrity_paths_stay_on_existing_ynt_prefix():
    """Yeni uç /api/system altında; allowlist genişletilmeden ynt'ye açık, admin yolu kapalı."""
    assert ha.is_ynt_allowed_path("/api/system/integrity/orphans")
    assert ha.is_ynt_allowed_path("/api/system/integrity/cleanup")
    assert not ha.is_ynt_allowed_path("/api/admin/integrity/orphans")
    assert not ha.is_ynt_allowed_path("/api/admin/integrity/cleanup")
    assert "/api/admin" not in ha._YNT_ALLOWED_PREFIXES
    assert not any("/integrity" in p for p in ha._YNT_ALLOWED_PREFIXES)


def test_ynt_sa_system_integrity_200_and_admin_path_403(monkeypatch):
    client, db, cookie, restore = _integrity_http(monkeypatch)
    try:
        headers = {"host": "ynt.taiyazilim.com"}
        cookies = cookie(user_id="sa1", email="sa@test.com", role="admin", sa=True, aud=ha.AUD_YNT)
        orphans = client.get(
            "/api/system/integrity/orphans",
            params={"company_id": "c1"},
            headers=headers,
            cookies=cookies,
        )
        assert orphans.status_code == 200, orphans.text
        body = orphans.json()
        assert body["company_id"] == "c1"
        assert body["summary"]["orphan_moves"] >= 1

        missing = client.get(
            "/api/system/integrity/orphans",
            params={"company_id": "no-such"},
            headers=headers,
            cookies=cookies,
        )
        assert missing.status_code == 404

        preview = client.post(
            "/api/system/integrity/cleanup",
            json={"company_id": "c1", "items": [{"source_type": "personnel_bonus", "source_id": "gone"}]},
            headers=headers,
            cookies=cookies,
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["dry_run"] is True
        assert any(t.get("_id") == "orphan1" for t in db.bank_transactions.docs)

        explicit = client.post(
            "/api/system/integrity/cleanup",
            json={"company_id": "c1", "dry_run": False, "items": [{"tx_id": "missing-tx"}]},
            headers=headers,
            cookies=cookies,
        )
        assert explicit.status_code == 200, explicit.text
        assert explicit.json()["dry_run"] is False

        blocked = client.get(
            "/api/admin/integrity/orphans",
            params={"company_id": "c1"},
            headers=headers,
            cookies=cookies,
        )
        assert blocked.status_code == 403
        assert blocked.json().get("detail") == "Bu uç platform yönetimi oturumunda kullanılamaz"
        blocked_post = client.post(
            "/api/admin/integrity/cleanup",
            json={"company_id": "c1", "dry_run": True},
            headers=headers,
            cookies=cookies,
        )
        assert blocked_post.status_code == 403
    finally:
        restore()


def test_system_integrity_non_sa_403(monkeypatch):
    client, _db, cookie, restore = _integrity_http(monkeypatch)
    try:
        cookies = cookie(
            user_id="admin1", email="admin@firma.com", role="admin", sa=False, aud=ha.AUD_APP,
        )
        headers = {"host": "app.tamkobi.com"}
        r = client.get(
            "/api/system/integrity/orphans",
            params={"company_id": "c1"},
            headers=headers,
            cookies=cookies,
        )
        assert r.status_code == 403
        r2 = client.post(
            "/api/system/integrity/cleanup",
            json={"company_id": "c1"},
            headers=headers,
            cookies=cookies,
        )
        assert r2.status_code == 403

        # ynt host + aud=ynt ama sa claim yok → audience 403
        ynt_cookies = cookie(
            user_id="admin1", email="admin@firma.com", role="admin", sa=False, aud=ha.AUD_YNT,
        )
        r3 = client.get(
            "/api/system/integrity/orphans",
            params={"company_id": "c1"},
            headers={"host": "ynt.taiyazilim.com"},
            cookies=ynt_cookies,
        )
        assert r3.status_code == 403
    finally:
        restore()


def test_admin_integrity_still_open_for_company_admin(monkeypatch):
    client, _db, cookie, restore = _integrity_http(monkeypatch)
    try:
        cookies = cookie(
            user_id="admin1", email="admin@firma.com", role="admin", sa=False, aud=ha.AUD_APP,
        )
        headers = {"host": "app.tamkobi.com"}
        r = client.get(
            "/api/admin/integrity/orphans",
            params={"company_id": "c1"},
            headers=headers,
            cookies=cookies,
        )
        assert r.status_code == 200, r.text
        assert r.json()["summary"]["orphan_moves"] >= 1
        preview = client.post(
            "/api/admin/integrity/cleanup",
            json={"company_id": "c1"},
            headers=headers,
            cookies=cookies,
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["dry_run"] is True
    finally:
        restore()
