"""Alınan çek cirosu: hedef cari satırı, kartı ve bakiyesi.

Bellek içi MemDB. Canlı API ve veritabanı kullanmaz.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "tests"))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import account_balance  # noqa: E402
import cheques  # noqa: E402
import contact_balance  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

CO = "co-endorse"
CO_B = "co-other"


def _run(coro):
    return asyncio.run(coro)


def _user(company_id: str = CO) -> dict:
    return {
        "company_ids": [company_id],
        "active_company_id": company_id,
        "is_super_admin": False,
        "role": "admin",
    }


def _balance(db, contact_id: str) -> float:
    row = next(doc for doc in db.contacts.docs if doc["_id"] == contact_id)
    return float(row.get("balance") or 0)


def _card(db, contact_id: str) -> float:
    row = next(doc for doc in db.contacts.docs if doc["_id"] == contact_id)
    return float(row.get("cheque_bond_balance") or 0)


def _endorsement_txs(db, cheque_id: str | None = None):
    rows = [tx for tx in db.bank_transactions.docs if tx.get("cheque_kind") == "endorsement"]
    if cheque_id:
        rows = [tx for tx in rows if tx.get("cheque_id") == cheque_id]
    return rows


@pytest.fixture
def db(monkeypatch):
    database = MemDB()
    monkeypatch.setattr(cheques, "_db", database)
    return database


async def _contacts(db):
    await db.contacts.insert_one({
        "_id": "ersay",
        "company_id": CO,
        "name": "ERSAY HOME ÜRETİM TEDARİK",
        "balance": 0.0,
        "opening_balance": 0.0,
        "cheque_bond_balance": 0.0,
    })
    await db.contacts.insert_one({
        "_id": "nur",
        "company_id": CO,
        "name": "NUR ORMAN ÜRÜNLERİ - KAMİL KAYMAZ",
        "balance": 0.0,
        "opening_balance": 0.0,
        "cheque_bond_balance": 0.0,
    })


async def _receive(db, *, amount, due, number=None, contact_id="ersay"):
    body = {
        "company_id": CO,
        "contact_id": contact_id,
        "direction": "received",
        "instrument": "cheque",
        "amount": amount,
        "due_date": due,
        "bank_name": "Vakıf Bank",
        "serial_no": "0021408",
        "drawer_name": "ERSAY HOME ÜRETİM TEDARİK",
    }
    saved = await cheques.create_cheque(body, _user())
    if number:
        await db.cheques.update_one(
            {"_id": saved["id"], "company_id": CO},
            {"$set": {"number": number}},
        )
        saved["number"] = number
    return saved


def test_endorsement_description_matches_payment_line():
    text = cheques.endorsement_description({
        "number": "CEK-2026-0004",
        "due_date": "2026-11-30",
        "bank_name": "Vakıf Bank",
        "serial_no": "0021408",
        "drawer_name": "ERSAY HOME ÜRETİM TEDARİK",
        "contact_name": "başka",
    })
    assert text == "CEK-2026-0004 · vade 30.11.2026 · Vakıf Bank 0021408 · asıl cari ERSAY HOME ÜRETİM TEDARİK"
    assert cheques.endorsement_category({"instrument": "promissory"}) == "Ciro edilen senet"
    assert cheques.endorsement_category({"instrument": "cheque"}) == "Ciro edilen çek"


def test_open_portfolio_keeps_old_formula_without_endorsee_role():
    rows = [
        {"direction": "received", "status": "open", "amount": 250},
        {"direction": "issued", "status": "open", "amount": 40},
        {"direction": "received", "status": "endorsed", "amount": 999},
    ]
    assert cheques.open_portfolio_balance(rows, "2026-10-21") == 210.0


def test_endorse_posts_one_row_and_sync_does_not_drift(db, monkeypatch):
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    saved = _run(_receive(db, amount=250000, due="2026-11-30", number="CEK-2026-0004"))
    original_before = _balance(db, "ersay")
    card_before = _card(db, "ersay")
    assert card_before == pytest.approx(250000)

    endorsed = _run(cheques.endorse_cheque(saved["id"], {
        "contact_id": "nur",
        "date": "2026-10-21",
        "description": "Ekim ödemesi — çek cirosu",
    }, _user()))
    assert endorsed["status"] == "endorsed"
    assert endorsed["endorsed_to_contact_id"] == "nur"
    assert _balance(db, "nur") == pytest.approx(250000)
    assert _balance(db, "ersay") == pytest.approx(original_before)
    assert _card(db, "ersay") == pytest.approx(0)
    assert _card(db, "nur") == pytest.approx(250000)

    rows = _endorsement_txs(db, saved["id"])
    assert len(rows) == 1
    tx = rows[0]
    assert tx["company_id"] == CO
    assert tx["contact_id"] == "nur"
    assert tx["type"] == "outflow"
    assert tx["account_id"] is None
    assert tx["account_name"] == "Çek Portföyü"
    assert tx["source"] == "cheque"
    assert tx["cheque_kind"] == "endorsement"
    assert tx["category"] == "Ciro edilen çek"
    assert tx["date"] == "2026-10-21"
    assert tx["description"] == "CEK-2026-0004 · vade 30.11.2026 · Vakıf Bank 0021408 · asıl cari ERSAY HOME ÜRETİM TEDARİK"
    assert tx["amount"] == pytest.approx(250000)
    events = next(doc for doc in db.cheques.docs if doc["_id"] == saved["id"])["events"]
    note = next(ev for ev in events if ev.get("action") == "endorsed")
    assert note["note"] == "Ekim ödemesi — çek cirosu"

    live, meta = _run(contact_balance.sync_contact_balance(db, "nur", company_id=CO))
    assert meta["repaired"] is False
    assert live == pytest.approx(250000)
    assert _balance(db, "nur") == pytest.approx(250000)

    overview = _run(server.get_contact_overview("nur", _user()))
    pays = [p for p in overview["payments"] if p.get("cheque_kind") == "endorsement" or str(p.get("category") or "").startswith("Ciro edilen")]
    assert len(pays) == 1
    assert pays[0].get("virtual") is not True
    incoming = [ch for ch in overview["cheques"] if ch.get("role") == "endorsee"]
    assert len(incoming) == 1
    assert incoming[0]["id"] == saved["id"]
    assert overview["contact"]["balance"] == pytest.approx(250000)
    assert overview["contact"]["cheque_bond_balance"] == pytest.approx(250000)
    assert overview["summary"]["balance_repaired"] is False

    again = _run(server.get_contact_overview("nur", _user()))
    assert again["contact"]["balance"] == pytest.approx(250000)
    assert again["contact"]["cheque_bond_balance"] == pytest.approx(250000)
    statement = _run(server.get_contact_statement("nur", _user()))
    assert any(p.get("cheque_kind") == "endorsement" for p in statement["payments"])


def test_two_cheques_card_stays_after_drift_reset(db, monkeypatch):
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    first = _run(_receive(db, amount=250000, due="2026-11-30", number="CEK-2026-0002"))
    second = _run(_receive(db, amount=250000, due="2026-12-15", number="CEK-2026-0003"))
    _run(cheques.endorse_cheque(first["id"], {"contact_id": "nur", "date": "2026-10-21"}, _user()))
    _run(cheques.endorse_cheque(second["id"], {"contact_id": "nur", "date": "2026-10-21"}, _user()))
    assert _balance(db, "nur") == pytest.approx(500000)
    assert _balance(db, "ersay") == pytest.approx(-500000)
    assert _card(db, "ersay") == pytest.approx(0)

    overview = _run(server.get_contact_overview("nur", _user()))
    pays = [p for p in overview["payments"] if p.get("cheque_kind") == "endorsement"]
    assert len(pays) == 2
    assert all(p.get("virtual") is not True for p in pays)
    assert len([ch for ch in overview["cheques"] if ch.get("role") == "endorsee"]) == 2
    assert overview["contact"]["cheque_bond_balance"] == pytest.approx(500000)
    assert overview["contact"]["balance"] == pytest.approx(500000)

    await_card = _card(db, "nur")
    drifted = _run(server.get_contact_overview("nur", _user()))
    assert drifted["contact"]["cheque_bond_balance"] == pytest.approx(await_card)
    assert drifted["contact"]["cheque_bond_balance"] == pytest.approx(500000)
    assert _balance(db, "nur") == pytest.approx(500000)
    original = _run(server.get_contact_overview("ersay", _user()))
    assert original["contact"]["cheque_bond_balance"] == pytest.approx(0)
    assert original["contact"]["balance"] == pytest.approx(-500000)


def test_historical_virtual_then_backfill_once(db, monkeypatch):
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    await_id = "hist-1"
    _run(db.cheques.insert_one({
        "_id": await_id,
        "company_id": CO,
        "contact_id": "ersay",
        "contact_name": "ERSAY HOME ÜRETİM TEDARİK",
        "endorsed_to_contact_id": "nur",
        "endorsed_to_name": "NUR ORMAN ÜRÜNLERİ - KAMİL KAYMAZ",
        "status": "endorsed",
        "direction": "received",
        "instrument": "cheque",
        "number": "CEK-2026-0009",
        "amount": 120000,
        "due_date": "2026-12-01",
        "bank_name": "Ziraat Bankası",
        "serial_no": "0045173",
        "settled_at": "2026-10-01",
        "currency": "TRY",
    }))
    _run(db.contacts.update_one(
        {"_id": "nur", "company_id": CO},
        {"$set": {"balance": 120000}},
    ))
    before_tx = len(db.bank_transactions.docs)
    overview = _run(server.get_contact_overview("nur", _user()))
    virt = [p for p in overview["payments"] if str(p.get("id") or "").startswith("cheque-endorse-virt-")]
    assert len(virt) == 1
    assert virt[0]["virtual"] is True
    assert virt[0]["cheque_id"] == await_id
    assert virt[0]["type"] == "outflow"
    assert overview["contact"]["balance"] == pytest.approx(120000)
    assert len(db.bank_transactions.docs) == before_tx
    assert overview["contact"]["cheque_bond_balance"] == pytest.approx(120000)

    dry = _run(cheques.backfill_endorsement_rows(db, company_id=CO, apply=False))
    assert dry["dry_run"] is True
    assert dry["candidates"] == 1
    assert dry["inserted"] == 0
    assert len(_endorsement_txs(db)) == 0

    applied = _run(cheques.backfill_endorsement_rows(db, company_id=CO, apply=True))
    assert applied["inserted"] == 1
    assert len(_endorsement_txs(db, await_id)) == 1
    assert _endorsement_txs(db, await_id)[0]["account_id"] is None
    again = _run(cheques.backfill_endorsement_rows(db, company_id=CO, apply=True))
    assert again["inserted"] == 0
    assert again["candidates"] == 0
    assert _balance(db, "nur") == pytest.approx(120000)

    after = _run(server.get_contact_overview("nur", _user()))
    pays = [p for p in after["payments"] if p.get("cheque_id") == await_id and (p.get("cheque_kind") == "endorsement" or str(p.get("category") or "").startswith("Ciro edilen"))]
    assert len(pays) == 1
    assert pays[0].get("virtual") is not True
    assert after["contact"]["balance"] == pytest.approx(120000)


def _codes(results):
    codes = []
    for item in results:
        if isinstance(item, HTTPException):
            codes.append(item.status_code)
        elif isinstance(item, Exception):
            raise item
        else:
            codes.append(200)
    return codes


def test_concurrent_endorse_is_single_winner(db):
    _run(_contacts(db))
    saved = _run(_receive(db, amount=80, due="2026-12-01"))

    async def race():
        return await asyncio.gather(
            cheques.endorse_cheque(saved["id"], {"contact_id": "nur"}, _user()),
            cheques.endorse_cheque(saved["id"], {"contact_id": "nur"}, _user()),
            return_exceptions=True,
        )

    assert sorted(_codes(_run(race()))) == [200, 409]
    assert _balance(db, "nur") == pytest.approx(80)
    assert len(_endorsement_txs(db, saved["id"])) == 1
    status = next(doc for doc in db.cheques.docs if doc["_id"] == saved["id"])["status"]
    assert status == "endorsed"


def test_overlapping_endorse_only_atomic_winner_posts(db):
    """İlk istek kilit satırında beklerken ikincisi geçişi alır. Kaybeden bakiye ve satır yazmaz."""
    _run(_contacts(db))
    saved = _run(_receive(db, amount=80, due="2026-12-01"))
    real = db.cheques.update_one_atomic
    started = asyncio.Event()
    release = asyncio.Event()
    calls = {"n": 0}

    async def wrapped(query, update):
        calls["n"] += 1
        if calls["n"] == 1:
            started.set()
            await release.wait()
        return await real(query, update)

    db.cheques.update_one_atomic = wrapped

    async def race():
        first = asyncio.create_task(cheques.endorse_cheque(saved["id"], {"contact_id": "nur"}, _user()))
        await asyncio.wait_for(started.wait(), timeout=2)
        second = await cheques.endorse_cheque(saved["id"], {"contact_id": "nur"}, _user())
        release.set()
        try:
            first_result = await first
        except HTTPException as exc:
            first_result = exc
        return first_result, second

    first_result, second = _run(race())
    assert calls["n"] == 2
    assert isinstance(first_result, HTTPException)
    assert first_result.status_code == 409
    assert second["status"] == "endorsed"
    assert _balance(db, "nur") == pytest.approx(80)
    assert len(_endorsement_txs(db, saved["id"])) == 1
    doc = next(row for row in db.cheques.docs if row["_id"] == saved["id"])
    assert doc["status"] == "endorsed"
    assert len([ev for ev in doc.get("events") or [] if ev.get("action") == "endorsed"]) == 1


def test_bounce_reverses_target_once_and_skips_cash(db):
    _run(_contacts(db))
    _run(db.bank_accounts.insert_one({
        "_id": "acc1",
        "company_id": CO,
        "type": "bank",
        "account_name": "Kasa",
        "current_balance": 1000,
    }))
    saved = _run(_receive(db, amount=40, due="2026-12-01"))
    _run(cheques.endorse_cheque(saved["id"], {"contact_id": "nur"}, _user()))
    assert _balance(db, "nur") == pytest.approx(40)
    assert _card(db, "nur") == pytest.approx(40)

    bounced = _run(cheques.bounce_cheque(saved["id"], {"reason": "karşılıksız"}, _user()))
    assert bounced["status"] == "bounced"
    assert _balance(db, "nur") == pytest.approx(0)
    assert _balance(db, "ersay") == pytest.approx(0)
    assert _card(db, "nur") == pytest.approx(0)
    assert _endorsement_txs(db, saved["id"]) == []
    account = next(doc for doc in db.bank_accounts.docs if doc["_id"] == "acc1")
    assert account["current_balance"] == pytest.approx(1000)

    with pytest.raises(HTTPException) as ei:
        _run(cheques.bounce_cheque(saved["id"], {}, _user()))
    assert ei.value.status_code == 400


def test_unwind_does_not_reverse_endorsement_cash(db):
    _run(db.bank_accounts.insert_one({
        "_id": "acc-cash",
        "company_id": CO,
        "type": "cash_box",
        "current_balance": 800,
    }))
    _run(db.bank_transactions.insert_one({
        "_id": "tx-end",
        "company_id": CO,
        "account_id": "acc-cash",
        "type": "outflow",
        "amount": 50,
        "source": "cheque",
        "cheque_kind": "endorsement",
        "cheque_id": "ch-x",
    }))
    _run(cheques._unwind_bank("ch-x", company_id=CO))
    account = next(doc for doc in db.bank_accounts.docs if doc["_id"] == "acc-cash")
    assert account["current_balance"] == pytest.approx(800)
    assert db.bank_transactions.docs == []


def test_overdue_endorsement_drops_off_card_original_drops_once(db, monkeypatch):
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    future = "2099-12-31"
    overdue = _run(_receive(db, amount=70, due="2020-01-01"))
    fresh = _run(_receive(db, amount=30, due=future))
    assert _card(db, "ersay") == pytest.approx(100)
    _run(cheques.endorse_cheque(overdue["id"], {"contact_id": "nur"}, _user()))
    assert _card(db, "ersay") == pytest.approx(30)
    assert _card(db, "nur") == pytest.approx(0)
    _run(cheques.endorse_cheque(fresh["id"], {"contact_id": "nur"}, _user()))
    assert _card(db, "ersay") == pytest.approx(0)
    assert _card(db, "nur") == pytest.approx(30)
    overview = _run(server.get_contact_overview("nur", _user()))
    assert overview["contact"]["cheque_bond_balance"] == pytest.approx(30)
    listed = {ch["id"]: ch for ch in overview["cheques"]}
    assert listed[overdue["id"]]["role"] == "endorsee"
    assert listed[fresh["id"]]["role"] == "endorsee"
    original = _run(server.get_contact_overview("ersay", _user()))
    assert original["contact"]["cheque_bond_balance"] == pytest.approx(0)
    assert _card(db, "ersay") == pytest.approx(0)


def test_other_company_cheque_and_contact_are_hidden(db, monkeypatch):
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    _run(db.contacts.insert_one({
        "_id": "foreign",
        "company_id": CO_B,
        "name": "Yabancı",
        "balance": 10,
        "opening_balance": 10,
    }))
    saved = _run(_receive(db, amount=15, due="2099-01-01"))
    with pytest.raises(HTTPException) as missing_contact:
        _run(cheques.endorse_cheque(saved["id"], {"contact_id": "foreign"}, _user()))
    assert missing_contact.value.status_code == 404
    assert next(doc for doc in db.cheques.docs if doc["_id"] == saved["id"])["status"] == "open"

    _run(db.cheques.insert_one({
        "_id": "b-cheque",
        "company_id": CO_B,
        "contact_id": "foreign",
        "status": "open",
        "direction": "received",
        "instrument": "cheque",
        "amount": 999,
        "due_date": "2099-01-01",
        "number": "CEK-B",
    }))
    with pytest.raises(HTTPException) as other:
        _run(cheques.endorse_cheque("b-cheque", {"contact_id": "nur"}, _user()))
    assert other.value.status_code == 404

    _run(db.cheques.update_one(
        {"_id": "b-cheque", "company_id": CO_B},
        {"$set": {"status": "endorsed", "endorsed_to_contact_id": "nur", "endorsed_to_name": "NUR"}},
    ))
    overview = _run(server.get_contact_overview("nur", _user()))
    ids = {ch.get("id") or ch.get("_id") for ch in overview["cheques"]}
    assert "b-cheque" not in ids
    assert _balance(db, "foreign") == pytest.approx(10)


def test_endorsement_row_cannot_be_edited_or_deleted(db, monkeypatch):
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    saved = _run(_receive(db, amount=25, due="2099-01-01"))
    _run(cheques.endorse_cheque(saved["id"], {"contact_id": "nur"}, _user()))
    tx = _endorsement_txs(db, saved["id"])[0]
    with pytest.raises(HTTPException) as edited:
        _run(server.update_bank_transaction(tx["_id"], {"amount": 1, "description": "değişti"}, _user()))
    assert edited.value.status_code == 400
    with pytest.raises(HTTPException) as deleted:
        _run(server.delete_bank_transaction(tx["_id"], _user()))
    assert deleted.value.status_code == 400
    assert _endorsement_txs(db, saved["id"])[0]["amount"] == pytest.approx(25)
    assert _balance(db, "nur") == pytest.approx(25)


def test_account_recalc_unchanged_by_endorse(db, monkeypatch):
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    _run(db.bank_accounts.insert_one({
        "_id": "acc-int",
        "company_id": CO,
        "type": "bank",
        "account_name": "Entegre",
        "current_balance": 1000,
    }))
    _run(db.bank_transactions.insert_one({
        "_id": "tx-ledger",
        "company_id": CO,
        "account_id": "acc-int",
        "type": "inflow",
        "amount": 1000,
        "source": "manual",
        "date": "2026-10-01",
    }))
    _run(db.bank_connections.insert_one({
        "_id": "conn-1",
        "company_id": CO,
        "linked_account_id": "acc-int",
    }))
    before = _run(account_balance.recalc_account_balance(db, "acc-int", company_id=CO))
    preview_before = _run(server.recalculate_account_balances({"company_id": CO, "dry_run": True}, _user()))
    saved = _run(_receive(db, amount=60, due="2099-06-01"))
    _run(cheques.endorse_cheque(saved["id"], {"contact_id": "nur"}, _user()))
    after = _run(account_balance.recalc_account_balance(db, "acc-int", company_id=CO))
    preview_after = _run(server.recalculate_account_balances({"company_id": CO, "dry_run": True}, _user()))
    assert before == pytest.approx(after)
    assert before == pytest.approx(1000)
    assert preview_before["affected_count"] == preview_after["affected_count"] == 0
    account = next(doc for doc in db.bank_accounts.docs if doc["_id"] == "acc-int")
    assert account["current_balance"] == pytest.approx(1000)


def test_validation_stays_400(db):
    _run(_contacts(db))
    saved = _run(_receive(db, amount=10, due="2099-01-01"))
    issued = _run(cheques.create_cheque({
        "company_id": CO,
        "contact_id": "ersay",
        "direction": "issued",
        "instrument": "cheque",
        "amount": 5,
        "due_date": "2099-01-01",
    }, _user()))
    with pytest.raises(HTTPException) as same:
        _run(cheques.endorse_cheque(saved["id"], {"contact_id": "ersay"}, _user()))
    assert same.value.status_code == 400
    with pytest.raises(HTTPException) as bare:
        _run(cheques.endorse_cheque(saved["id"], {}, _user()))
    assert bare.value.status_code == 400
    with pytest.raises(HTTPException) as wrong:
        _run(cheques.endorse_cheque(issued["id"], {"contact_id": "nur"}, _user()))
    assert wrong.value.status_code == 400
    assert next(doc for doc in db.cheques.docs if doc["_id"] == saved["id"])["status"] == "open"


def test_source_guard_rejects_portfolio_and_endorsement(db, monkeypatch):
    import linked_moves
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    saved = _run(_receive(db, amount=25, due="2099-01-01"))
    portfolio = next(tx for tx in db.bank_transactions.docs if tx.get("cheque_kind") == "portfolio")
    portfolio_detail = linked_moves.source_guard_detail(portfolio)
    assert portfolio_detail
    assert "portföy" in portfolio_detail
    assert "/cheques" in portfolio_detail
    with pytest.raises(HTTPException) as portfolio_edit:
        _run(server.update_bank_transaction(portfolio["_id"], {"amount": 1}, _user()))
    assert portfolio_edit.value.status_code == 400
    assert "portföy" in portfolio_edit.value.detail
    with pytest.raises(HTTPException) as portfolio_delete:
        _run(server.delete_bank_transaction(portfolio["_id"], _user()))
    assert portfolio_delete.value.status_code == 400
    assert next(tx for tx in db.bank_transactions.docs if tx["_id"] == portfolio["_id"])["amount"] == pytest.approx(25)

    _run(cheques.endorse_cheque(saved["id"], {"contact_id": "nur"}, _user()))
    endorsement = _endorsement_txs(db, saved["id"])[0]
    endorsement_detail = linked_moves.source_guard_detail(endorsement)
    assert endorsement_detail
    assert "ciro" in endorsement_detail
    assert saved["id"] in endorsement_detail
    with pytest.raises(HTTPException) as edited:
        _run(server.update_bank_transaction(endorsement["_id"], {"amount": 1, "description": "değişti"}, _user()))
    assert edited.value.status_code == 400
    assert "ciro" in edited.value.detail
    with pytest.raises(HTTPException) as deleted:
        _run(server.delete_bank_transaction(endorsement["_id"], _user()))
    assert deleted.value.status_code == 400
    assert _endorsement_txs(db, saved["id"])[0]["amount"] == pytest.approx(25)

    bank_row = {
        "source": "cheque_bank",
        "cheque_id": saved["id"],
        "cheque_kind": "bank",
        "account_id": "acc-real",
        "account_name": "Kasa",
        "amount": 25,
    }
    assert linked_moves.source_guard_detail(bank_row) is None
    linked_moves.assert_not_source_linked({"amount": 5, "source": "manual"})


def test_cashflow_and_accountant_skip_accountless_cheque_rows(db, monkeypatch):
    import server

    _run(_contacts(db))
    monkeypatch.setattr(server, "db", db)
    _run(db.bank_accounts.insert_one({
        "_id": "acc-cashflow",
        "company_id": CO,
        "type": "bank",
        "account_name": "Vadesiz",
        "current_balance": 1000,
    }))
    saved = _run(_receive(db, amount=250, due="2099-01-01"))
    for tx in db.bank_transactions.docs:
        if tx.get("cheque_kind") == "portfolio":
            tx["date"] = "2026-10-05"
    _run(cheques.endorse_cheque(saved["id"], {"contact_id": "nur", "date": "2026-10-21"}, _user()))
    _run(db.bank_transactions.insert_one({
        "_id": "tx-bank-in",
        "company_id": CO,
        "account_id": "acc-cashflow",
        "account_name": "Vadesiz",
        "type": "inflow",
        "amount": 500,
        "source": "manual",
        "category": "Tahsilat",
        "date": "2026-10-10",
    }))
    _run(db.bank_transactions.insert_one({
        "_id": "tx-cheque-bank",
        "company_id": CO,
        "account_id": "acc-cashflow",
        "account_name": "Vadesiz",
        "type": "inflow",
        "amount": 80,
        "source": "cheque_bank",
        "cheque_kind": "bank",
        "cheque_id": saved["id"],
        "category": "Çek Tahsilatı",
        "date": "2026-10-11",
    }))
    _run(db.bank_transactions.insert_one({
        "_id": "tx-slip",
        "company_id": CO,
        "account_id": None,
        "type": "outflow",
        "amount": 20,
        "source": "manual",
        "category": "Cari fiş",
        "date": "2026-10-12",
    }))

    report = _run(server.get_report(
        "cashflow", company_id=CO, date_from="2026-10-01", date_to="2026-10-31", user=_user(),
    ))
    assert report["totals"]["inflow"] == pytest.approx(580)
    assert report["totals"]["outflow"] == pytest.approx(20)
    names = {row["name"] for row in report["categories"]}
    assert "Ciro edilen çek" not in names
    assert "Alınan Çek" not in names

    summary = _run(server.accountant_summary(company_id=CO, month="2026-10", user=_user()))
    assert summary["cash"]["inflow"] == pytest.approx(580)
    assert summary["cash"]["outflow"] == pytest.approx(20)
    assert summary["cash"]["count"] == 3


def _backfill_script():
    import importlib.util

    path = _BACKEND / "scripts" / "backfill_cheque_endorsements.py"
    spec = importlib.util.spec_from_file_location("backfill_cheque_endorsements", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backfill_cli_requires_company_and_explicit_connection(monkeypatch):
    module = _backfill_script()
    source = Path(module.__file__).read_text(encoding="utf-8")
    assert "load_dotenv" not in source
    assert "MySQLClient" not in source
    monkeypatch.setenv("MYSQL_HOST", "live.internal")
    monkeypatch.setenv("MYSQL_PASSWORD", "from-env")
    monkeypatch.setenv("MONGO_URL", "mongodb://live.internal/tamkobi")

    with pytest.raises(SystemExit) as missing_company:
        module.resolve_request([])
    assert "company" in str(missing_company.value).lower() or "--company" in str(missing_company.value)

    with pytest.raises(SystemExit) as both:
        module.resolve_request(["--company", "c1", "--all-companies", "--mysql-url", "mysql://u@h/db"])
    assert "Yalnızca" in str(both.value)

    with pytest.raises(SystemExit) as no_dsn:
        module.resolve_request(["--company", "c1"])
    assert ".env" in str(no_dsn.value)

    with pytest.raises(SystemExit) as apply_without_dsn:
        module.resolve_request(["--all-companies", "--apply"])
    assert ".env" in str(apply_without_dsn.value)

    with pytest.raises(SystemExit):
        module.resolve_request(["--company", "c1", "--mysql-url", "mysql://u@h/db", "--dry-run"])

    with pytest.raises(SystemExit) as mongo:
        module.resolve_request(["--company", "c1", "--mongo-url", "mongodb://localhost/tamkobi"])
    assert "mysql://" in str(mongo.value)

    dry = module.resolve_request(["--company", "c1", "--mysql-url", "mysql://user:secret@db.example:3307/tamkobi_test"])
    assert dry["company_id"] == "c1"
    assert dry["all_companies"] is False
    assert dry["apply"] is False
    assert dry["settings"]["host"] == "db.example"
    assert dry["settings"]["port"] == 3307
    assert dry["settings"]["user"] == "user"
    assert dry["settings"]["password"] == "secret"
    assert dry["settings"]["db"] == "tamkobi_test"
    assert dry["settings"]["host"] != "live.internal"

    flagged = module.resolve_request([
        "--all-companies", "--apply",
        "--mysql-host", "explicit.db", "--mysql-user", "cli", "--mysql-db", "tam",
        "--mysql-password", "cli-secret", "--mysql-port", "3308",
    ])
    assert flagged["company_id"] is None
    assert flagged["all_companies"] is True
    assert flagged["apply"] is True
    assert flagged["settings"]["host"] == "explicit.db"
    assert flagged["settings"]["password"] == "cli-secret"
    assert flagged["settings"]["password"] != "from-env"
    assert flagged["settings"]["db"] == "tam"
    assert flagged["settings"]["port"] == 3308


def test_portfolio_with_account_is_not_locked():
    import linked_moves

    booked = {
        "cheque_kind": "portfolio",
        "cheque_id": "ch-booked",
        "source": "cheque",
        "account_id": "acc-1",
        "account_name": "Kasa",
        "category": "Alınan Çek",
        "amount": 10,
    }
    assert cheques.cheque_ledger_lock_detail(booked) is None
    linked_moves.assert_not_source_linked(booked)
    open_row = {**booked, "account_id": None, "account_name": "Çek Portföyü"}
    detail = cheques.cheque_ledger_lock_detail(open_row)
    assert detail
    assert "portföy" in detail


def test_ciro_category_without_cheque_link_stays_cash():
    plain = {
        "account_id": None,
        "type": "outflow",
        "amount": 40,
        "source": "manual",
        "category": "Ciro edilen çek",
    }
    assert cheques.is_noncash_cheque_movement(plain) is False
    assert cheques.is_noncash_cheque_movement({**plain, "source": "cheque"}) is True
    assert cheques.is_noncash_cheque_movement({**plain, "cheque_id": "ch-9"}) is True
