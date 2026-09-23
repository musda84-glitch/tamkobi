import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from marketplace_settlement import (
    is_marketplace_settlement_tx,
    marketplace_contact_name,
    should_reverse_settlement_on_status,
)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_marketplace_contact_name():
    assert marketplace_contact_name("trendyol") == "Trendyol"
    assert marketplace_contact_name("TRENDYOL") == "Trendyol"
    assert marketplace_contact_name("hepsiburada") == "Hepsiburada"
    assert marketplace_contact_name("") == "Pazaryeri"
    assert marketplace_contact_name("ozelkanal") == "Ozelkanal"


def test_should_reverse_settlement_on_status():
    assert should_reverse_settlement_on_status("cancelled")
    assert should_reverse_settlement_on_status("Canceled")
    assert should_reverse_settlement_on_status("returned")
    assert should_reverse_settlement_on_status("partially_returned")
    assert not should_reverse_settlement_on_status("approved")
    assert not should_reverse_settlement_on_status("shipped")
    assert not should_reverse_settlement_on_status(None)


def test_is_marketplace_settlement_tx():
    assert is_marketplace_settlement_tx({"source": "marketplace_settlement", "category": "Pazaryeri Hakedişi"})
    assert is_marketplace_settlement_tx({"source": "ledger", "category": "Pazaryeri Kesintisi"})
    assert is_marketplace_settlement_tx({"source": "manual", "category": "Pazaryeri Hakedişi"})
    assert not is_marketplace_settlement_tx({"source": "expense", "category": "Masraf: Kira"})
    assert not is_marketplace_settlement_tx({"source": "ledger", "category": "Diğer"})
    assert not is_marketplace_settlement_tx(None)


def test_reverse_marketplace_settlement_reverses_balances_and_soft_deletes():
    import server

    order = {
        "_id": "ord_1",
        "company_id": "c1",
        "order_number": "11626987372",
        "settlement": {
            "account_id": "acc_ty",
            "net": 327.58,
            "tx_id": "tx_in",
            "expense_id": "exp_1",
            "marketplace_contact_id": "mp_ty",
        },
    }
    inflow = {
        "_id": "tx_in",
        "order_id": "ord_1",
        "account_id": "acc_ty",
        "account_name": "Trendyol",
        "type": "inflow",
        "category": "Pazaryeri Hakedişi",
        "amount": 327.58,
        "source": "marketplace_settlement",
        "description": "Trendyol 11626987372 hakediş",
        "date": "2026-09-21",
        "contact_id": None,
    }
    kesinti = {
        "_id": "tx_kes",
        "order_id": "ord_1",
        "account_id": None,
        "account_name": "Pazaryeri Kesintisi",
        "type": "outflow",
        "category": "Pazaryeri Kesintisi",
        "amount": 131.42,
        "source": "ledger",
        "description": "Trendyol 11626987372 kesinti",
        "date": "2026-09-21",
        "contact_id": "mp_ty",
    }
    expense = {
        "_id": "exp_1",
        "order_id": "ord_1",
        "expense_number": "MSR-2026-0001",
        "category": "Pazaryeri Komisyonu",
        "description": "komisyon",
        "total": 131.42,
        "netted_in_settlement": True,
        "payment_status": "paid",
    }

    mock_db = MagicMock()
    mock_db.bank_transactions.find = MagicMock(
        return_value=MagicMock(to_list=AsyncMock(return_value=[inflow, kesinti]))
    )
    mock_db.bank_transactions.find_one = AsyncMock(return_value=None)
    mock_db.expenses.find = MagicMock(
        return_value=MagicMock(to_list=AsyncMock(return_value=[expense]))
    )
    mock_db.expenses.find_one = AsyncMock(return_value=expense)
    mock_db.bank_accounts.update_one = AsyncMock()
    mock_db.contacts.update_one = AsyncMock()
    mock_db.orders.update_one = AsyncMock()

    soft = AsyncMock(return_value="trash_1")
    with patch.object(server, "db", mock_db), patch.object(server.trash, "soft_delete", soft):
        result = _run(server._reverse_marketplace_settlement(order))

    assert result is not None
    assert result["removed_txs"] == 2
    assert result["removed_expenses"] == 1
    assert abs(result["reversed_net"] - 327.58) < 0.01

    # Banka bakiyesi: inflow geri alındı (−327.58)
    bank_calls = mock_db.bank_accounts.update_one.await_args_list
    assert any(
        c.args[0] == {"_id": "acc_ty"} and c.args[1]["$inc"]["current_balance"] == pytest.approx(-327.58)
        for c in bank_calls
    )
    # Kesinti carisi: +131.42 geri → −131.42
    contact_calls = mock_db.contacts.update_one.await_args_list
    assert any(
        c.args[0] == {"_id": "mp_ty"} and c.args[1]["$inc"]["balance"] == pytest.approx(-131.42)
        for c in contact_calls
    )
    assert soft.await_count == 3  # 2 tx + 1 expense
    unset_call = mock_db.orders.update_one.await_args
    assert unset_call.args[0] == {"_id": "ord_1"}
    assert "settlement" in unset_call.args[1]["$unset"]
    assert "settlement_reversed_at" in unset_call.args[1]["$set"]


def test_reverse_marketplace_settlement_noop_without_data():
    import server

    mock_db = MagicMock()
    mock_db.bank_transactions.find = MagicMock(
        return_value=MagicMock(to_list=AsyncMock(return_value=[]))
    )
    mock_db.expenses.find = MagicMock(
        return_value=MagicMock(to_list=AsyncMock(return_value=[]))
    )
    with patch.object(server, "db", mock_db):
        assert _run(server._reverse_marketplace_settlement({"_id": "ord_x"})) is None


def test_update_order_status_cancelled_reverses_settlement():
    import server

    order = {"_id": "ord_c", "order_status": "approved", "settlement": {"net": 10}}
    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(side_effect=[order, order, order])
    mock_db.orders.update_one = AsyncMock()

    with patch.object(server, "db", mock_db), patch.object(
        server, "_reverse_marketplace_settlement", AsyncMock(return_value={"removed_txs": 1, "removed_expenses": 0, "reversed_net": 10})
    ) as rev, patch.object(server, "_push_order_to_shopphp", AsyncMock()):
        out = _run(server.update_order_status("ord_c", {"status": "cancelled"}))

    rev.assert_awaited_once()
    assert out["order_status"] == "cancelled"
    assert out["settlement_reversed"]["removed_txs"] == 1


def test_approve_claim_reverses_linked_order_settlement():
    import server

    claim = {
        "_id": "cl_1",
        "company_id": "c1",
        "channel": "trendyol",
        "order_number": "11626987372",
        "external_id": None,
        "items": [],
        "status": "Created",
    }
    order = {"_id": "ord_1", "order_number": "11626987372", "settlement": {"net": 100}}
    mock_db = MagicMock()
    mock_db.marketplace_claims.find_one = AsyncMock(side_effect=[claim, {**claim, "status": "Accepted"}])
    mock_db.marketplace_claims.update_one = AsyncMock()
    mock_db.integration_configs.find_one = AsyncMock(return_value=None)

    with patch.object(server, "db", mock_db), patch.object(
        server, "_order_for_marketplace_claim", AsyncMock(return_value=order)
    ), patch.object(
        server, "_reverse_marketplace_settlement", AsyncMock(return_value={"removed_txs": 2, "removed_expenses": 1, "reversed_net": 100})
    ) as rev:
        out = _run(server.approve_marketplace_claim("cl_1", {}))

    rev.assert_awaited_once_with(order)
    assert out["settlement_reversed"]["removed_txs"] == 2
