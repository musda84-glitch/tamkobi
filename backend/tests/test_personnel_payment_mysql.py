"""Gerçek MariaDB (tamkobi_test): aynı Idempotency-Key ile eşzamanlı personel ödemesi → tek hareket."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

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
    import idempotency

    cfg = dict(mysql_settings_from_env())
    cfg["db"] = TEST_DB
    client = MySQLClient(cfg)
    db = client[TEST_DB]
    await db._ensure()
    idempotency._reset_indexed_for_tests()
    return client, db


def test_personnel_payment_concurrent_same_key_one_movement():
    _env()
    import personnel_payments

    async def _run():
        client, db = await _test_client()
        cid = f"co_ppay_{uuid.uuid4().hex[:8]}"
        eid = f"emp_{uuid.uuid4().hex[:8]}"
        aid = f"acc_{uuid.uuid4().hex[:8]}"
        prefix = {"company_id": cid}
        key = f"pay-{uuid.uuid4().hex}"

        await db.bank_accounts.delete_many(prefix)
        await db.bank_transactions.delete_many(prefix)
        await db.payrolls.delete_many(prefix)
        await db.personnel_movements.delete_many(prefix)
        await db.personnel_receipts.delete_many(prefix)
        await db.bonus_payments.delete_many(prefix)
        await db.employees.delete_many(prefix)
        await db.idempotency_keys.delete_many({"company_id": cid})

        await db.employees.insert_one({
            "_id": eid, "company_id": cid, "full_name": "Ali Test",
            "salary": 1000, "pay_type": "monthly", "pay_start_date": "2026-01-01",
            "pay_recurring": True, "status": "active",
        })
        await db.bank_accounts.insert_one({
            "_id": aid, "company_id": cid, "account_name": "Kasa Test",
            "type": "bank", "current_balance": 5000.0, "currency": "TRY",
        })

        emp = await db.employees.find_one({"_id": eid})
        lines = [{"kind": "salary", "amount": 1000, "account_id": aid}]
        payload = {"lines": lines, "idempotency_key": key}
        balance = {"remaining": 1000, "unpaid_payroll": 1000, "meal_due": 0, "transport_due": 0}
        req = MagicMock()
        req.headers = {"Idempotency-Key": key}

        async def _one():
            try:
                out = await personnel_payments.apply_payment_lines(
                    db, emp, {}, payload, balance=balance, pay_date="2026-10-13", period="2026-10",
                    request=req,
                )
                return ("ok", out)
            except HTTPException as exc:
                return ("err", exc.status_code, str(exc.detail))

        results = await asyncio.gather(_one(), _one())
        oks = [r for r in results if r[0] == "ok"]
        conflicts = [r for r in results if r[0] == "err" and r[1] == 409]
        assert len(oks) + len(conflicts) == 2, results
        assert len(oks) >= 1, results

        moves = await db.personnel_movements.find({"company_id": cid}).to_list(20)
        txs = await db.bank_transactions.find({"company_id": cid}).to_list(20)
        assert len(moves) == 1, moves
        assert len(txs) == 1, txs
        acc = await db.bank_accounts.find_one({"_id": aid})
        assert float(acc.get("current_balance") or 0) == 4000.0

        await db.bank_accounts.delete_many(prefix)
        await db.bank_transactions.delete_many(prefix)
        await db.payrolls.delete_many(prefix)
        await db.personnel_movements.delete_many(prefix)
        await db.personnel_receipts.delete_many(prefix)
        await db.bonus_payments.delete_many(prefix)
        await db.employees.delete_many(prefix)
        await db.idempotency_keys.delete_many({"company_id": cid})
        await client.close_async()

    asyncio.run(_run())
