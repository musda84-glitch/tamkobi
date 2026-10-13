"""Gerçek MariaDB (tamkobi_test): update_one_atomic eşzamanlılık + taksit/POS claim."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TEST_DB = "tamkobi_test"


def _env():
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    try:
        from setup_state import apply_saved_secrets

        apply_saved_secrets()
    except Exception:
        pass


async def _test_client():
    from mysql_store import MySQLClient, mysql_settings_from_env

    cfg = dict(mysql_settings_from_env())
    cfg["db"] = TEST_DB
    client = MySQLClient(cfg)
    db = client[TEST_DB]
    await db._ensure()
    return client, db


def test_update_one_atomic_only_one_winner():
    _env()

    async def _run():
        client, db = await _test_client()
        coll = db.atomic_claim_demo
        doc_id = f"claim_{uuid.uuid4().hex[:12]}"
        await coll.delete_many({"_id": doc_id})
        await coll.insert_one({"_id": doc_id, "status": "pending", "n": 0})

        async def claim():
            return await coll.update_one_atomic(
                {
                    "_id": doc_id,
                    "status": {"$ne": "paid"},
                    "_pay_claimed_at": {"$exists": False},
                },
                {"$set": {"_pay_claimed_at": "now", "status": "paid", "n": 1}},
            )

        results = await asyncio.gather(*[claim() for _ in range(10)])
        wins = sum(1 for r in results if r.matched_count == 1)
        losses = sum(1 for r in results if r.matched_count == 0)
        assert wins == 1
        assert losses == 9
        final = await coll.find_one({"_id": doc_id})
        assert final["status"] == "paid"
        assert final["n"] == 1
        await coll.delete_many({"_id": doc_id})
        await client.close_async()

    asyncio.run(_run())


def test_installment_pay_concurrent_one_bank_tx():
    """Aynı taksiti 10 kez paralel öde → 1 OK, 9×409, tek kasa hareketi."""
    _env()
    import server
    import tenant_access

    async def _run():
        client, tdb = await _test_client()
        cid = f"co_atom_{uuid.uuid4().hex[:8]}"
        inst_id = f"inst_{uuid.uuid4().hex[:10]}"
        acc_id = f"acc_{uuid.uuid4().hex[:10]}"
        contact_id = f"ct_{uuid.uuid4().hex[:10]}"
        prefix = {"company_id": cid}

        await tdb.installments.delete_many(prefix)
        await tdb.bank_accounts.delete_many(prefix)
        await tdb.bank_transactions.delete_many(prefix)
        await tdb.contacts.delete_many(prefix)
        await tdb.idempotency_keys.delete_many({"company_id": cid})

        await tdb.contacts.insert_one({
            "_id": contact_id, "company_id": cid, "name": "Cari Atom", "balance": 100.0,
        })
        await tdb.bank_accounts.insert_one({
            "_id": acc_id, "company_id": cid, "account_name": "Kasa Test",
            "type": "cash_box", "current_balance": 500.0, "currency": "TRY",
        })
        await tdb.installments.insert_one({
            "_id": inst_id, "company_id": cid, "contact_id": contact_id,
            "contact_name": "Cari Atom", "label": "1. Taksit",
            "amount": 50.0, "paid_amount": 0, "status": "pending",
            "direction": "receivable", "due_date": "2026-10-13",
        })

        user = {"_id": "u1", "company_id": cid, "is_super_admin": True}
        req = {"amount": 50, "account_id": acc_id}
        request = MagicMock()
        request.headers = {}

        async def _one(i):
            r = MagicMock()
            r.headers = {}  # no idempotency — gerçek yarış
            try:
                out = await server.pay_installment(inst_id, req, r, user=user)
                return ("ok", out)
            except HTTPException as exc:
                return ("err", exc.status_code, str(exc.detail))

        async def _get_doc(dbx, coll, doc_id, user, not_found=""):
            d = await getattr(tdb, coll).find_one({"_id": doc_id})
            if not d:
                raise HTTPException(status_code=404, detail=not_found or "Yok")
            return d

        with patch.object(server, "db", tdb), \
             patch("tenant_access.get_tenant_doc", side_effect=_get_doc):
            results = await asyncio.gather(*[_one(i) for i in range(10)])

        oks = [r for r in results if r[0] == "ok"]
        conflicts = [r for r in results if r[0] == "err" and r[1] == 409]
        assert len(oks) == 1, results
        assert len(conflicts) == 9, results

        txs = await tdb.bank_transactions.find({"company_id": cid, "installment_id": inst_id}).to_list(20)
        assert len(txs) == 1
        assert float(txs[0].get("amount") or 0) == pytest.approx(50.0)
        inst = await tdb.installments.find_one({"_id": inst_id})
        assert inst["status"] == "paid"
        assert float(inst.get("paid_amount") or 0) == 50.0

        # recalc hareket toplamına kilitler (açılış TX yoksa bakiye = tahsilat)
        acc = await tdb.bank_accounts.find_one({"_id": acc_id})
        assert float(acc.get("current_balance") or 0) == pytest.approx(50.0)

        await tdb.installments.delete_many(prefix)
        await tdb.bank_accounts.delete_many(prefix)
        await tdb.bank_transactions.delete_many(prefix)
        await tdb.contacts.delete_many(prefix)
        await client.close_async()

    asyncio.run(_run())


def test_pos_return_concurrent_one_winner():
    """Aynı fişi 10 kez iade et → 1 OK, 9×409."""
    _env()
    import server

    async def _run():
        client, tdb = await _test_client()
        cid = f"co_pos_{uuid.uuid4().hex[:8]}"
        inv_id = f"inv_{uuid.uuid4().hex[:10]}"
        pid = f"p_{uuid.uuid4().hex[:8]}"
        prefix = {"company_id": cid}

        await tdb.invoices.delete_many(prefix)
        await tdb.products.delete_many(prefix)
        await tdb.bank_accounts.delete_many(prefix)
        await tdb.bank_transactions.delete_many(prefix)
        await tdb.contacts.delete_many(prefix)
        await tdb.idempotency_keys.delete_many({"company_id": cid})

        await tdb.products.insert_one({
            "_id": pid, "company_id": cid, "name": "Ürün", "stock_quantity": 0.0,
        })
        await tdb.contacts.insert_one({
            "_id": "ct1", "company_id": cid, "name": "Perakende", "balance": 100.0,
        })
        await tdb.bank_accounts.insert_one({
            "_id": f"cash_{cid}", "company_id": cid, "account_name": "Kasa",
            "type": "cash_box", "current_balance": 200.0,
        })
        await tdb.invoices.insert_one({
            "_id": inv_id, "company_id": cid, "invoice_type": "sales",
            "invoice_number": f"POS{uuid.uuid4().hex[:6].upper()}",
            "status": "approved", "grand_total": 100.0, "subtotal": 100.0,
            "vat_total": 0, "contact_id": "ct1", "contact_name": "Perakende",
            "payment_method": "cash", "items": [
                {"product_id": pid, "name": "Ürün", "quantity": 1, "unit_price": 100,
                 "total": 100, "total_incl": 100, "vat_rate": 0},
            ],
            "effects_applied": True,
        })

        req = {"company_id": cid, "invoice_id": inv_id}
        request = MagicMock()
        request.headers = {}

        async def _one():
            r = MagicMock()
            r.headers = {}
            try:
                out = await server.pos_return(req, r)
                return ("ok", out)
            except HTTPException as exc:
                return ("err", exc.status_code)

        with patch.object(server, "db", tdb):
            results = await asyncio.gather(*[_one() for _ in range(10)])

        oks = [r for r in results if r[0] == "ok"]
        conflicts = [r for r in results if r[0] == "err" and r[1] == 409]
        assert len(oks) == 1, results
        assert len(conflicts) == 9, results

        inv = await tdb.invoices.find_one({"_id": inv_id})
        assert inv.get("returned") is True
        assert float(inv.get("returned_amount") or 0) == 100.0
        returns = await tdb.invoices.find({"company_id": cid, "invoice_type": "sales_return"}).to_list(20)
        assert len(returns) == 1

        await tdb.invoices.delete_many(prefix)
        await tdb.products.delete_many(prefix)
        await tdb.bank_accounts.delete_many(prefix)
        await tdb.bank_transactions.delete_many(prefix)
        await tdb.contacts.delete_many(prefix)
        await client.close_async()

    asyncio.run(_run())
