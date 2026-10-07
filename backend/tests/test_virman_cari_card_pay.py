"""Cari↔cari virman + müşteri kartı: ödeme satırları ve bakiye yönü."""
import asyncio
import os
import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock

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
    payments = ModuleType("emergentintegrations.payments")
    stripe_svc = ModuleType("emergentintegrations.payments.stripe")
    stripe_checkout = ModuleType("emergentintegrations.payments.stripe.checkout")

    class StripeCheckout:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionRequest:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionResponse:
        def __init__(self, *a, **k):
            pass

    stripe_checkout.StripeCheckout = StripeCheckout
    stripe_checkout.CheckoutSessionRequest = CheckoutSessionRequest
    stripe_checkout.CheckoutSessionResponse = CheckoutSessionResponse
    sys.modules["emergentintegrations"] = root
    sys.modules["emergentintegrations.llm"] = llm
    sys.modules["emergentintegrations.llm.chat"] = chat
    sys.modules["emergentintegrations.payments"] = payments
    sys.modules["emergentintegrations.payments.stripe"] = stripe_svc
    sys.modules["emergentintegrations.payments.stripe.checkout"] = stripe_checkout


_stub_emergent()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_insert_cari_virman_pair_types_and_sync_safe():
    import server
    from contact_balance import bank_tx_balance_delta

    inserted = []

    async def _insert_many(docs):
        inserted.extend(docs)

    pool = {"_id": "pool1", "account_name": "Müşteri Kredi Kartları", "currency": "TRY", "is_customer_card_pool": True}
    server.db = MagicMock()
    server.db.bank_transactions.insert_many = AsyncMock(side_effect=_insert_many)
    server.db.bank_accounts.update_one = AsyncMock()

    _run(server._insert_cari_virman_ledger_pair(
        company_id="c1",
        amount=100.0,
        desc="Hesaplar arası transfer (Virman)",
        today="2026-03-07",
        src_name="Tutku abi",
        tgt_name="MOLAŞ ENTEGRE",
        contact_id="cnt-src",
        contact_name="Tutku abi",
        target_contact_id="cnt-tgt",
        target_contact_name="MOLAŞ ENTEGRE",
        pool=pool,
    ))

    assert len(inserted) == 2
    src_tx, tgt_tx = inserted
    assert src_tx["type"] == "inflow"
    assert src_tx["contact_id"] == "cnt-src"
    assert src_tx["source"] == "virman"
    assert src_tx["via_customer_card"] is True
    assert src_tx["customer_card_pool_ledger"] is True
    assert "Müşteri kredi kartı ile" in src_tx["description"]
    assert bank_tx_balance_delta(src_tx) == -100.0

    assert tgt_tx["type"] == "outflow"
    assert tgt_tx["contact_id"] == "cnt-tgt"
    assert tgt_tx["source"] == "virman"
    assert bank_tx_balance_delta(tgt_tx) == 100.0
    assert src_tx["pair_tx_id"] == tgt_tx["_id"]
    assert tgt_tx["pair_tx_id"] == src_tx["_id"]


def test_insert_cari_virman_without_card_still_creates_payments():
    import server

    inserted = []
    server.db = MagicMock()
    server.db.bank_transactions.insert_many = AsyncMock(side_effect=lambda docs: inserted.extend(docs))

    _run(server._insert_cari_virman_ledger_pair(
        company_id="c1",
        amount=50.0,
        desc="cari virman",
        today="2026-03-07",
        src_name="A",
        tgt_name="B",
        contact_id="a",
        contact_name="A",
        target_contact_id="b",
        target_contact_name="B",
        pool=None,
    ))
    assert len(inserted) == 2
    assert inserted[0]["account_id"] is None
    assert inserted[0]["account_name"] == "Cari Virman"
    assert inserted[0]["source"] == "virman"
    assert not inserted[0].get("customer_card_pool_ledger")


def test_stamp_pool_ledger_only_when_on_pool_account():
    import server

    pool = {"_id": "pool1", "account_name": "Müşteri Kredi Kartları"}
    on_pool = {"account_id": "pool1", "description": "x"}
    on_bank = {"account_id": "bank1", "description": "y"}
    server._stamp_via_customer_card_pool(on_pool, pool, "d")
    server._stamp_via_customer_card_pool(on_bank, pool, "d")
    assert on_pool.get("customer_card_pool_ledger") is True
    assert on_bank.get("customer_card_pool_ledger") is None
    assert on_bank.get("via_customer_card") is True
