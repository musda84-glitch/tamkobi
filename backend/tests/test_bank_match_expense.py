"""Banka eşleştirme: Masraf modu — ödeme hareketinden masraf kaydı."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _run(coro):
    return asyncio.run(coro)


def test_from_statement_includes_bank_match():
    import expenses

    assert expenses._from_statement({"source": "bank_match"}) is True
    assert expenses._from_statement({"source": "bank_statement"}) is True
    assert expenses._from_statement({"source": "manual"}) is False


def test_apply_match_as_expense_creates_paid_expense():
    import server

    tx = {
        "_id": "tx_out",
        "company_id": "c1",
        "account_id": "acc1",
        "account_name": "Vadesiz",
        "type": "outflow",
        "amount": 250.0,
        "description": "SHELL YAKIT",
        "date": "2026-10-09",
        "currency": "TRY",
        "match_status": "unmatched",
        "source": "bank_sync",
    }
    mock_db = MagicMock()
    mock_db.contacts.find_one = AsyncMock(return_value=None)
    mock_db.contacts.update_one = AsyncMock()
    mock_db.bank_transactions.update_one = AsyncMock()
    mock_db.bank_transactions.find_one = AsyncMock(
        return_value={**tx, "match_status": "matched", "expense_id": "exp1", "category": "Masraf: Yakıt"}
    )
    mock_db.expenses.insert_one = AsyncMock()
    mock_db.expense_categories.find_one = AsyncMock(return_value={"name": "Yakıt"})

    with patch.object(server, "db", mock_db), patch.object(
        server.expenses, "record_card_spend", AsyncMock(return_value={"id": "exp1", "category": "Yakıt"})
    ) as rec, patch.object(server, "_learn_rule", AsyncMock()):
        out = _run(server._apply_match(tx, None, None, "Yakıt", learn=False, as_expense=True))

    rec.assert_awaited_once()
    kwargs = rec.await_args.kwargs
    assert kwargs["source"] == "bank_match"
    assert kwargs["amount"] == 250.0
    assert kwargs["category"] == "Yakıt"
    assert kwargs["bank_tx_id"] == "tx_out"
    set_arg = mock_db.bank_transactions.update_one.await_args.args[1]["$set"]
    assert set_arg["expense_id"] == "exp1"
    assert set_arg["category"] == "Masraf: Yakıt"
    assert set_arg["match_status"] == "matched"
    assert out["expense_id"] == "exp1"


def test_apply_match_as_expense_rejects_inflow():
    import server
    from fastapi import HTTPException

    tx = {
        "_id": "tx_in",
        "company_id": "c1",
        "type": "inflow",
        "amount": 100.0,
        "description": "Gelir",
        "date": "2026-10-09",
    }
    with pytest.raises(HTTPException) as ei:
        _run(server._apply_match(tx, None, None, "Yakıt", learn=False, as_expense=True))
    assert ei.value.status_code == 400
    assert "çıkış" in ei.value.detail.lower() or "Masraf" in ei.value.detail


def test_unmatch_deletes_bank_match_expense():
    import server

    tx = {
        "_id": "tx_out",
        "company_id": "c1",
        "type": "outflow",
        "amount": 80.0,
        "expense_id": "exp_m",
        "match_status": "matched",
        "source": "bank_sync",
        "contact_id": None,
    }
    exp = {"_id": "exp_m", "source": "bank_match", "bank_transaction_id": "tx_out"}
    mock_db = MagicMock()
    mock_db.expenses.find_one = AsyncMock(return_value=exp)
    mock_db.expenses.delete_one = AsyncMock()
    mock_db.bank_transactions.update_one = AsyncMock()
    mock_db.bank_transactions.find_one = AsyncMock(
        return_value={**tx, "match_status": "unmatched", "expense_id": None}
    )

    with patch.object(server, "db", mock_db):
        _run(server._unmatch(tx))

    mock_db.expenses.delete_one.assert_awaited_once_with({"_id": "exp_m"})
    unset = mock_db.bank_transactions.update_one.await_args.args[1]["$unset"]
    assert "expense_id" in unset
