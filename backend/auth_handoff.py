"""One-time SSO handoff codes for cross-subdomain session transfer (60s TTL)."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

TABLE_SQL = """
CREATE TABLE IF NOT EXISTS auth_handoff_codes (
  code VARCHAR(64) NOT NULL,
  token MEDIUMTEXT NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  used_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_TTL_S = 60
_table_ready = False


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


async def create_handoff(db, token: str, *, purpose: str = "impersonate") -> str:
    await ensure_table(db)
    code = secrets.token_urlsafe(24)
    now = _utc_now()
    exp = now + timedelta(seconds=_TTL_S)
    async with db._pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO auth_handoff_codes (code, token, purpose, expires_at, used_at, created_at)
                VALUES (%s, %s, %s, %s, NULL, %s)
                """,
                (code, token, purpose, exp, now),
            )
    return code


async def _consume_locked(cur, code: str, now: datetime) -> str:
    """Mark the row used and return its token. Caller holds the row lock when the driver supports it."""
    await cur.execute(
        "SELECT token, expires_at, used_at FROM auth_handoff_codes WHERE code=%s FOR UPDATE",
        (code,),
    )
    row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Geçersiz veya kullanılmış kod")
    token, expires_at, used_at = row[0], row[1], row[2]
    if used_at is not None:
        raise HTTPException(status_code=401, detail="Kod zaten kullanılmış")
    if expires_at is not None and expires_at < now:
        raise HTTPException(status_code=401, detail="Kodun süresi dolmuş")
    await cur.execute(
        """
        UPDATE auth_handoff_codes
        SET used_at=%s
        WHERE code=%s AND used_at IS NULL AND (expires_at IS NULL OR expires_at >= %s)
        """,
        (now, code, now),
    )
    if getattr(cur, "rowcount", 0) != 1:
        raise HTTPException(status_code=401, detail="Kod zaten kullanılmış")
    return token


async def consume_handoff(db, code: str) -> str:
    """Return the handoff blob or raise 401. Exactly one caller wins.

    The UPDATE matches only an unused, unexpired row. A second exchange sees
    rowcount 0 (or used_at already set) and fails with 401. When the connection
    can begin a transaction, SELECT … FOR UPDATE keeps the check and the write
    on the same locked row.
    """
    await ensure_table(db)
    code = (code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Handoff kodu gerekli")
    now = _utc_now()
    async with db._pool.acquire() as conn:
        begin = getattr(conn, "begin", None)
        commit = getattr(conn, "commit", None)
        transactional = callable(begin) and callable(commit)
        if transactional:
            await begin()
        try:
            async with conn.cursor() as cur:
                token = await _consume_locked(cur, code, now)
            if transactional:
                await commit()
            return token
        except BaseException:
            if transactional:
                rollback = getattr(conn, "rollback", None)
                if callable(rollback):
                    try:
                        await rollback()
                    except Exception:
                        pass
            raise


def reset_table_ready_for_tests() -> None:
    global _table_ready
    _table_ready = False
