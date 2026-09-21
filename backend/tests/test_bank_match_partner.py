"""Banka eşleşmesi: Para nereden geldi / nereye gitti → Ortaklar Hesabı."""
import asyncio
from unittest.mock import AsyncMock, patch

from bank_match_target import (
    apply_partner_match,
    parse_match_target,
    partner_tx_type_for_bank_match,
    reverse_partner_match,
    stored_match_target,
)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_parse_and_store_partner_target():
    assert parse_match_target("partner:p1") == ("partner", "p1")
    assert parse_match_target("acc-9") == ("account", "acc-9")
    assert stored_match_target("partner", "p1") == "partner:p1"
    assert partner_tx_type_for_bank_match(True) == "capital_in"
    assert partner_tx_type_for_bank_match(False) == "withdrawal"


def test_apply_partner_match_inflow_is_capital_in():
    tx = {
        "_id": "tx1",
        "company_id": "comp",
        "account_name": "Vakıf Bank",
        "description": "ortak sermaye",
        "date": "2026-09-21",
    }
    with patch("bank_match_target.partner_pay.move", AsyncMock(return_value="Mustafa")) as move:
        name = _run(apply_partner_match(object(), tx, "p1", 250, True))
    assert name == "Mustafa"
    args, kwargs = move.await_args
    assert args[2] == "p1"
    assert args[3] == 250.0
    assert args[4] == "capital_in"
    assert kwargs["extra"]["related_bank_tx_id"] == "tx1"
    assert kwargs["extra"]["source"] == "bank_match"


def test_apply_partner_match_outflow_is_withdrawal():
    tx = {"_id": "tx2", "company_id": "comp", "account_name": "Kasa", "description": "çekiş"}
    with patch("bank_match_target.partner_pay.move", AsyncMock(return_value="Ali")) as move:
        _run(apply_partner_match(object(), tx, "p9", 80, False))
    assert move.await_args.args[4] == "withdrawal"


def test_reverse_partner_match_looks_up_bank_tx():
    with patch("bank_match_target.partner_pay.reverse_one", AsyncMock(side_effect=[False, True])) as rev:
        ok = _run(reverse_partner_match(object(), {"_id": "tx3"}))
    assert ok is True
    assert rev.await_args_list[0].args[1] == {"related_bank_tx_id": "tx3", "source": "bank_match"}
    assert rev.await_args_list[1].args[1] == {"related_bank_tx_id": "tx3"}
