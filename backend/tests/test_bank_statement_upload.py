"""Vadesiz hesap AI hareket yükleme — parse, işaret, bakiye, tekrar yükleme."""
import asyncio
import io
import os
import sys
from types import ModuleType
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from openpyxl import Workbook

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _stub_emergent():
    if "emergentintegrations" in sys.modules:
        return
    root = ModuleType("emergentintegrations")
    llm = ModuleType("emergentintegrations.llm")
    chat = ModuleType("emergentintegrations.llm.chat")

    class LlmChat:
        def __init__(self, *a, **k):
            pass

        async def send_message(self, *a, **k):
            return ""

    class UserMessage:
        def __init__(self, *a, **k):
            pass

    chat.LlmChat = LlmChat
    chat.UserMessage = UserMessage
    sys.modules["emergentintegrations"] = root
    sys.modules["emergentintegrations.llm"] = llm
    sys.modules["emergentintegrations.llm.chat"] = chat


_stub_emergent()

import expenses  # noqa: E402
import finance  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows[:n])


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        for k, v in (q or {}).items():
            if isinstance(v, dict) and "$in" in v:
                if d.get(k) not in v["$in"]:
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, q, update):
        d = await self.find_one(q)
        if not d:
            return
        for k, v in (update.get("$inc") or {}).items():
            d[k] = float(d.get(k) or 0) + float(v)
        d.update(update.get("$set") or {})


class FakeDb:
    def __init__(self):
        self.bank_accounts = FakeCollection()
        self.bank_transactions = FakeCollection()
        self.contacts = FakeCollection()
        self.expenses = FakeCollection()


def test_bytes_to_statement_text_csv_and_xlsx():
    csv_text = finance._bytes_to_statement_text(
        "ekstre.csv",
        "text/csv",
        "Tarih;Açıklama;Tutar\n2026-10-01;EFT Gelen;1.250,00\n2026-10-02;Fatura Ödeme;-250,00\n".encode(),
    )
    assert "EFT Gelen" in csv_text
    assert "Fatura Ödeme" in csv_text

    wb = Workbook()
    ws = wb.active
    ws.append(["Tarih", "Açıklama", "Tutar"])
    ws.append(["2026-10-03", "Maaş", -15000])
    buf = io.BytesIO()
    wb.save(buf)
    xlsx = finance._bytes_to_statement_text("hareket.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf.getvalue())
    assert "Maaş" in xlsx

    txt = finance._bytes_to_statement_text("not.txt", "text/plain", "Hareket listesi örnek metin içeriği".encode())
    assert "Hareket listesi" in txt


def test_bytes_to_statement_text_rejects_bad_types():
    with pytest.raises(HTTPException) as png:
        finance._bytes_to_statement_text("x.png", "image/png", b"\x89PNG\r\n")
    assert png.value.status_code == 400
    with pytest.raises(HTTPException) as xls:
        finance._bytes_to_statement_text("eski.xls", "application/vnd.ms-excel", b"fake")
    assert "xlsx" in (xls.value.detail or "").lower()
    with pytest.raises(HTTPException):
        finance._bytes_to_statement_text("bos.csv", "text/csv", b"a,b\n")


def test_kind_outflow_and_category():
    assert finance._is_card({"type": "credit_card"}) is True
    assert finance._is_card({"type": "bank"}) is False
    assert finance._line_outflow(-25, is_card=False) is True
    assert finance._line_outflow(100, is_card=False) is False
    assert finance._line_outflow(80, is_card=True) is True
    assert finance._line_outflow(-50, is_card=True) is False
    assert finance._kind_for_line(-25, None, is_card=False) == "islem"
    assert finance._kind_for_line(-25, {"_id": "c1"}, is_card=False) == "cari_odeme"
    assert finance._kind_for_line(80, None, is_card=True) == "masraf"
    assert finance._kind_for_line(-50, None, is_card=True) == "islem"
    assert finance._line_category("Diğer", outflow=True, is_card=False) == "Hesaptan Çıkış"
    assert finance._line_category("Diğer", outflow=False, is_card=False) == "Hesaba Giriş"
    assert finance._line_category("Yakıt", outflow=True, is_card=False) == "Yakıt"
    assert finance._tx_key({"date": "2026-10-01", "description": "EFT", "amount": -25}) == (
        "2026-10-01",
        "EFT",
        25.0,
    )
    assert finance._tx_key({"date": "2026-10-01", "description": "EFT", "amount": 25}) == finance._tx_key(
        {"date": "2026-10-01", "description": "EFT", "amount": -25}
    )


def test_apply_statement_does_not_overwrite_bank_balance():
    db = FakeDb()
    acc = {"_id": "acc1", "type": "bank", "current_balance": -25}
    db.bank_accounts.docs.append(dict(acc))
    finance._db = db

    async def run():
        await finance._apply_statement_account(
            "acc1",
            {"closing_balance": 999, "total_debt": 10, "bank": "Kuveyt Türk"},
            acc,
            apply_card_balance=False,
        )

    asyncio.run(run())
    stored = db.bank_accounts.docs[0]
    assert stored["current_balance"] == -25
    assert stored["last_statement"]["closing_balance"] == 999
    assert "card_limit" not in stored or stored.get("card_limit") is None


def test_insert_bank_lines_adjust_balance_and_skip_manual_dupes():
    db = FakeDb()
    acc = {
        "_id": "acc-kt",
        "company_id": "comp1",
        "type": "bank",
        "account_name": "Vadesiz TL Hesabı",
        "currency": "TRY",
        "current_balance": -25,
    }
    db.bank_accounts.docs.append(dict(acc))
    db.bank_transactions.docs.append({
        "_id": "manual-1",
        "account_id": "acc-kt",
        "date": "2026-10-01",
        "description": "EFT GELEN MUSTAFA",
        "amount": 1000,
        "source": "manual",
    })
    finance._db = db

    async def run():
        existing = await finance._existing_statement_keys("acc-kt", all_sources=True)
        assert finance._tx_key({"date": "2026-10-01", "description": "EFT GELEN MUSTAFA", "amount": 1000}) in existing
        card_only = await finance._existing_statement_keys("acc-kt", all_sources=False)
        assert not card_only

        created_in = await finance._insert_statement_line(acc, {
            "date": "2026-10-02",
            "description": "Müşteri tahsilat",
            "amount": 500,
            "category": "Havale / EFT",
            "kind": "islem",
        })
        created_out = await finance._insert_statement_line(acc, {
            "date": "2026-10-03",
            "description": "Fatura ödemesi",
            "amount": -75,
            "category": "Diğer",
            "kind": "islem",
        })
        return created_in, created_out

    asyncio.run(run())
    stored = db.bank_accounts.docs[0]
    assert stored["current_balance"] == pytest.approx(-25 + 500 - 75)
    ins = [t for t in db.bank_transactions.docs if t.get("source") == "bank_statement"]
    assert len(ins) == 2
    by_desc = {t["description"]: t for t in ins}
    assert by_desc["Müşteri tahsilat"]["type"] == "inflow"
    assert by_desc["Fatura ödemesi"]["type"] == "outflow"
    assert by_desc["Müşteri tahsilat"]["amount"] == 500
    assert by_desc["Fatura ödemesi"]["amount"] == 75


def test_insert_bank_masraf_uses_bank_statement_source():
    db = FakeDb()
    acc = {
        "_id": "acc2",
        "company_id": "comp1",
        "type": "bank",
        "account_name": "Vadesiz",
        "currency": "TRY",
        "current_balance": 0,
    }
    db.bank_accounts.docs.append(dict(acc))
    finance._db = db

    async def run():
        with patch.object(finance.expenses_mod, "record_card_spend", new_callable=AsyncMock) as rec:
            rec.return_value = {"id": "exp-1"}
            created = await finance._insert_statement_line(acc, {
                "date": "2026-10-04",
                "description": "SHELL YAKIT",
                "amount": -250,
                "category": "Yakıt",
                "kind": "masraf",
            })
            rec.assert_awaited()
            kwargs = rec.await_args.kwargs
            assert kwargs["source"] == "bank_statement"
            assert kwargs["amount"] == 250
            return created

    created = asyncio.run(run())
    assert created["expense_id"] == "exp-1"
    assert db.bank_transactions.docs[0]["source"] == "bank_statement"
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(-250)


def test_expense_from_statement_helper():
    assert expenses._from_statement({"source": "bank_statement"}) is True
    assert expenses._from_statement({"source": "card_statement"}) is True
    assert expenses._from_statement({"source": "manual"}) is False
    assert expenses._from_statement({}) is False
