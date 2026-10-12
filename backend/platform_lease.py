"""DB-backed exclusive leases for background jobs (blue/green safe).

mysql_store update_one is load→save (not atomic). Leases use raw SQL on a
dedicated `platform_locks` table with conditional INSERT … ON DUPLICATE KEY UPDATE.
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger("tamkobi.lease")

DEFAULT_TTL_S = 60
TABLE_SQL = """
CREATE TABLE IF NOT EXISTS platform_locks (
  name VARCHAR(64) NOT NULL,
  owner VARCHAR(191) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# ensure_table runs at most once per process
_table_ready = False


def background_jobs_enabled() -> bool:
    raw = (os.environ.get("TAMKOBI_BACKGROUND_JOBS") or "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def new_owner() -> str:
    host = socket.gethostname() or "host"
    return f"{host}:{os.getpid()}:{uuid.uuid4().hex[:10]}"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def ensure_table(db) -> None:
    global _table_ready
    if _table_ready:
        return
    await db._ensure()
    async with db._pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(TABLE_SQL)
    _table_ready = True


def _reset_table_ready_for_tests() -> None:
    """Test helper — do not use in production."""
    global _table_ready
    _table_ready = False


async def try_acquire(db, name: str, owner: str, ttl_s: int = DEFAULT_TTL_S) -> bool:
    """Acquire or renew `name` for `owner` if free/expired/already ours."""
    await ensure_table(db)
    now = _utc_now()
    exp = now + timedelta(seconds=max(5, int(ttl_s)))
    async with db._pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO platform_locks (name, owner, expires_at, updated_at)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  owner = IF(expires_at < %s OR owner = VALUES(owner), VALUES(owner), owner),
                  expires_at = IF(expires_at < %s OR owner = VALUES(owner), VALUES(expires_at), expires_at),
                  updated_at = IF(expires_at < %s OR owner = VALUES(owner), VALUES(updated_at), updated_at)
                """,
                (name, owner, exp, now, now, now, now),
            )
            await cur.execute(
                "SELECT owner FROM platform_locks WHERE name=%s",
                (name,),
            )
            row = await cur.fetchone()
    return bool(row and row[0] == owner)


async def release(db, name: str, owner: str) -> None:
    try:
        await db._ensure()
        async with db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM platform_locks WHERE name=%s AND owner=%s",
                    (name, owner),
                )
    except Exception as exc:
        logger.warning("lease release %s failed: %s", name, exc)


async def renew_while(
    db,
    name: str,
    owner: str,
    *,
    ttl_s: int = DEFAULT_TTL_S,
    every_s: float = 20.0,
    stop: asyncio.Event,
) -> None:
    while not stop.is_set():
        try:
            ok = await try_acquire(db, name, owner, ttl_s=ttl_s)
            if not ok:
                logger.warning("lost lease %s (owner=%s)", name, owner)
                stop.set()
                return
        except Exception as exc:
            logger.warning("lease renew %s: %s", name, exc)
        try:
            await asyncio.wait_for(stop.wait(), timeout=every_s)
        except asyncio.TimeoutError:
            pass


async def run_exclusive(
    db,
    name: str,
    coro_factory: Callable[[], Awaitable[Any]],
    *,
    ttl_s: int = DEFAULT_TTL_S,
    wait_s: float = 5.0,
) -> None:
    """Run `coro_factory()` only while holding the named lease (one process wins)."""
    owner = new_owner()
    while True:
        try:
            got = await try_acquire(db, name, owner, ttl_s=ttl_s)
        except Exception as exc:
            logger.warning("lease acquire %s: %s", name, exc)
            got = False
        if not got:
            await asyncio.sleep(wait_s)
            continue
        stop = asyncio.Event()
        renew_task = asyncio.create_task(
            renew_while(db, name, owner, ttl_s=ttl_s, stop=stop)
        )
        work: Optional[asyncio.Task] = None
        try:
            work = asyncio.create_task(coro_factory())
            done, _pending = await asyncio.wait(
                {work, renew_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if renew_task in done and not work.done():
                work.cancel()
                try:
                    await work
                except (asyncio.CancelledError, Exception):
                    pass
                await asyncio.sleep(wait_s)
                continue
            if work in done:
                # Unexpected exit of a forever-loop — restart after short pause
                exc = work.exception() if not work.cancelled() else None
                if exc:
                    logger.error("background %s crashed: %s", name, exc, exc_info=exc)
                await asyncio.sleep(wait_s)
        finally:
            stop.set()
            renew_task.cancel()
            try:
                await renew_task
            except (asyncio.CancelledError, Exception):
                pass
            await release(db, name, owner)
