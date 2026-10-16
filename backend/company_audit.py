"""Firma işlem geçmişi.

Kayıtlar yalnızca eklenir. Güncelleme ve silme API'si yoktur; 1 yıldan eski
satırlar arka plan temizliğinde düşer. Şifre, token ve kart bilgisi yazılmaz.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

import rbac
import tenant_access
from client_ip import request_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")
_db = None
_current_user = None

COLLECTION = "company_audit_log"
RETENTION_DAYS = 365
CLEANUP_EVERY_S = 6 * 3600
LIST_LIMIT = 200
EXPORT_LIMIT = 5000

ACTIONS = {
    "create": "Oluşturma",
    "update": "Güncelleme",
    "delete": "Silme",
    "restore": "Geri alma",
    "approve": "Onay",
    "invoice_issue": "Fatura kesme",
    "invoice_cancel": "Fatura iptal",
    "payment": "Ödeme",
    "collection": "Tahsilat",
    "login": "Giriş",
    "logout": "Çıkış",
    "permission": "Yetki değişikliği",
}

# Alan adı bu kalıba uyarsa değer hiç yazılmaz.
_SENSITIVE_KEY = re.compile(
    r"(password|passwd|token|secret|api[_-]?key|authorization|cookie|session|"
    r"card|pan\b|cvv|cvc|iban|credit|otp|pin)",
    re.I,
)
_JWT = re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}")
_PAN = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_SKIP_DIFF = {
    "updated_at", "created_at", "restored_at", "password_hash", "id", "_id",
    "company_id", "effects_applied",
}
_LABEL_FIELDS = (
    "invoice_number", "order_number", "quote_number", "expense_number",
    "full_name", "name", "title", "sku", "plate", "label", "email",
)
_NO_FIELDS = (
    "invoice_number", "order_number", "quote_number", "expense_number", "sku", "plate",
)
_FIELD_LABELS = {
    "sale_price": "Fiyat",
    "price": "Fiyat",
    "purchase_price": "Alış fiyatı",
    "unit_price": "Birim fiyat",
    "list_price": "Liste fiyatı",
    "amount": "Tutar",
    "total": "Tutar",
    "grand_total": "Genel toplam",
    "paid_amount": "Ödenen",
    "name": "Ad",
    "full_name": "Ad",
    "title": "Başlık",
    "status": "Durum",
    "quantity": "Miktar",
    "stock_quantity": "Stok",
    "role": "Rol",
    "email": "E-posta",
    "phone": "Telefon",
    "address": "Adres",
    "description": "Açıklama",
    "note": "Not",
}

# API ilk segmenti -> (koleksiyon, modül, ekran yolu)
_RESOURCES = {
    "products": ("products", "/stock", "/stock"),
    "contacts": ("contacts", "/contacts", "/contacts"),
    "invoices": ("invoices", "/invoices", "/invoices"),
    "dispatches": ("invoices", "/dispatches", "/dispatches"),
    "orders": ("orders", "/orders", "/orders"),
    "quotes": ("quotes", "/quotes", "/quotes"),
    "projects": ("projects", "/projects", "/projects"),
    "surveys": ("surveys", "/surveys", "/surveys"),
    "expenses": ("expenses", "/expenses", "/expenses"),
    "loans": ("loans", "/loans", "/loans"),
    "cheques": ("cheques", "/cheques", "/cheques"),
    "installments": ("installments", "/installments", "/installments"),
    "vehicles": ("vehicles", "/vehicles", "/vehicles"),
    "purchase-orders": ("purchase_orders", "/purchase-orders", "/purchase-orders"),
    "roles": ("roles", "/settings", "/settings"),
    "users": ("users", "/settings", "/settings"),
    "employees": ("employees", "/personnel", "/personnel"),
    "payrolls": ("payrolls", "/personnel", "/personnel"),
    "leaves": ("leaves", "/personnel", "/personnel"),
    "warehouses": ("warehouses", "/warehouses", "/warehouses"),
    "recipes": ("recipes", "/production", "/production"),
    "attendance": ("attendance", "/mesai", "/mesai"),
    "trash": ("trash", "/trash", "/trash"),
    "companies": ("companies", "/settings", "/settings"),
    "trade-files": ("trade_files", "/dis-ticaret", "/dis-ticaret"),
    "support": ("support_tickets", "/support", "/support"),
}

_SKIP_PREFIXES = (
    "/api/auth",
    "/api/health",
    "/api/version",
    "/api/notifications",
    "/api/sync",
    "/api/public",
    "/api/files",
    "/api/mobile",
    "/api/dashboard",
    "/api/fx",
    "/api/system",
    "/api/platform",
    "/api/webhook",
    "/api/payments",
    "/api/vpos",
    "/api/company-audit",
    "/api/activity-logs",
    "/api/setup",
    "/api/license",
    "/api/demo",
    "/api/einvoice/settings",
    "/api/einvoice/test",
    "/api/integrations",
    "/api/migration",
)
_NOISY_TAILS = {
    "location",
    "task-site-presence",
    "location-unavailable",
    "run-alerts",
    "push-token",
    "preferences",
}
_NESTED = {"employees", "payrolls", "leaves", "bonuses", "attendance"}


def init(db, current_user_dep=None):
    global _db, _current_user
    _db = db
    if current_user_dep is not None:
        _current_user = current_user_dep


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime] = None) -> str:
    return (dt or _now()).isoformat()


def sensitive_key(name: str) -> bool:
    return bool(_SENSITIVE_KEY.search(str(name or "")))


def scrub(value: Any) -> Any:
    """Sözlükten hassas anahtarları çıkarır. Kalan metindeki PAN/JWT silinir."""
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if sensitive_key(key):
                continue
            out[key] = scrub(item)
        return out
    if isinstance(value, list):
        return [scrub(item) for item in value[:30]]
    if isinstance(value, str):
        return clean_text(value)
    return value


def clean_text(text: str, limit: int = 400) -> str:
    raw = str(text or "")
    raw = _JWT.sub("[token]", raw)
    raw = _PAN.sub("[kart]", raw)
    raw = re.sub(
        r"(?i)(password|passwd|token|secret|api[_-]?key|cvv|cvc|card(?:_number)?|pan|iban)\s*[:=]\s*\S+",
        lambda m: f"{m.group(1)}=[gizli]",
        raw,
    )
    return raw[:limit]


def client_source(request: Optional[Request]) -> str:
    if request is None:
        return "web"
    header = (request.headers.get("x-tamkobi-client") or "").strip().lower()
    if header in ("mobile", "app"):
        return "mobile"
    ua = (request.headers.get("user-agent") or "").lower()
    if any(mark in ua for mark in ("tamkobimobile", "okhttp", "expo")):
        return "mobile"
    return "web"


def _fmt(value: Any) -> str:
    if isinstance(value, bool):
        return "evet" if value else "hayır"
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(round(value, 4)).rstrip("0").rstrip(".")
    if value is None or value == "":
        return "—"
    return clean_text(value, 80)


def diff_summary(before: Optional[dict], after: Optional[dict], limit: int = 4) -> str:
    """Değişen düz alanlardan kısa özet. Örnek: Fiyat 100 → 120."""
    old = before or {}
    new = after or {}
    keys = []
    for key in list(old.keys()) + list(new.keys()):
        if key in keys or key in _SKIP_DIFF or str(key).startswith("_"):
            continue
        if sensitive_key(key):
            continue
        keys.append(key)
    parts: List[str] = []
    for key in keys:
        a, b = old.get(key), new.get(key)
        if a == b:
            continue
        if key == "features":
            code = str((new or {}).get("code") or (old or {}).get("code") or "")
            before_f = rbac.role_features({"code": code, "features": a if isinstance(a, dict) else {}})
            after_f = rbac.role_features({"code": code, "features": b if isinstance(b, dict) else {}})
            labels = {fk: lab for fk, lab, _ in rbac.FEATURES}
            for fk, lab in labels.items():
                if bool(before_f.get(fk)) == bool(after_f.get(fk)):
                    continue
                parts.append(f"{lab} {'açıldı' if after_f.get(fk) else 'kapatıldı'}")
                if len(parts) >= limit:
                    break
            continue
        if isinstance(a, (dict, list)) or isinstance(b, (dict, list)):
            if a != b:
                parts.append(f"{_FIELD_LABELS.get(key, key)} güncellendi")
            continue
        label = _FIELD_LABELS.get(key, key.replace("_", " "))
        parts.append(f"{label} {_fmt(a)} → {_fmt(b)}")
        if len(parts) >= limit:
            break
    return clean_text("; ".join(parts))


def _record_bits(doc: Optional[dict]) -> Dict[str, str]:
    src = doc or {}
    if src.get("doc") and isinstance(src.get("doc"), dict) and src.get("label"):
        # Çöp kutusu zarfı
        inner = src.get("doc") or {}
        return {
            "record_label": clean_text(str(src.get("label") or ""), 160),
            "record_no": clean_text(str(inner.get("invoice_number") or inner.get("order_number") or inner.get("sku") or ""), 80),
        }
    label = ""
    for key in _LABEL_FIELDS:
        if sensitive_key(key):
            continue
        val = src.get(key)
        if val not in (None, ""):
            label = str(val)
            break
    number = ""
    for key in _NO_FIELDS:
        val = src.get(key)
        if val not in (None, ""):
            number = str(val)
            break
    return {"record_label": clean_text(label, 160), "record_no": clean_text(number, 80)}


def _module_label(module: str) -> str:
    return dict(rbac.MODULES).get(module, module or "Genel")


def href_for(resource: str, module: str, doc_id: str, label: str) -> str:
    if resource == "invoices" and doc_id:
        return f"/invoices?edit={quote(doc_id)}"
    if resource == "contacts" and doc_id:
        return f"/contacts?contact_id={quote(doc_id)}"
    if resource == "products":
        q = label or doc_id
        return f"/stock?q={quote(q)}" if q else "/stock"
    if resource == "orders":
        q = label or doc_id
        return f"/orders?q={quote(q)}" if q else "/orders"
    if resource in ("roles", "users"):
        return "/settings?tab=users"
    if resource == "trash":
        return "/trash"
    if resource in ("employees", "payrolls", "leaves"):
        return "/personnel"
    if module == "/":
        return "/panel"
    if module and module.startswith("/"):
        return module
    return ""


def parse_target(path: str) -> Optional[dict]:
    if not path.startswith("/api/") or path.startswith(_SKIP_PREFIXES):
        return None
    parts = [p for p in path.split("/") if p]
    if len(parts) < 2:
        return None
    segs = parts[1:]
    resource = segs[0]
    rest = segs[1:]
    if resource == "personnel" and rest and rest[0] in _NESTED:
        resource = rest[0]
        rest = rest[1:]
    if resource == "einvoice":
        return None
    doc_id = ""
    tail = ""
    verbs = {
        "pay", "unpay", "collect", "approve", "cancel", "restore",
        "send-to-gib", "record-payment", "reject-incoming", "accept-incoming",
        "confirm", "self", "me",
    }
    if rest:
        if rest[0] in verbs:
            tail = "/".join(rest)
        else:
            doc_id = rest[0]
            tail = "/".join(rest[1:])
    head = (tail.split("/")[0] if tail else "")
    if head in _NOISY_TAILS:
        return None
    return {"resource": resource, "doc_id": doc_id, "tail": tail, "head": head}


def action_for(method: str, parsed: dict, hint_type: str = "", invoice_type: str = "") -> Optional[str]:
    method_u = (method or "").upper()
    if method_u not in ("POST", "PUT", "PATCH", "DELETE"):
        return None
    resource = parsed["resource"]
    head = parsed.get("head") or ""
    if resource == "trash" and (head == "restore" or method_u == "POST" and parsed.get("tail", "").endswith("restore")):
        return "restore"
    if head in ("approve", "accept-incoming", "confirm"):
        return "approve"
    if head == "send-to-gib":
        return "invoice_issue"
    if head == "cancel" and resource in ("invoices", "dispatches"):
        return "invoice_cancel"
    if head == "record-payment":
        if hint_type in ("inflow", "collection", "in") or invoice_type == "sales":
            return "collection"
        return "payment"
    if head in ("pay", "unpay"):
        return "payment"
    if head == "collect":
        return "collection"
    if resource in ("roles", "users"):
        return "permission"
    if method_u == "DELETE":
        return "delete"
    if method_u in ("PUT", "PATCH"):
        return "update"
    if method_u == "POST":
        return "create"
    return None


def _collection_of(resource: str) -> str:
    row = _RESOURCES.get(resource)
    return row[0] if row else ""


def _module_of(path: str, resource: str) -> str:
    mapped = rbac.module_for_path(path)
    if mapped:
        return mapped
    row = _RESOURCES.get(resource)
    return row[1] if row else "/settings"


def _screen_of(resource: str, module: str) -> str:
    row = _RESOURCES.get(resource)
    if row:
        return row[2]
    return module or "/panel"


async def prepare(request: Request, db, user: Optional[dict]) -> None:
    """Güncelleme/silme öncesi belgeyi okur. İstek gövdesi okunmaz (şifre/token sızmasın, akış bozulmasın)."""
    if not user or request.method in ("GET", "HEAD", "OPTIONS"):
        return
    parsed = parse_target(request.url.path)
    if not parsed:
        return
    hint = ""
    before = None
    coll = _collection_of(parsed["resource"])
    doc_id = parsed.get("doc_id") or ""
    if db is not None and coll and doc_id and parsed["resource"] != "trash":
        try:
            before = await db[coll].find_one({"_id": doc_id})
        except Exception:
            before = None
    elif db is not None and parsed["resource"] == "trash" and doc_id:
        try:
            before = await db["trash"].find_one({"_id": doc_id})
        except Exception:
            before = None
    invoice_type = str((before or {}).get("invoice_type") or "")
    action = action_for(request.method, parsed, hint_type=hint, invoice_type=invoice_type)
    if not action:
        return
    request.state.company_audit = {
        "parsed": parsed,
        "before": before,
        "hint": hint,
        "action": action,
    }


def _summary_for(action: str, before: Optional[dict], after: Optional[dict], bits: dict) -> str:
    label = bits.get("record_label") or bits.get("record_no") or ""
    changed = diff_summary(before, after) if action in ("update", "permission") else ""
    if action == "update" and changed:
        return changed
    if action == "permission" and changed:
        return changed
    titles = {
        "create": "Oluşturuldu",
        "update": "Güncellendi",
        "delete": "Silindi",
        "restore": "Çöp kutusundan geri alındı",
        "approve": "Onaylandı",
        "invoice_issue": "Fatura kesildi",
        "invoice_cancel": "Fatura iptal edildi",
        "payment": "Ödeme kaydedildi",
        "collection": "Tahsilat kaydedildi",
        "login": "Giriş yapıldı",
        "logout": "Çıkış yapıldı",
        "permission": "Yetki güncellendi",
    }
    base = titles.get(action, action)
    if label and action not in ("login", "logout"):
        return clean_text(f"{base}: {label}")
    return base


async def commit_from_request(request: Request, db, user: Optional[dict], status_code: int) -> None:
    state = getattr(getattr(request, "state", None), "company_audit", None)
    if not state or not user or not db or status_code >= 400:
        return
    parsed = state["parsed"]
    action = state["action"]
    before = state.get("before")
    after = None
    coll = _collection_of(parsed["resource"])
    doc_id = parsed.get("doc_id") or ""
    if action not in ("delete", "restore") and coll and doc_id and parsed["resource"] != "trash":
        try:
            after = await db[coll].find_one({"_id": doc_id})
        except Exception:
            after = None
    src = after or before or {}
    if parsed["resource"] == "trash":
        src = before or {}
    bits = _record_bits(src if isinstance(src, dict) else {})
    summary = _summary_for(
        action,
        before if action in ("update", "permission") else None,
        after if action in ("update", "permission") else None,
        bits,
    )
    if parsed["resource"] == "attendance" and not bits["record_label"]:
        summary = "Puantaj giriş/çıkış"
    company_id = ""
    if isinstance(src, dict):
        company_id = str(src.get("company_id") or (src.get("doc") or {}).get("company_id") or "")
    if not company_id:
        requested = str(request.query_params.get("company_id") or "").strip()
        if requested:
            try:
                company_id = tenant_access.resolve_company_id(user, requested)
            except HTTPException:
                return
        else:
            company_id = str(user.get("active_company_id") or "").strip()
    if not company_id:
        return
    path = request.url.path
    module = _module_of(path, parsed["resource"])
    record_id = doc_id or str((src or {}).get("_id") or "")
    if parsed["resource"] == "trash" and isinstance(src, dict):
        record_id = str((src.get("doc") or {}).get("_id") or record_id)
    await write(
        db,
        company_id=company_id,
        user=user,
        module=module,
        action=action,
        record_id=record_id,
        record_label=bits["record_label"],
        record_no=bits["record_no"],
        summary=summary,
        ip=request_ip(request),
        source=client_source(request),
        href=href_for(parsed["resource"], module, record_id, bits["record_label"] or bits["record_no"]),
        path=path,
    )


async def safe_prepare(request: Request, db, user: Optional[dict]) -> None:
    try:
        await prepare(request, db, user)
    except Exception:
        logger.exception("company_audit prepare")


async def safe_commit(request: Request, db, user: Optional[dict], status_code: int) -> None:
    try:
        await commit_from_request(request, db, user, status_code)
    except Exception:
        logger.exception("company_audit commit")


def _user_bits(user: Optional[dict]) -> Dict[str, str]:
    user = user or {}
    uid = str(user.get("id") or user.get("_id") or "")
    name = str(user.get("name") or user.get("full_name") or user.get("email") or "").strip()
    return {"user_id": uid, "user_name": clean_text(name, 120)}


async def write(db, *, company_id: str, user: Optional[dict], module: str, action: str,
                record_id: str = "", record_label: str = "", record_no: str = "",
                summary: str = "", ip: str = "", source: str = "web", href: str = "", path: str = "") -> Optional[str]:
    cid = str(company_id or "").strip()
    if not cid or db is None:
        return None
    action = action if action in ACTIONS else "update"
    now = _now()
    bits = _user_bits(user)
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": cid,
        "at": _iso(now),
        "expires_at": _iso(now + timedelta(days=RETENTION_DAYS)),
        "user_id": bits["user_id"],
        "user_name": bits["user_name"],
        "module": module or "/settings",
        "module_label": _module_label(module or "/settings"),
        "action": action,
        "action_label": ACTIONS[action],
        "record_id": clean_text(record_id, 80),
        "record_label": clean_text(record_label, 160),
        "record_no": clean_text(record_no, 80),
        "summary": clean_text(summary or ACTIONS[action]),
        "ip": clean_text(ip, 64),
        "source": "mobile" if source == "mobile" else "web",
        "href": href if isinstance(href, str) and href.startswith("/") and "token" not in href.lower() else "",
        "path": clean_text(path, 180),
    }
    # Son kapı: hassas anahtar veya PAN/JWT kalmasın.
    stored = scrub(doc)
    stored["_id"] = doc["_id"]
    stored["company_id"] = cid
    await db[COLLECTION].insert_one(stored)
    return stored["_id"]


async def record_auth(db, user: Optional[dict], request: Optional[Request], action: str, summary: str) -> None:
    """Giriş/çıkış. Kullanıcı belgesindeki şifre ve yanıt token'ı yazılmaz."""
    if not user or action not in ("login", "logout"):
        return
    cid = str(user.get("active_company_id") or ((user.get("company_ids") or [None])[0]) or "").strip()
    if not cid:
        return
    try:
        await write(
            db,
            company_id=cid,
            user=user,
            module="/settings",
            action=action,
            record_id=str(user.get("id") or user.get("_id") or ""),
            record_label=str(user.get("name") or ""),
            summary=summary,
            ip=request_ip(request) if request is not None else "",
            source=client_source(request),
            href="",
            path=f"/api/auth/{action}",
        )
    except Exception:
        logger.exception("company_audit %s", action)


def viewer_allowed(user: Optional[dict], role: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("is_super_admin"):
        return True
    if rbac.normalize_role_code(user.get("role")) == "admin":
        return True
    return bool(rbac.role_features(role or {"code": user.get("role") or "", "features": {}}).get("company_audit"))


async def require_company(db, user: dict, company_id: Optional[str]) -> str:
    """company_id zorunlu. Başka firma veya yetkisiz kullanıcı içeri giremez."""
    if not str(company_id or "").strip():
        raise HTTPException(status_code=400, detail="company_id zorunlu.")
    cid = tenant_access.resolve_company_id(user, company_id)
    if user.get("is_super_admin") or rbac.normalize_role_code(user.get("role")) == "admin":
        return cid
    role = None
    if db is not None:
        role = await db["roles"].find_one({"company_id": cid, "code": rbac.normalize_role_code(user.get("role"))})
    if not viewer_allowed(user, role or {"code": user.get("role") or "", "features": {}}):
        raise HTTPException(status_code=403, detail="İşlem geçmişini görme yetkiniz yok.")
    return cid


def _public(doc: dict) -> dict:
    raw = scrub(dict(doc or {}))
    raw.pop("password_hash", None)
    if "_id" in raw:
        raw["id"] = str(raw.pop("_id"))
    return raw


async def list_entries(
    db,
    user: dict,
    company_id: Optional[str],
    *,
    user_id: str = "",
    module: str = "",
    action: str = "",
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    limit: int = LIST_LIMIT,
) -> dict:
    cid = await require_company(db, user, company_id)
    query: Dict[str, Any] = {"company_id": cid}
    if user_id:
        query["user_id"] = user_id
    if module:
        query["module"] = module
    if action:
        query["action"] = action
    span: Dict[str, str] = {}
    if date_from:
        span["$gte"] = date_from if "T" in date_from else f"{date_from}T00:00:00"
    if date_to:
        span["$lte"] = date_to if "T" in date_to else f"{date_to}T23:59:59.999999"
    if span:
        query["at"] = span
    cap = EXPORT_LIMIT if limit > LIST_LIMIT else min(max(int(limit or LIST_LIMIT), 1), LIST_LIMIT)
    if limit > LIST_LIMIT:
        cap = min(int(limit), EXPORT_LIMIT)
    cursor = db[COLLECTION].find(query)
    if hasattr(cursor, "sort"):
        cursor = cursor.sort("at", -1)
    rows = await cursor.to_list(5000)
    rows.sort(key=lambda d: str(d.get("at") or ""), reverse=True)
    needle = (q or "").strip().lower()
    if needle:
        def hit(row: dict) -> bool:
            blob = " ".join(str(row.get(k) or "") for k in ("summary", "record_label", "record_no", "user_name", "action_label", "module_label"))
            return needle in blob.lower()
        rows = [row for row in rows if hit(row)]
    total = len(rows)
    page = [_public(row) for row in rows[:cap]]
    actors = []
    seen = set()
    for row in rows:
        uid = row.get("user_id") or ""
        if not uid or uid in seen:
            continue
        seen.add(uid)
        actors.append({"id": uid, "name": row.get("user_name") or uid})
    return {
        "items": page,
        "total": total,
        "actors": actors,
        "actions": [{"key": k, "label": v} for k, v in ACTIONS.items()],
        "modules": [{"key": k, "label": lab} for k, lab in rbac.MODULES],
        "retention_days": RETENTION_DAYS,
        "company_id": cid,
    }


def to_csv(items: List[dict]) -> str:
    cols = [
        ("at", "Zaman"),
        ("user_name", "Kullanıcı"),
        ("user_id", "Kullanıcı no"),
        ("module_label", "Modül"),
        ("action_label", "İşlem"),
        ("record_label", "Kayıt"),
        ("record_no", "Kayıt no"),
        ("summary", "Özet"),
        ("ip", "IP"),
        ("source", "Kaynak"),
    ]

    def cell(value: Any) -> str:
        text = clean_text("" if value is None else str(value), 500)
        if text[:1] in ("=", "+", "-", "@"):
            text = "'" + text
        text = text.replace('"', '""')
        return f'"{text}"'

    lines = [";".join(label for _, label in cols)]
    for row in items:
        lines.append(";".join(cell(row.get(key)) for key, _ in cols))
    return "\ufeff" + "\n".join(lines)


async def purge_expired(db, *, now: Optional[datetime] = None) -> int:
    """1 yıldan eski kayıtları siler. Kullanıcı API'si bunu çağırmaz."""
    if db is None:
        return 0
    cutoff = _iso((now or _now()) - timedelta(days=RETENTION_DAYS))
    stale = await db[COLLECTION].find({"$or": [{"at": {"$lt": cutoff}}, {"expires_at": {"$lt": cutoff}}]}).to_list(5000)
    deleted = 0
    for doc in stale:
        try:
            await db[COLLECTION].delete_one({"_id": doc["_id"]})
            deleted += 1
        except Exception:
            logger.exception("company_audit purge %s", doc.get("_id"))
    if deleted:
        logger.info("company_audit purge: %s kayıt silindi", deleted)
    return deleted


async def cleanup_loop(db) -> None:
    while True:
        try:
            await purge_expired(db)
        except Exception:
            logger.exception("company_audit cleanup_loop")
        await asyncio.sleep(CLEANUP_EVERY_S)


async def ensure_indexes(db) -> None:
    try:
        await db[COLLECTION].create_index([("company_id", 1), ("at", -1)])
    except Exception:
        logger.exception("company_audit index")


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="İşlem geçmişi oturumu bağlanmadı.")
    return await _current_user(request)


@router.get("/company-audit")
async def company_audit_list(
    company_id: str,
    user_id: str = "",
    module: str = "",
    action: str = "",
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    limit: int = LIST_LIMIT,
    user: dict = Depends(_user_dep),
):
    return await list_entries(
        _db, user, company_id,
        user_id=user_id, module=module, action=action,
        date_from=date_from, date_to=date_to, q=q, limit=limit,
    )


@router.get("/company-audit/export")
async def company_audit_export(
    company_id: str,
    user_id: str = "",
    module: str = "",
    action: str = "",
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    user: dict = Depends(_user_dep),
):
    data = await list_entries(
        _db, user, company_id,
        user_id=user_id, module=module, action=action,
        date_from=date_from, date_to=date_to, q=q, limit=EXPORT_LIMIT,
    )
    body = to_csv(data["items"])
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=islem_gecmisi.csv"},
    )
