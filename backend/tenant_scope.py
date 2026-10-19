"""Kiracı kapsamı: istek boyunca company_id ve izinli şirketler.

Yetki kuralı burada yeniden yazılmaz. İstek kapsamını
tenant_access.resolve_company_id kurar; bu modül yalnızca bağlamı tutar.
check() ve TAMKOBI_TENANT_GUARD çalışma zamanı koruması PR1b'dedir.
"""
from __future__ import annotations

import os
import sys
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException

from applog import log_event
from schema_catalog import COLLECTIONS, SCOPE_PLATFORM, SCOPE_TENANT

# Katalog scope'u yalnız tenant | platform. Bu adlar company_id eşitliği ile
# süzülmez; gerekçe collection_kind içinde.
# users: üyelik company_ids[] üzerindedir.
# companies: kiracı belgenin kendisi _id'dir.
# token: sıfırlama ve push receipt belgelerinde şirket filtresi yoktur.
_KIND_OVERRIDE = {
    "users": "membership",
    "companies": "company",
    "password_resets": "token",
    "b2b_password_resets": "token",
    "push_receipts_pending": "token",
}

_SCOPE: ContextVar[Optional["TenantScope"]] = ContextVar("tamkobi_tenant_scope", default=None)
_KINDS = ("user", "b2b", "system", "platform")
_SKIP_CALLER = {"tenant_scope.py", "tenant_db.py"}


def collection_kind(name: str) -> str:
    """tenant | membership | company | platform | token | unknown.

    Kiracı kümesi schema_catalog.COLLECTIONS içindeki scope == tenant
    kayıtlarından gelir. Katalogda olmayan ad hata atmaz.
    """
    key = str(name or "")
    override = _KIND_OVERRIDE.get(key)
    if override:
        return override
    meta = COLLECTIONS.get(key)
    if not meta:
        return "unknown"
    scope = meta.get("scope")
    if scope == SCOPE_TENANT:
        return "tenant"
    if scope == SCOPE_PLATFORM:
        return "platform"
    return "unknown"


@dataclass(frozen=True)
class TenantScope:
    """Bir isteğin veya arka plan işinin şirket sınırı."""

    company_id: str
    allowed: frozenset
    kind: str
    actor_id: str
    reason: str
    contact_id: Optional[str] = None

    def __post_init__(self) -> None:
        cid = str(self.company_id or "").strip()
        if not cid:
            raise ValueError("company_id boş")
        kind = str(self.kind or "").strip()
        if kind not in _KINDS:
            raise ValueError("geçersiz kapsam türü")
        allowed = frozenset(
            str(item) for item in (self.allowed or ()) if item is not None and str(item).strip()
        )
        allowed = allowed | {cid}
        contact = str(self.contact_id).strip() if self.contact_id else ""
        object.__setattr__(self, "company_id", cid)
        object.__setattr__(self, "allowed", allowed)
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "actor_id", str(self.actor_id or ""))
        object.__setattr__(self, "reason", str(self.reason or ""))
        object.__setattr__(self, "contact_id", contact or None)


class TenantScopeViolation(HTTPException):
    """Başka kiracının kaydı. 404, kaydın varlığını ele vermez."""

    def __init__(self) -> None:
        super().__init__(status_code=404, detail="Kayıt bulunamadı.")


def bind(scope: TenantScope) -> Token:
    if not isinstance(scope, TenantScope):
        raise TypeError("scope TenantScope olmalı")
    return _SCOPE.set(scope)


def reset(token: Token) -> None:
    _SCOPE.reset(token)


def current() -> Optional[TenantScope]:
    return _SCOPE.get()


def _escape_caller() -> str:
    """tenant_scope / tenant_db dışındaki ilk çerçeve. En fazla 10 adım."""
    try:
        frame = sys._getframe()
    except ValueError:
        return "unknown"
    for _ in range(10):
        frame = frame.f_back
        if frame is None:
            return "unknown"
        base = os.path.basename(frame.f_code.co_filename or "")
        if not base or base in _SKIP_CALLER:
            continue
        return f"{base}:{frame.f_lineno}"
    return "unknown"


class _Unscoped:
    def __init__(self, reason: str):
        text = str(reason or "").strip()
        if not text:
            raise ValueError("reason boş")
        self.reason = text

    def __enter__(self):
        try:
            log_event(
                "tenant_guard.escape",
                reason=self.reason,
                caller=_escape_caller(),
                kind="unscoped",
            )
        except Exception:
            pass
        return None

    def __exit__(self, exc_type, exc, tb):
        return False


def unscoped(reason: str):
    """Bilerek kapsam dışı erişim. reason boşsa ValueError; çağrı yeri loglanır."""
    return _Unscoped(reason)
