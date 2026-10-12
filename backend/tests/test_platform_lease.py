"""platform_locks: two concurrent owners → only one holds the lease."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_lease_single_owner_across_two_coroutines():
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    try:
        from setup_state import apply_saved_secrets

        apply_saved_secrets()
    except Exception:
        pass

    from mysql_store import MySQLClient, mysql_settings_from_env
    import platform_lease as pl

    async def _run():
        client = MySQLClient()
        db = client[str(mysql_settings_from_env().get("db") or "tamkobi")]
        await db._ensure()
        await pl.ensure_table(db)

        name = f"test.lease.{os.getpid()}"
        async with db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM platform_locks WHERE name=%s", (name,))

        a = pl.new_owner()
        b = pl.new_owner()
        assert await pl.try_acquire(db, name, a, ttl_s=30) is True
        assert await pl.try_acquire(db, name, b, ttl_s=30) is False
        assert await pl.try_acquire(db, name, a, ttl_s=30) is True  # renew

        async with db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE platform_locks SET expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE name=%s",
                    (name,),
                )
        assert await pl.try_acquire(db, name, b, ttl_s=30) is True
        assert await pl.try_acquire(db, name, a, ttl_s=30) is False

        await pl.release(db, name, b)
        try:
            await client.close_async()
        except Exception:
            client.close()

    asyncio.run(_run())


def test_background_jobs_env_flag(monkeypatch):
    import platform_lease as pl

    monkeypatch.setenv("TAMKOBI_BACKGROUND_JOBS", "0")
    assert pl.background_jobs_enabled() is False
    monkeypatch.setenv("TAMKOBI_BACKGROUND_JOBS", "1")
    assert pl.background_jobs_enabled() is True
