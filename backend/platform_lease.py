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
# run_exclusive görevleri. Kapanış bunları iptal eder; kira iş durunca bırakılır.
_runners: set = set()
_closing = False


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


def _reset_runtime_for_tests() -> None:
    """Test helper — do not use in production."""
    global _closing
    _closing = False
    _runners.clear()


def _clear_cancel() -> None:
    """İptal edilmiş görev finally içinde await edebilsin (3.11+)."""
    task = asyncio.current_task()
    if task is None or not hasattr(task, "uncancel"):
        return
    while task.uncancel():
        pass


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


async def _finish_hold(
    db,
    name: str,
    owner: str,
    stop: asyncio.Event,
    work: Optional[asyncio.Task],
    renew_task: Optional[asyncio.Task],
) -> None:
    """İşi durdur, sonra kirayı bırak. Bırakılan kira yeni sürecin işi başlatmasına izin verir."""
    stop.set()
    if work is not None and not work.done():
        work.cancel()
    if renew_task is not None and not renew_task.done():
        renew_task.cancel()
    for task in (work, renew_task):
        if task is None:
            continue
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    logger.info("lease bırakıldı %s owner=%s", name, owner)
    await release(db, name, owner)


async def run_exclusive(
    db,
    name: str,
    coro_factory: Callable[[], Awaitable[Any]],
    *,
    ttl_s: int = DEFAULT_TTL_S,
    wait_s: float = 5.0,
) -> None:
    """Run `coro_factory()` only while holding the named lease (one process wins)."""
    if _closing:
        logger.info("lease kapalı %s — iş başlatılmadı", name)
        return
    owner = new_owner()
    me = asyncio.current_task()
    if me is not None:
        _runners.add(me)
    try:
        while not _closing:
            try:
                got = await try_acquire(db, name, owner, ttl_s=ttl_s)
            except Exception as exc:
                logger.warning("lease acquire %s: %s", name, exc)
                got = False
            if not got:
                await asyncio.sleep(wait_s)
                continue
            logger.info("lease alındı %s owner=%s", name, owner)
            stop = asyncio.Event()
            renew_task = asyncio.create_task(
                renew_while(db, name, owner, ttl_s=ttl_s, stop=stop)
            )
            work: Optional[asyncio.Task] = None
            try:
                try:
                    work = asyncio.create_task(coro_factory())
                except Exception as exc:
                    logger.error("background %s başlamadı: %s", name, exc)
                    await asyncio.sleep(wait_s)
                    continue
                done, _pending = await asyncio.wait(
                    {work, renew_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if renew_task in done and not work.done():
                    logger.warning("lease düştü %s owner=%s", name, owner)
                elif work.done():
                    exc = work.exception() if not work.cancelled() else None
                    if exc:
                        logger.error("background %s crashed: %s", name, exc, exc_info=exc)
            finally:
                # İptal, ilk await'de temizliği atlar. Önce sayacı sıfırla.
                _clear_cancel()
                await _finish_hold(db, name, owner, stop, work, renew_task)
            if _closing:
                return
            await asyncio.sleep(wait_s)
    finally:
        if me is not None:
            _runners.discard(me)


async def shutdown() -> None:
    """Kapanış: çalışan arka plan işlerini durdur, sonra kirayı bırak."""
    global _closing
    _closing = True
    tasks = [
        task
        for task in list(_runners)
        if task is not asyncio.current_task() and not task.done()
    ]
    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
