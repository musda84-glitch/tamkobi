"""Kiracı kapsamı: istek boyunca company_id ve izinli şirketler.

Yetki kuralı burada yeniden yazılmaz. İstek kapsamını
tenant_access.resolve_company_id kurar; bu modül bağlamı tutar ve
check() ile korur. TAMKOBI_TENANT_GUARD: off (varsayılan), log veya raise.
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
_UNSCOPED: ContextVar[bool] = ContextVar("tamkobi_tenant_unscoped", default=False)
_KINDS = ("user", "b2b", "system", "platform")
_SKIP_CALLER = {"tenant_scope.py", "tenant_db.py"}
_GUARD_SKIP = _SKIP_CALLER | {"mysql_store.py", "dashboard_memdb.py"}
_MODES = ("off", "log", "raise")
_VIOLATIONS: dict = {}
_LOGGED: set = set()


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


def _escape_caller(skip: Optional[set] = None) -> str:
    """tenant_scope / tenant_db dışındaki ilk çerçeve. En fazla 10 adım."""
    skipped = _SKIP_CALLER if skip is None else skip
    try:
        frame = sys._getframe()
    except ValueError:
        return "unknown"
    for _ in range(10):
        frame = frame.f_back
        if frame is None:
            return "unknown"
        base = os.path.basename(frame.f_code.co_filename or "")
        if not base or base in skipped:
            continue
        return f"{base}:{frame.f_lineno}"
    return "unknown"


def _guard_caller() -> str:
    """mysql_store / dashboard_memdb / tenant_scope / tenant_db dışı ilk çerçeve."""
    return _escape_caller(_GUARD_SKIP)


class _Unscoped:
    def __init__(self, reason: str):
        text = str(reason or "").strip()
        if not text:
            raise ValueError("reason boş")
        self.reason = text
        self._token: Optional[Token] = None

    def __enter__(self):
        self._token = _UNSCOPED.set(True)
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
        if self._token is not None:
            _UNSCOPED.reset(self._token)
            self._token = None
        return False


def unscoped(reason: str):
    """Bilerek kapsam dışı erişim. reason boşsa ValueError; çağrı yeri loglanır."""
    return _Unscoped(reason)


def _read_mode(value=None) -> str:
    """off | log | raise. Boş, yok veya tanınmayan değer off."""
    if value is None:
        value = os.environ.get("TAMKOBI_TENANT_GUARD", "off")
    text = str(value or "").strip().lower()
    if text in _MODES:
        return text
    return "off"


_MODE = _read_mode()


def get_mode() -> str:
    return _MODE


def set_mode(mode: str) -> str:
    """Testler için. Önceki modu döner. Tanınmayan değer off olur."""
    global _MODE
    prev = _MODE
    _MODE = _read_mode(mode)
    return prev


def violations() -> dict:
    """{(collection, op, caller): adet} kopyası."""
    return dict(_VIOLATIONS)


def reset_violations() -> None:
    """Sayaç ve süreç-içi log tekilliği. Testler her vakadan önce çağırır."""
    _VIOLATIONS.clear()
    _LOGGED.clear()


def _bump(collection, op, caller) -> None:
    key = (str(collection), str(op), str(caller))
    _VIOLATIONS[key] = _VIOLATIONS.get(key, 0) + 1


def _value_conflicts(val, scope: TenantScope) -> bool:
    """tenant_db._classify_company ile aynı kural. Eşitlik company_id, $in allowed alt kümesi."""
    cid = scope.company_id
    allowed = scope.allowed
    if isinstance(val, dict):
        has_in = "$in" in val
        has_eq = "$eq" in val
        if not has_in and not has_eq:
            return True
        if has_eq and str(val.get("$eq") or "") != cid:
            return True
        if has_in:
            requested = val.get("$in")
            if not isinstance(requested, (list, tuple, set, frozenset)):
                return True
            wanted = {str(item) for item in requested}
            if not wanted <= allowed:
                return True
        return False
    if val is None or str(val).strip() == "" or str(val) != cid:
        return True
    return False


def _is_constrained(clause) -> bool:
    """Üst seviye company_id veya $and içinde company_id."""
    if not isinstance(clause, dict):
        return False
    if "company_id" in clause:
        return True
    nested = clause.get("$and")
    if isinstance(nested, list):
        return any(_is_constrained(item) for item in nested)
    return False


def _collect_company(node, found: list) -> None:
    """tenant_db._walk_company ile aynı yürüyüş. Değerleri toplar, istisna atmaz."""
    if isinstance(node, list):
        for item in node:
            _collect_company(item, found)
        return
    if not isinstance(node, dict):
        return
    if "company_id" in node:
        found.append(node["company_id"])
    for key, val in node.items():
        if key == "company_id":
            continue
        if key in ("$and", "$or", "$nor") and isinstance(val, list):
            for item in val:
                _collect_company(item, found)
        elif isinstance(val, dict) and str(key).startswith("$"):
            _collect_company(val, found)


def _status_query(query, scope) -> str:
    """ok | missing | conflict. Beklenmedik tip TypeError."""
    if query is None:
        return "missing"
    if not isinstance(query, dict):
        raise TypeError("unexpected query")
    if "company_id" in query and not any(str(key).startswith("$") for key in query):
        if scope is not None and _value_conflicts(query["company_id"], scope):
            return "conflict"
        return "ok"
    found: list = []
    _collect_company(query, found)
    if scope is not None:
        for val in found:
            if _value_conflicts(val, scope):
                return "conflict"
    if not _is_constrained(query):
        return "missing"
    return "ok"


def _status_docs(doc, scope, many: bool) -> str:
    if many:
        if isinstance(doc, dict):
            docs = [doc]
        elif isinstance(doc, (list, tuple)):
            docs = list(doc)
        else:
            raise TypeError("unexpected docs")
    else:
        if not isinstance(doc, dict):
            raise TypeError("unexpected doc")
        docs = [doc]
    if not docs:
        return "ok"
    missing = False
    for item in docs:
        if not isinstance(item, dict):
            raise TypeError("unexpected doc")
        if "company_id" not in item:
            missing = True
            continue
        if scope is not None and _value_conflicts(item["company_id"], scope):
            return "conflict"
    if missing:
        return "missing"
    return "ok"


def _status_update(update, scope) -> str:
    """$set / $setOnInsert company_id. Yoksa missing. Çelişki conflict."""
    if update is None:
        return "missing"
    if isinstance(update, list):
        status = "missing"
        for stage in update:
            part = _status_update(stage, scope)
            if part == "conflict":
                return "conflict"
            if part == "ok":
                status = "ok"
        return status
    if not isinstance(update, dict):
        raise TypeError("unexpected update")
    if not any(str(key).startswith("$") for key in update):
        if "company_id" not in update:
            return "missing"
        if scope is not None and _value_conflicts(update["company_id"], scope):
            return "conflict"
        return "ok"
    vals = []
    for key in ("$set", "$setOnInsert"):
        body = update.get(key)
        if isinstance(body, dict) and "company_id" in body:
            vals.append(body["company_id"])
    if not vals:
        return "missing"
    if scope is not None:
        for val in vals:
            if _value_conflicts(val, scope):
                return "conflict"
    return "ok"


def _merge_presence(left: str, right: str) -> str:
    """Upsert: sorguda veya $set/$setOnInsert içinde company_id yeter."""
    if left == "conflict" or right == "conflict":
        return "conflict"
    if left == "ok" or right == "ok":
        return "ok"
    return "missing"


def _merge_required(left: str, right: str) -> str:
    """replace: hem filtre hem yeni belge company_id taşır."""
    if left == "conflict" or right == "conflict":
        return "conflict"
    if left == "missing" or right == "missing":
        return "missing"
    return "ok"


def _status_pipeline(pipeline, scope) -> str:
    if pipeline is None:
        return "missing"
    if not isinstance(pipeline, (list, tuple)):
        raise TypeError("unexpected pipeline")
    if not pipeline:
        return "missing"
    first = pipeline[0]
    if not isinstance(first, dict) or "$match" not in first:
        return "missing"
    return _status_query(first.get("$match"), scope)


def _status_company_arg(company_id, scope) -> str:
    if company_id is None or str(company_id).strip() == "":
        return "missing"
    if scope is not None and str(company_id) != scope.company_id:
        return "conflict"
    return "ok"


_QUERY_OPS = {
    "find",
    "find_one",
    "count_documents",
    "delete_one",
    "delete_many",
    "distinct",
    "update_one",
    "update_many",
    "update_one_atomic",
    "find_one_and_update",
    "replace_one",
}
_UPDATE_OPS = {"update_one", "update_many", "update_one_atomic", "find_one_and_update"}


def _evaluate(op, query, doc, update, pipeline, company_id, upsert, scope) -> str:
    name = str(op or "")
    if name == "changed_since":
        return _status_company_arg(company_id, scope)
    if name == "aggregate":
        return _status_pipeline(pipeline, scope)
    if name in ("insert_one", "insert_many"):
        return _status_docs(doc, scope, many=(name == "insert_many"))
    if name == "replace_one":
        return _merge_required(_status_query(query, scope), _status_docs(doc, scope, many=False))
    if name in _UPDATE_OPS:
        query_status = _status_query(query, scope)
        update_status = _status_update(update, scope)
        if query_status == "conflict" or update_status == "conflict":
            return "conflict"
        if upsert:
            return _merge_presence(query_status, update_status)
        return query_status
    if name in _QUERY_OPS or query is not None:
        return _status_query(query, scope)
    if doc is not None:
        return _status_docs(doc, scope, many=isinstance(doc, (list, tuple)))
    if pipeline is not None:
        return _status_pipeline(pipeline, scope)
    if company_id is not None:
        return _status_company_arg(company_id, scope)
    return "missing"


def _emit_once(collection, op, event, scope) -> None:
    caller = _guard_caller()
    key = (str(collection), str(op), caller)
    if key in _LOGGED:
        return
    _LOGGED.add(key)
    kind = scope.kind if scope is not None else "none"
    try:
        log_event(
            event,
            collection=str(collection),
            op=str(op),
            caller=caller,
            kind=kind,
            mode="log",
        )
    except Exception:
        pass


def _act(collection, op, event, scope) -> None:
    if _MODE == "log":
        _emit_once(collection, op, event, scope)
        return
    if _MODE != "raise":
        return
    if scope is not None:
        raise TenantScopeViolation()
    _bump(collection, op, _guard_caller())


def check(
    collection,
    op,
    query=None,
    doc=None,
    update=None,
    pipeline=None,
    company_id=None,
    upsert: bool = False,
):
    """Kiracı koleksiyonunda company_id koruması.

    off: hemen döner. log: ihlali bir kez yazar, atmaz.
    raise: bağlı kapsam ve unscoped dışı ihlalde TenantScopeViolation.
    Kapsam yoksa yalnız sayaç. Üyelik, şirket, platform ve token atlanır.
    İhlal yoksa çerçeve taranmaz. İç hata yutulur ve "internal" sayılır.
    """
    if _MODE == "off":
        return
    if _UNSCOPED.get():
        return
    try:
        kind = collection_kind(collection)
        if kind not in ("tenant", "unknown"):
            return
        scope = current()
        status = _evaluate(op, query, doc, update, pipeline, company_id, upsert, scope)
    except TenantScopeViolation:
        raise
    except Exception:
        _bump(collection, op, "internal")
        return
    if status == "ok":
        return
    event = "tenant_guard.conflict" if status == "conflict" else "tenant_guard.unscoped"
    _act(collection, op, event, scope)
