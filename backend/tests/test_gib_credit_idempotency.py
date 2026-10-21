"""Kontör tek düşüm, yeniden gönderim ve İşNet kontör hata mesajları.

Ağ yok. Canlı veritabanı yok. Script çalıştırılmaz; plan saf bir sahte koleksiyonla ölçülür.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, patch
from xml.etree import ElementTree as ET

import httpx
import pytest
from fastapi import HTTPException

import e_invoice
import gib_credits
import saas
from mysql_store import DuplicateKeyError, unique_conflict

COMP = "co_kontor_idem_3a32"
INV = "inv_kontor_idem_3a32"
WALLET = "wal_kontor_idem_3a32"
ISSUE_COMP = "co_kontor_issue_3a32"
SECRET = "SECRET-KONTOR-3a32"
TAX = "9988776655"
ETTN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "gib_credit_dedupe.py"
CONSUME_FILTER = {"type": "consume", "invoice_id": {"$gt": ""}}


def _run(coro):
    return asyncio.run(coro)


def _load_script():
    spec = importlib.util.spec_from_file_location("gib_credit_dedupe", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(autouse=True)
def _reset_consume_index_state():
    gib_credits._consume_index_state = "pending"
    gib_credits._welcome_index_state = "pending"
    gib_credits._gift_index_state = "pending"
    yield
    gib_credits._consume_index_state = "pending"
    gib_credits._welcome_index_state = "pending"
    gib_credits._gift_index_state = "pending"


class _Rows:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, limit=None):
        if limit is None:
            return [dict(row) for row in self.rows]
        return [dict(row) for row in self.rows[: int(limit)]]


class _Ledger:
    def __init__(self, docs=None, *, blind_find=False):
        self.docs = [dict(row) for row in (docs or [])]
        self.blind_find = blind_find
        self.index = None

    def find(self, query=None, projection=None):
        query = query or {}
        rows = []
        for row in self.docs:
            if all(row.get(key) == value for key, value in query.items()):
                rows.append(row)
        return _Rows(rows)

    async def find_one(self, query=None):
        if self.blind_find:
            return None
        for row in self.find(query).rows:
            return dict(row)
        return None

    async def insert_one(self, doc):
        if any(row.get("_id") == doc.get("_id") for row in self.docs):
            raise DuplicateKeyError("duplicate id")
        if doc.get("type") == "consume" and str(doc.get("invoice_id") or "").strip():
            for row in self.docs:
                if (
                    row.get("type") == "consume"
                    and row.get("company_id") == doc.get("company_id")
                    and row.get("invoice_id") == doc.get("invoice_id")
                ):
                    raise DuplicateKeyError("duplicate consume")
        self.docs.append(dict(doc))

    async def create_index(self, keys, unique=False, **kwargs):
        self.index = {"keys": keys, "unique": unique, **kwargs}


class _Wallets:
    def __init__(self, doc):
        self.doc = dict(doc)
        self.updates = []

    async def find_one(self, query=None):
        if (query or {}).get("_id") == self.doc.get("_id"):
            return dict(self.doc)
        return None

    async def insert_one(self, doc):
        raise AssertionError("cüzdan yeniden yazılmamalı")

    async def update_one(self, query, update, upsert=False):
        if (query or {}).get("_id") != self.doc.get("_id"):
            return
        inc = int(((update or {}).get("$inc") or {}).get("balance") or 0)
        self.doc["balance"] = int(self.doc.get("balance") or 0) + inc
        self.updates.append(update)


class _DB:
    def __init__(self, wallet, ledger):
        self.gib_wallets = wallet
        self.gib_credit_ledger = ledger


def _bind_wallet(balance=5, *, blind_find=False, ledger_docs=None):
    wallet = _Wallets({"_id": WALLET, "balance": balance})
    ledger = _Ledger(ledger_docs, blind_find=blind_find)
    db = _DB(wallet, ledger)
    gib_credits.init(db)
    return db


def test_partial_unique_index_ignores_welcome_and_empty_invoice():
    indexes = [(("company_id", "invoice_id", "type"), True, dict(CONSUME_FILTER))]
    welcome = {"_id": "w", "company_id": COMP, "type": "welcome", "credits": 50}
    unique_conflict(welcome, [dict(welcome, _id="w2")], indexes, "gib_credit_ledger")
    empty = {"_id": "e1", "company_id": COMP, "invoice_id": "", "type": "consume"}
    unique_conflict(empty, [dict(empty, _id="e2")], indexes, "gib_credit_ledger")
    first = {"_id": "c1", "company_id": COMP, "invoice_id": INV, "type": "consume"}
    with pytest.raises(DuplicateKeyError):
        unique_conflict(dict(first, _id="c2"), [first], indexes, "gib_credit_ledger")


def test_ensure_index_skips_when_duplicates_exist(caplog):
    ledger = _Ledger([
        {"_id": "a", "company_id": COMP, "invoice_id": INV, "type": "consume", "created_at": "2026-01-01"},
        {"_id": "b", "company_id": COMP, "invoice_id": INV, "type": "consume", "created_at": "2026-01-02"},
        {"_id": "welcome", "company_id": COMP, "type": "welcome", "credits": 50},
    ])
    db = _DB(_Wallets({"_id": WALLET, "balance": 5}), ledger)
    with caplog.at_level(logging.WARNING, logger="TamKobiERP"):
        _run(gib_credits.ensure_consume_index(db))
    assert ledger.index is None
    assert "duplicate_groups=1" in caplog.text
    assert TAX not in caplog.text
    assert ETTN not in caplog.text


def test_consume_same_invoice_drops_balance_once():
    db = _bind_wallet(5)

    async def go():
        with patch.object(saas, "license_id_of", new=AsyncMock(return_value=WALLET)):
            first = await gib_credits.consume(COMP, 1, invoice_id=INV, note="FTR-1")
            second = await gib_credits.consume(COMP, 1, invoice_id=INV, note="FTR-1")
            return first, second

    first, second = _run(go())
    consumes = [row for row in db.gib_credit_ledger.docs if row.get("type") == "consume"]
    assert first == 4
    assert second == 4
    assert len(consumes) == 1
    assert db.gib_wallets.doc["balance"] == 4
    assert len(db.gib_wallets.updates) == 1
    assert db.gib_credit_ledger.index["unique"] is True
    assert db.gib_credit_ledger.index["partialFilterExpression"] == CONSUME_FILTER


def test_consume_duplicate_key_does_not_decrement_again():
    db = _bind_wallet(5, blind_find=True)

    async def go():
        with patch.object(saas, "license_id_of", new=AsyncMock(return_value=WALLET)):
            first = await gib_credits.consume(COMP, 1, invoice_id=INV)
            second = await gib_credits.consume(COMP, 1, invoice_id=INV)
            return first, second

    first, second = _run(go())
    consumes = [row for row in db.gib_credit_ledger.docs if row.get("type") == "consume"]
    assert first == 4
    assert second == 4
    assert len(consumes) == 1
    assert db.gib_wallets.doc["balance"] == 4


def _issue_db(inv, settings):
    contact = {"_id": "cnt_kontor_3a32", "name": "Alici", "tax_number_or_id": "12345678901"}
    company = {"_id": ISSUE_COMP, "name": "Firma", "tax_number": "1234567801"}

    class DB:
        pass

    fake = DB()

    async def find_one(query=None):
        query = query or {}
        if query.get("_id") == inv["_id"]:
            return inv
        if query.get("_id") == contact["_id"]:
            return contact
        if query.get("_id") == company["_id"]:
            return company
        if query.get("company_id") == ISSUE_COMP:
            return settings
        return None

    fake.invoices = type("C", (), {})()
    fake.invoices.find_one = AsyncMock(side_effect=find_one)
    fake.invoices.update_one = AsyncMock()
    fake.contacts = type("C", (), {})()
    fake.contacts.find_one = AsyncMock(return_value=contact)
    fake.contacts.update_one = AsyncMock()
    fake.companies = type("C", (), {})()
    fake.companies.find_one = AsyncMock(return_value=company)
    fake.einvoice_settings = type("C", (), {})()
    fake.einvoice_settings.find_one = AsyncMock(return_value=settings)
    fake.outgoing_einvoice_xml = type("C", (), {})()
    fake.outgoing_einvoice_xml.update_one = AsyncMock()
    return fake


def test_issue_invoice_already_sent_is_409_without_credit():
    inv = {
        "_id": "inv_kontor_sent_3a32",
        "company_id": ISSUE_COMP,
        "invoice_type": "sales",
        "e_type": "e_archive",
        "status": "approved",
        "einvoice_state": "sent",
        "gib_uuid": ETTN,
        "gib_tracking_id": "GIB-ONCE",
        "invoice_number": "FTR-SENT-3a32",
        "items": [],
    }
    consume = AsyncMock(return_value=9)
    e_invoice.init(_issue_db(inv, {"status": "simulated"}), {"consume_credits": consume})

    async def go():
        with pytest.raises(HTTPException) as exc:
            await e_invoice.issue_invoice(inv["_id"], company_id=ISSUE_COMP, e_type="e_archive")
        return exc.value

    err = _run(go())
    assert err.status_code == 409
    assert err.detail == "Bu belge zaten gönderildi."
    consume.assert_not_called()
    e_invoice._db.invoices.update_one.assert_not_called()


def test_issue_invoice_queued_with_tracking_is_409():
    inv = {
        "_id": "inv_kontor_queued_3a32",
        "company_id": ISSUE_COMP,
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "einvoice_state": "queued",
        "gib_tracking_id": "GIB-QUEUE",
        "invoice_number": "FTR-QUEUE-3a32",
        "items": [],
    }
    consume = AsyncMock(return_value=9)
    e_invoice.init(_issue_db(inv, {"status": "simulated"}), {"consume_credits": consume})
    with pytest.raises(HTTPException) as exc:
        _run(e_invoice.issue_invoice(inv["_id"], company_id=ISSUE_COMP, e_type="e_invoice"))
    assert exc.value.status_code == 409
    assert exc.value.detail == e_invoice.ALREADY_SUBMITTED_DETAIL
    consume.assert_not_called()


def test_configured_integrator_rejects_unsupported_type_without_credit_or_gib_tracking():
    inv = {
        "_id": "inv_kontor_export_3a32",
        "company_id": ISSUE_COMP,
        "invoice_type": "sales",
        "e_type": "e_export",
        "status": "draft",
        "contact_id": "cnt_kontor_3a32",
        "contact_name": "Alici",
        "contact_tax_id": "12345678901",
        "invoice_number": "FTR-EXP-3a32",
        "items": [],
    }
    settings = {
        "provider": "isnet",
        "status": "configured",
        "mode": "test",
        "company_tax_id": TAX,
        "password_enc": SECRET,
    }
    consume = AsyncMock(return_value=9)
    fake = _issue_db(inv, settings)
    e_invoice.init(fake, {"consume_credits": consume, "password_fn": lambda _settings: SECRET})

    async def go():
        with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")), patch.object(
            e_invoice.isnet, "send_document", AsyncMock(side_effect=AssertionError("canlı gönderim yok"))
        ) as send:
            with pytest.raises(HTTPException) as exc:
                await e_invoice.issue_invoice(inv["_id"], company_id=ISSUE_COMP, e_type="e_export")
        return exc.value, send

    err, send = _run(go())
    assert err.status_code == 400
    assert err.detail == "Bu belge türü entegratörünüz üzerinden henüz desteklenmiyor."
    consume.assert_not_called()
    send.assert_not_called()
    for call in fake.invoices.update_one.await_args_list:
        blob = json.dumps(call.args[1], ensure_ascii=False, default=str)
        assert "GIB-" not in blob
        assert SECRET not in blob
        assert TAX not in blob


def _credit_user():
    cid = "co_kontor_cred_3a32"
    return cid, {"company_ids": [cid], "active_company_id": cid, "is_super_admin": False}


def _credit_db(settings):
    fake = type("DB", (), {})()
    fake.einvoice_settings = type("C", (), {})()
    fake.einvoice_settings.find_one = AsyncMock(return_value=settings)
    e_invoice.init(fake, {"password_fn": lambda _settings: SECRET})
    return fake


def test_integrator_credits_maps_403_fault_network_parse_and_missing_field(caplog):
    cid, user = _credit_user()
    settings = {
        "provider": "isnet",
        "status": "configured",
        "mode": "test",
        "company_tax_id": TAX,
        "password_enc": SECRET,
    }
    _credit_db(settings)

    async def expect(effect, status, detail):
        with patch.object(e_invoice.isnet, "get_company_balance", AsyncMock(side_effect=effect)) as bal:
            with pytest.raises(HTTPException) as exc:
                await e_invoice.api_integrator_credits(cid, user=user)
        bal.assert_awaited()
        assert exc.value.status_code == status
        assert exc.value.detail == detail
        assert SECRET not in exc.value.detail
        assert TAX not in exc.value.detail
        assert ETTN not in exc.value.detail

    with caplog.at_level(logging.WARNING, logger="tamkobi.e_invoice"):
        _run(expect(
            HTTPException(status_code=403, detail=f"forbidden {SECRET} {TAX} {ETTN}"),
            403,
            e_invoice.CREDIT_IP_DETAIL,
        ))
        _run(expect(
            HTTPException(status_code=502, detail=f"SOAP Fault {ETTN}"),
            502,
            e_invoice.CREDIT_FAULT_DETAIL,
        ))
        _run(expect(httpx.ConnectError(f"down {SECRET}"), 502, e_invoice.CREDIT_NETWORK_DETAIL))
        _run(expect(ET.ParseError("not xml"), 502, e_invoice.CREDIT_PARSE_DETAIL))
        with patch.object(
            e_invoice.isnet,
            "get_company_balance",
            AsyncMock(return_value={"message": "OK", "used_credit": ""}),
        ):
            missing = _run(e_invoice.api_integrator_credits(cid, user=user))
    assert missing["balance"] is None
    assert missing["message"] == e_invoice.CREDIT_BALANCE_MISSING_DETAIL
    assert missing["source"] == "isnet"
    text = caplog.text
    assert "action=GetCompanyBalance" in text
    assert "http_status=403" in text
    assert "mode=test" in text
    assert "einvoiceservicetest.isnet.net.tr" in text
    assert SECRET not in text
    assert TAX not in text
    assert ETTN not in text


def test_integrator_credits_portal_uses_get_kontor():
    cid, user = _credit_user()
    settings = {"provider": "isnet_portal", "status": "configured", "mode": "test", "company_tax_id": TAX}
    _credit_db(settings)
    seen = {}

    class FakePortal:
        def __init__(self, portal_settings, password):
            seen["password"] = password
            seen["settings"] = portal_settings

        async def login(self):
            return {"ok": True}

        async def get_kontor(self):
            seen["kontor"] = True
            return {"remaining_credits": 15, "raw_text": "Kalan Kontör : 15"}

        async def aclose(self):
            seen["closed"] = True

    async def go():
        with patch.object(e_invoice.isnet, "get_company_balance", AsyncMock(side_effect=AssertionError("soap yok"))), patch.object(
            e_invoice.isnet_portal, "IsnetPortalClient", FakePortal
        ):
            return await e_invoice.api_integrator_credits(cid, user=user)

    out = _run(go())
    assert out["balance"] == 15
    assert out["provider"] == "isnet_portal"
    assert out["source"] == "isnet_portal"
    assert seen["kontor"] is True
    assert seen["closed"] is True
    assert seen["password"] == SECRET
    assert SECRET not in json.dumps(out)
    assert TAX not in json.dumps(out)


def test_unconfigured_integrator_credits_does_not_call_isnet():
    cid, user = _credit_user()
    cases = (
        {},
        {"provider": "isnet", "status": "simulated", "mode": "test", "company_tax_id": TAX, "password_enc": SECRET},
        {"provider": "isnet_portal", "status": "error", "password_enc": SECRET},
        {"status": "configured"},
    )
    for settings in cases:
        assert e_invoice.configured_real_integrator(settings) is False
        _credit_db(settings)

        async def go():
            with patch.object(
                e_invoice.isnet, "get_company_balance", AsyncMock(side_effect=AssertionError("soap yok"))
            ) as soap, patch.object(
                e_invoice.isnet_portal, "IsnetPortalClient", side_effect=AssertionError("portal yok")
            ):
                out = await e_invoice.api_integrator_credits(cid, user=user)
            return out, soap

        out, soap = _run(go())
        soap.assert_not_called()
        assert out["balance"] is None
        assert out["source"] == "none"
        assert out["message"] == "Entegratör yapılandırılmamış — kontör bilgisi alınamadı."
        blob = json.dumps(out)
        assert SECRET not in blob
        assert TAX not in blob


class _ScriptColl:
    def __init__(self, docs):
        self.docs = [dict(row) for row in docs]

    def find(self, query=None, projection=None):
        return _Rows(self.docs)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, query, update, upsert=False):
        target = next((row for row in self.docs if row.get("_id") == (query or {}).get("_id")), None)
        if target is None:
            return
        inc = int(((update or {}).get("$inc") or {}).get("balance") or 0)
        target["balance"] = int(target.get("balance") or 0) + inc


def _script_db():
    mod = _load_script()
    ledger = _ScriptColl([
        {"_id": "keep", "company_id": COMP, "invoice_id": INV, "wallet_id": WALLET, "type": "consume", "credits": -1, "created_at": "2026-01-01T00:00:00"},
        {"_id": "extra1", "company_id": COMP, "invoice_id": INV, "wallet_id": WALLET, "type": "consume", "credits": -1, "created_at": "2026-01-02T00:00:00"},
        {"_id": "extra2", "company_id": COMP, "invoice_id": INV, "wallet_id": WALLET, "type": "consume", "credits": -1, "created_at": "2026-01-03T00:00:00"},
        {"_id": "other", "company_id": COMP, "invoice_id": "inv_other_3a32", "wallet_id": WALLET, "type": "consume", "credits": -1, "created_at": "2026-01-04T00:00:00"},
    ])
    wallets = _ScriptColl([{"_id": WALLET, "balance": 10}])
    invoices = _ScriptColl([
        {
            "_id": "invdoc1",
            "integrator": "isnet",
            "gib_tracking_id": "GIB-20261021-ABCDEF",
            "invoice_number": "FTR-DED-1",
            "tax_number": TAX,
            "gib_uuid": ETTN,
        },
        {
            "_id": "invdoc2",
            "integrator": "isnet",
            "gib_tracking_id": ETTN,
            "invoice_number": "FTR-REAL-1",
            "tax_number": TAX,
        },
        {
            "_id": "invdoc3",
            "integrator": "simulated",
            "gib_tracking_id": "GIB-LOCAL",
            "invoice_number": "FTR-SIM-1",
        },
        {
            "_id": "invdoc4",
            "integrator": "isnet_portal",
            "gib_tracking_id": "GIB-PORTAL",
            "invoice_number": "FTR-DED-2",
            "buyer_tax_id": TAX,
        },
    ])
    db = type("DB", (), {})()
    db.gib_credit_ledger = ledger
    db.gib_wallets = wallets
    db.invoices = invoices
    return mod, db


def test_dedupe_script_dry_run_writes_nothing():
    mod, db = _script_db()
    before_ledger = len(db.gib_credit_ledger.docs)
    report = _run(mod.run(db, apply=False))
    assert report["dry_run"] is True
    assert report["applied"] is False
    assert report["duplicate_groups"] == 1
    assert report["reversal_count"] == 2
    assert report["wallet_increments"] == [{"wallet_id": WALLET, "credits": 2}]
    assert report["simulated_integrator_invoices"] == {
        "count": 2,
        "invoice_numbers": ["FTR-DED-1", "FTR-DED-2"],
    }
    blob = json.dumps(report, ensure_ascii=False)
    assert TAX not in blob
    assert ETTN not in blob
    assert SECRET not in blob
    assert len(db.gib_credit_ledger.docs) == before_ledger
    assert db.gib_wallets.docs[0]["balance"] == 10


def test_dedupe_script_apply_writes_reversal_once():
    mod, db = _script_db()
    report = _run(mod.run(db, apply=True))
    assert report["dry_run"] is False
    assert report["reversal_count"] == 2
    reversals = [row for row in db.gib_credit_ledger.docs if row.get("type") == "dedupe_reversal"]
    consumes = [row for row in db.gib_credit_ledger.docs if row.get("type") == "consume" and row.get("invoice_id") == INV]
    assert len(consumes) == 3
    assert {row["_id"] for row in consumes} == {"keep", "extra1", "extra2"}
    assert len(reversals) == 2
    assert all(row["credits"] == 1 for row in reversals)
    assert {row["reverses"] for row in reversals} == {"extra1", "extra2"}
    assert db.gib_wallets.docs[0]["balance"] == 12
    again = _run(mod.run(db, apply=True))
    assert again["reversal_count"] == 0
    assert len([row for row in db.gib_credit_ledger.docs if row.get("type") == "dedupe_reversal"]) == 2
    assert db.gib_wallets.docs[0]["balance"] == 12


def test_dedupe_script_parser_defaults_to_dry_run():
    mod = _load_script()
    assert mod.apply_requested(mod.build_parser().parse_args([])) is False
    assert mod.apply_requested(mod.build_parser().parse_args(["--dry-run"])) is False
    assert mod.apply_requested(mod.build_parser().parse_args(["--apply"])) is True
    assert mod.apply_requested(mod.build_parser().parse_args(["--apply", "--dry-run"])) is False


class _FreshWallets:
    def __init__(self, doc=None):
        self.doc = dict(doc) if doc else None
        self.inserts = 0
        self.upserts = 0

    async def find_one(self, query=None):
        if not self.doc or (query or {}).get("_id") != self.doc.get("_id"):
            return None
        return dict(self.doc)

    async def insert_one(self, doc):
        self.inserts += 1
        raise AssertionError("cüzdan insert_one kullanılmamalı")

    async def update_one(self, query, update, upsert=False):
        self.upserts += 1
        wid = (query or {}).get("_id")
        if self.doc and self.doc.get("_id") == wid:
            inc = int(((update or {}).get("$inc") or {}).get("balance") or 0)
            self.doc["balance"] = int(self.doc.get("balance") or 0) + inc
            return
        if not upsert:
            return
        if self.doc:
            raise DuplicateKeyError("duplicate wallet")
        created = {"_id": wid}
        created.update((update or {}).get("$setOnInsert") or {})
        self.doc = created


class _RaceWallets(_FreshWallets):
    def __init__(self, doc):
        super().__init__(doc)
        self.reads = 0

    async def find_one(self, query=None):
        self.reads += 1
        if self.reads == 1:
            return None
        return await super().find_one(query)

    async def update_one(self, query, update, upsert=False):
        self.upserts += 1
        raise DuplicateKeyError("duplicate wallet")


def test_get_wallet_upserts_once_and_writes_one_welcome():
    wallets = _FreshWallets()
    ledger = _Ledger()
    gib_credits.init(_DB(wallets, ledger))

    async def go():
        with patch.object(saas, "license_id_of", new=AsyncMock(return_value=WALLET)):
            first = await gib_credits.get_wallet(COMP)
            second = await gib_credits.get_wallet(COMP)
            return first, second

    first, second = _run(go())
    assert wallets.inserts == 0
    assert wallets.upserts == 1
    assert first["balance"] == gib_credits.WELCOME_CREDITS
    assert second["balance"] == gib_credits.WELCOME_CREDITS
    welcomes = [row for row in ledger.docs if row.get("type") == "welcome"]
    assert len(welcomes) == 1
    assert welcomes[0]["wallet_id"] == WALLET
    assert welcomes[0]["credits"] == gib_credits.WELCOME_CREDITS
    assert ledger.index["name"] == "uniq_gib_welcome_wallet"
    assert ledger.index["partialFilterExpression"] == {"type": "welcome"}


def test_get_wallet_duplicate_key_does_not_add_second_welcome():
    wallets = _RaceWallets({"_id": WALLET, "balance": gib_credits.WELCOME_CREDITS})
    ledger = _Ledger([
        {"_id": f"welcome:{WALLET}", "wallet_id": WALLET, "company_id": COMP, "type": "welcome", "credits": 50},
    ])
    gib_credits.init(_DB(wallets, ledger))

    async def go():
        with patch.object(saas, "license_id_of", new=AsyncMock(return_value=WALLET)):
            return await gib_credits.get_wallet(COMP)

    found = _run(go())
    assert found["balance"] == gib_credits.WELCOME_CREDITS
    assert wallets.upserts == 1
    assert len([row for row in ledger.docs if row.get("type") == "welcome"]) == 1


def test_welcome_and_gift_partial_indexes_ignore_unrelated_rows():
    welcome_index = [(("wallet_id", "type"), True, dict(gib_credits.WELCOME_INDEX_FILTER))]
    gift_index = [(("company_id", "wallet_id", "request_id"), True, dict(gib_credits.GIFT_REQUEST_INDEX_FILTER))]
    welcome = {"_id": "w1", "wallet_id": WALLET, "type": "welcome", "company_id": COMP}
    with pytest.raises(DuplicateKeyError):
        unique_conflict(dict(welcome, _id="w2"), [welcome], welcome_index, "gib_credit_ledger")
    purchase = {"_id": "p1", "wallet_id": WALLET, "type": "purchase", "company_id": COMP}
    unique_conflict(dict(purchase, _id="p2"), [purchase], welcome_index, "gib_credit_ledger")
    gift = {"_id": "g1", "company_id": COMP, "wallet_id": WALLET, "type": "gift", "request_id": "key-1", "credits": 3}
    with pytest.raises(DuplicateKeyError):
        unique_conflict(dict(gift, _id="g2"), [gift], gift_index, "gib_credit_ledger")
    plain = {"_id": "g3", "company_id": COMP, "wallet_id": WALLET, "type": "gift", "credits": 3}
    unique_conflict(dict(plain, _id="g4"), [plain], gift_index, "gib_credit_ledger")


def test_gift_same_request_id_does_not_increase_balance_twice():
    db = _bind_wallet(gib_credits.WELCOME_CREDITS)

    async def go():
        with patch.object(saas, "license_id_of", new=AsyncMock(return_value=WALLET)):
            first = await gib_credits.gift(COMP, 10, "ilk", request_id="gift-key-3a32")
            db.gib_credit_ledger.blind_find = True
            second = await gib_credits.gift(COMP, 10, "ikinci", request_id="gift-key-3a32")
            db.gib_credit_ledger.blind_find = False
            other = await gib_credits.gift(COMP, 4, "baska", request_id="gift-other-3a32")
            plain_a = await gib_credits.gift(COMP, 1, "anahtarsiz")
            plain_b = await gib_credits.gift(COMP, 1, "anahtarsiz")
            return first, second, other, plain_a, plain_b

    first, second, other, plain_a, plain_b = _run(go())
    assert first == gib_credits.WELCOME_CREDITS + 10
    assert second == first
    assert other == first + 4
    assert plain_b == other + 2
    gifts = [row for row in db.gib_credit_ledger.docs if row.get("type") == "gift"]
    keyed = [row for row in gifts if row.get("request_id") == "gift-key-3a32"]
    assert len(keyed) == 1
    assert keyed[0]["credits"] == 10
    assert db.gib_wallets.doc["balance"] == plain_b
    assert ledger_index_ready(db)


def ledger_index_ready(db):
    spec = db.gib_credit_ledger.index
    return spec["name"] == "uniq_gib_gift_request" and spec["unique"] is True and spec["partialFilterExpression"]["request_id"] == {"$gt": ""}


def test_danger_gift_uses_idempotency_key_as_request_id():
    import platform_admin_v1_danger as danger

    db = _bind_wallet(gib_credits.WELCOME_CREDITS)
    request = type("Req", (), {"client": None, "headers": {"Idempotency-Key": "danger-gift-3a32"}})()

    async def go():
        with patch.object(saas, "license_id_of", new=AsyncMock(return_value=WALLET)):
            first = await danger._execute("gib.gift", COMP, {"credits": 25, "note": "tehlike"}, {}, request)
            second = await danger._execute("gib.gift", COMP, {"credits": 25, "note": "tehlike"}, {}, request)
            return first, second

    first, second = _run(go())
    assert first["balance"] == gib_credits.WELCOME_CREDITS + 25
    assert second["balance"] == first["balance"]
    gifts = [row for row in db.gib_credit_ledger.docs if row.get("type") == "gift"]
    assert len(gifts) == 1
    assert gifts[0]["request_id"] == "danger-gift-3a32"
