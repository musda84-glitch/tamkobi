"""One-time SSO handoff codes for cross-subdomain session transfer (60s TTL)."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

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


async def consume_handoff(db, code: str) -> str:
    """Return token JWT or raise 401. Single-use."""
    await ensure_table(db)
    code = (code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Handoff kodu gerekli")
    now = _utc_now()
    async with db._pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT token, expires_at, used_at FROM auth_handoff_codes WHERE code=%s",
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
                "UPDATE auth_handoff_codes SET used_at=%s WHERE code=%s AND used_at IS NULL",
                (now, code),
            )
            if cur.rowcount != 1:
                raise HTTPException(status_code=401, detail="Kod zaten kullanılmış")
    return token


def reset_table_ready_for_tests() -> None:
    global _table_ready
    _table_ready = False
