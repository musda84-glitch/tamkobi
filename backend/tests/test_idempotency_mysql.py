"""Gerçek mysql_store üzerinde Idempotency-Key davranışı."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

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


async def _db():
    from mysql_store import MySQLClient, mysql_settings_from_env
    import idempotency

    cfg = dict(mysql_settings_from_env())
    cfg["db"] = TEST_DB
    client = MySQLClient(cfg)
    db = client[TEST_DB]
    await db._ensure()
    idempotency._reset_indexed_for_tests()
    return client, db


def test_idempotency_second_call_returns_cache():
    _env()
    import idempotency

    async def _run():
        client, db = await _db()
        cid = f"co_idemp_{uuid.uuid4().hex[:8]}"
        key = f"k-{uuid.uuid4().hex[:8]}"
        await db.idempotency_keys.delete_many({"company_id": cid})
        calls = {"n": 0}

        async def fn():
            calls["n"] += 1
            await asyncio.sleep(0.05)
            return {"ok": True, "n": calls["n"]}

        req = MagicMock()
        req.headers = {"Idempotency-Key": key}

        r1 = await idempotency.run(db, cid, req, "test/ep", fn)
        r2 = await idempotency.run(db, cid, req, "test/ep", fn)
        assert r1 == {"ok": True, "n": 1}
        assert r2 == {"ok": True, "n": 1}
        assert calls["n"] == 1

        await db.idempotency_keys.delete_many({"company_id": cid})
        await client.close_async()

    asyncio.run(_run())


def test_idempotency_concurrent_second_gets_409_not_500():
    _env()
    import idempotency

    async def _run():
        client, db = await _db()
        cid = f"co_race_{uuid.uuid4().hex[:8]}"
        key = f"race-{uuid.uuid4().hex[:8]}"
        await db.idempotency_keys.delete_many({"company_id": cid})
        gate = asyncio.Event()
        calls = {"n": 0}

        async def fn():
            calls["n"] += 1
            await gate.wait()
            return {"ok": True, "n": calls["n"]}

        req = MagicMock()
        req.headers = {"Idempotency-Key": key}

        async def _call():
            try:
                out = await idempotency.run(db, cid, req, "test/race", fn)
                return ("ok", out)
            except HTTPException as exc:
                return ("err", exc.status_code)
            except Exception as exc:  # noqa: BLE001 — 500 olmamalı
                return ("boom", type(exc).__name__, str(exc))

        t1 = asyncio.create_task(_call())
        await asyncio.sleep(0.05)  # ilk begin/insert tamamlansın
        t2 = asyncio.create_task(_call())
        await asyncio.sleep(0.05)
        gate.set()
        results = await asyncio.gather(t1, t2)

        oks = [r for r in results if r[0] == "ok"]
        conflicts = [r for r in results if r[0] == "err" and r[1] == 409]
        booms = [r for r in results if r[0] == "boom"]
        assert not booms, results
        # Biri tamamlanır (veya cache), diğeri in_progress → 409
        assert len(oks) + len(conflicts) == 2, results
        assert len(conflicts) >= 1 or len(oks) == 2  # cache hit mümkün değil ilk dalga
        # En az bir 409 bekliyoruz (ikinci in_progress)
        assert len(conflicts) == 1, results
        assert len(oks) == 1, results
        assert calls["n"] == 1

        await db.idempotency_keys.delete_many({"company_id": cid})
        await client.close_async()

    asyncio.run(_run())


def test_idempotency_ttl_expired_restarts():
    _env()
    import idempotency
    from datetime import datetime, timedelta, timezone

    async def _run():
        client, db = await _db()
        cid = f"co_ttl_{uuid.uuid4().hex[:8]}"
        key = "old-key"
        doc_id = f"{cid}:{key}"
        await db.idempotency_keys.delete_many({"company_id": cid})
        old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        await db.idempotency_keys.insert_one({
            "_id": doc_id,
            "company_id": cid,
            "key": key,
            "status": "completed",
            "response": {"stale": True},
            "created_at": old,
            "updated_at": old,
        })
        req = MagicMock()
        req.headers = {"Idempotency-Key": key}
        calls = {"n": 0}

        async def fn():
            calls["n"] += 1
            return {"fresh": True}

        out = await idempotency.run(db, cid, req, "test/ttl", fn)
        assert out == {"fresh": True}
        assert calls["n"] == 1

        await db.idempotency_keys.delete_many({"company_id": cid})
        await client.close_async()

    asyncio.run(_run())


def test_purge_expired_and_background_flag(monkeypatch):
    _env()
    import idempotency
    import platform_lease
    from datetime import datetime, timedelta, timezone

    monkeypatch.setenv("TAMKOBI_BACKGROUND_JOBS", "0")
    assert platform_lease.background_jobs_enabled() is False

    async def _run():
        client, db = await _db()
        cid = f"co_purge_{uuid.uuid4().hex[:8]}"
        await db.idempotency_keys.delete_many({"company_id": cid})
        old = (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()
        await db.idempotency_keys.insert_one({
            "_id": f"{cid}:gone",
            "company_id": cid,
            "key": "gone",
            "status": "completed",
            "response": {},
            "created_at": old,
        })
        n = await idempotency.purge_expired(db)
        assert n >= 1
        assert await db.idempotency_keys.find_one({"_id": f"{cid}:gone"}) is None
        await client.close_async()

    asyncio.run(_run())
