"""Şirketler arası veri paylaşımı.

A şirketi, B şirketinin API anahtarını girerek bağlantı ister.
``from_company`` isteği gönderen (veriyi okuyacak taraf), ``to_company`` anahtarın
sahibi ve verinin sahibidir. Kayıt ``company_id`` olarak verinin sahibini taşır.
Kapsam ``cari|stok|fiyat|fatura`` için ``none|read|write``. Bağlantı yalnız
veri sahibi onayladıktan sonra ``active`` olur. İki taraf da kesebilir.

Okuma uçları ``/api/shared/{company_id}/...``. Yazma kapsamı saklanır; yazan uç
bu PR'da yoktur. Oturum, kullanıcının bağlı şirketi üzerinden; dış sistem
``Authorization: Bearer tk_live_...`` ile yalnız anahtarın sahibinin kendi
verisini ve ona paylaşılan veriyi görür.

Bildirim yalnız ``notify_outbox`` kuyruğuna yazılır.
"""
from __future__ import annotations

import html
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

import company_api_keys as keys
import tenant_scope
from mysql_store import DuplicateKeyError

logger = logging.getLogger("tamkobi.company_api")

router = APIRouter(prefix="/api")

SCOPE_NAMES = ("cari", "stok", "fiyat", "fatura")
SCOPE_LEVELS = ("none", "read", "write")
_NOTICE_DAILY = 20
_READ_LIMIT = 200

_db = None
_current_user = None


def _allow_shared_prefix() -> None:
    """Bearer tk_live_ JWT değildir. rbac.py değişmez.

    PermissionAndAuditMiddleware geçersiz JWT'yi herkese açık olmayan yolda 401
    ile keser. Önek allowlist'e eklenince istek bu modüle ulaşır; anahtar yoksa
    yine 401 döner. Oturumlu kullanıcı da aynı uçtan, bağlı şirketiyle girer.
    """
    try:
        import rbac
    except Exception:
        return
    current = getattr(rbac, "PUBLIC_API_ALLOWLIST", None)
    if not isinstance(current, tuple):
        return
    rule = "/api/shared/"
    if rule in current:
        return
    rbac.PUBLIC_API_ALLOWLIST = current + (rule,)


_allow_shared_prefix()


def init(db, current_user_dep=None) -> None:
    global _db, _current_user
    _db = db
    if current_user_dep is not None:
        _current_user = current_user_dep
    keys.init(db, current_user_dep)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty_scopes() -> dict:
    return {name: "none" for name in SCOPE_NAMES}


def normalize_scopes(raw: object) -> dict:
    if raw is None:
        return empty_scopes()
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="İzinler nesne olmalı.")
    out = {}
    for name in SCOPE_NAMES:
        level = str(raw.get(name) or "none").strip().lower()
        if level not in SCOPE_LEVELS:
            raise HTTPException(status_code=400, detail="İzin düzeyi none, read veya write olmalı.")
        out[name] = level
    return out


def _public_link(row: dict) -> dict:
    return {
        "id": row.get("_id"),
        "from_company": row.get("from_company"),
        "to_company": row.get("to_company"),
        "scopes": normalize_scopes(row.get("scopes") or empty_scopes()),
        "status": row.get("status"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def user_may_access_company(user: Optional[dict], company_id: str) -> bool:
    return keys.user_may_access_company(user, company_id)


async def _json_body(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Geçersiz istek.")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Geçersiz istek.")
    return data


async def _company_name(company_id: str) -> str:
    doc = await _db.companies.find_one({"_id": company_id}, {"name": 1}) if _db is not None else None
    return str((doc or {}).get("name") or company_id)


async def _admin_emails(company_id: str) -> list:
    rows = await _db.users.find({"company_ids": company_id}).to_list(100)
    found = []
    seen = set()
    for row in rows:
        if row.get("is_active") is False or row.get("is_super_admin"):
            continue
        if not keys.is_company_admin(row):
            continue
        email = str(row.get("email") or "").strip().lower()
        if "@" not in email or email in seen:
            continue
        seen.add(email)
        found.append(email)
    return found


async def _over_cap(company_id: str, event: str) -> bool:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    count = await _db.notify_outbox.count_documents({
        "company_id": company_id,
        "event": event,
        "created_at": {"$gte": start},
    })
    return count >= _NOTICE_DAILY


async def _enqueue(company_id: str, event: str, to: str, subject: str, text: str, html_body: str) -> None:
    now = _now_iso()
    await _db.notify_outbox.insert_one({
        "_id": uuid.uuid4().hex,
        "company_id": company_id,
        "event": event,
        "direct_to": True,
        "channels": {"email": True, "sms": False},
        "digest": "instant",
        "status": "pending",
        "attempts": 0,
        "to": [to],
        "subject": str(subject or "")[:300],
        "text": str(text or ""),
        "html": str(html_body or ""),
        "due_at": now,
        "created_at": now,
    })


async def _notify(company_id: str, event: str, subject: str, text: str, html_body: str) -> None:
    """Posta yalnız notify_outbox. SMTP çağrılmaz. Anahtar metne girmez."""
    try:
        for email in await _admin_emails(company_id):
            if await _over_cap(company_id, event):
                return
            await _enqueue(company_id, event, email, subject, text, html_body)
    except Exception as exc:
        logger.warning("company link notice skipped: %s", type(exc).__name__)


def _scope_text(scopes: dict) -> str:
    return ", ".join(f"{name}: {scopes.get(name)}" for name in SCOPE_NAMES)


async def _link_for(company_id: str, link_id: str) -> Optional[dict]:
    # tenant-ok: bağlantı iki şirkete ait; user_may_access_company çağıran şirketi doğrular
    return await _db.company_links.find_one({
        "_id": link_id,
        "$or": [{"company_id": company_id}, {"from_company": company_id}],
    })


async def _pair(from_company: str, to_company: str) -> Optional[dict]:
    return await _db.company_links.find_one({
        "company_id": to_company,
        "from_company": from_company,
        "to_company": to_company,
    })


def _owner_only(row: dict, company_id: str) -> None:
    owner = str(row.get("to_company") or row.get("company_id") or "")
    if company_id != owner:
        raise HTTPException(status_code=403, detail="İzinleri verinin sahibi belirler.")


async def _save(row: dict, fields: dict) -> dict:
    updated = {**row, **fields, "updated_at": fields.get("updated_at") or _now_iso()}
    await _db.company_links.update_one(
        {"_id": row["_id"], "company_id": row.get("company_id")},
        {"$set": {**fields, "updated_at": updated["updated_at"]}},
    )
    return updated


async def link_allows(viewer: str, owner: str, kind: str) -> bool:
    """Aktif bağlantı ve read/write kapsamı. viewer isteyen, owner verinin sahibi."""
    row = await _pair(viewer, owner)
    if not row or row.get("status") != "active":
        return False
    level = str((row.get("scopes") or {}).get(kind) or "none")
    return level in ("read", "write")


def _cap(limit: int) -> int:
    try:
        number = int(limit)
    except (TypeError, ValueError):
        number = 100
    if number < 1:
        return 1
    if number > _READ_LIMIT:
        return _READ_LIMIT
    return number


def _same_company(rows: list, company_id: str) -> list:
    return [row for row in rows if str(row.get("company_id") or "") == company_id]


def _pick(doc: dict, fields: tuple) -> dict:
    out = {"id": doc.get("_id")}
    for key in fields:
        if key in doc:
            out[key] = doc.get(key)
    return out


def _public_contact(doc: dict) -> dict:
    return _pick(doc, ("name", "type", "tax_number_or_id", "tax_office", "email", "phone", "city", "address", "balance", "currency"))


def _public_stock(doc: dict) -> dict:
    return _pick(doc, ("name", "sku", "barcode", "unit", "category", "type", "stock_quantity"))


def _public_price(doc: dict) -> dict:
    return _pick(doc, ("name", "sku", "barcode", "sale_price", "vat_rate", "currency"))


def _public_rule(doc: dict) -> dict:
    out = _pick(doc, ("channel", "margin_pct", "margin_base", "rounding", "min_price", "max_price", "list_price_markup_pct"))
    if not out.get("channel"):
        out["channel"] = doc.get("_id")
    return out


def _public_invoice(doc: dict) -> dict:
    lines = []
    for line in doc.get("items") or []:
        if not isinstance(line, dict):
            continue
        lines.append({
            "name": line.get("name"),
            "quantity": line.get("quantity"),
            "unit": line.get("unit"),
            "unit_price": line.get("unit_price"),
            "vat_rate": line.get("vat_rate"),
            "total": line.get("total"),
        })
    return {
        "id": doc.get("_id"),
        "invoice_number": doc.get("invoice_number"),
        "invoice_type": doc.get("invoice_type"),
        "issue_date": doc.get("issue_date"),
        "contact_name": doc.get("contact_name"),
        "grand_total": doc.get("grand_total"),
        "currency": doc.get("currency"),
        "status": doc.get("status"),
        "items": lines,
    }


async def _listed(cursor, company_id: str, limit: int) -> list:
    rows = _same_company(await cursor.to_list(limit), company_id)
    rows.sort(key=lambda item: str(item.get("_id") or ""))
    return rows


async def read_kind(company_id: str, kind: str, limit: int) -> dict:
    cap = _cap(limit)
    if kind == "cari":
        rows = await _listed(_db.contacts.find({"company_id": company_id}), company_id, cap)
        return {"company_id": company_id, "items": [_public_contact(row) for row in rows]}
    if kind == "stok":
        rows = await _listed(_db.products.find({"company_id": company_id}), company_id, cap)
        return {"company_id": company_id, "items": [_public_stock(row) for row in rows]}
    if kind == "fiyat":
        rows = await _listed(_db.products.find({"company_id": company_id}), company_id, cap)
        rules = await _listed(_db.pricing_rules.find({"company_id": company_id}), company_id, cap)
        return {
            "company_id": company_id,
            "items": [_public_price(row) for row in rows],
            "rules": [_public_rule(row) for row in rules],
        }
    rows = await _listed(_db.invoices.find({"company_id": company_id}), company_id, cap)
    return {"company_id": company_id, "items": [_public_invoice(row) for row in rows]}


async def authorize_shared(request: Request, user: Optional[dict], company_id: str, kind: str, *, member: bool) -> None:
    token = keys.bearer_token(request)
    if token.startswith(keys.KEY_PREFIX):
        await keys.enforce_ip_rate(request)
        doc = await keys.resolve_api_key(token)
        if not doc:
            logger.info("company api key rejected")
            raise HTTPException(status_code=401, detail="Geçersiz API anahtarı.")
        await keys.enforce_key_rate(str(doc.get("_id") or ""))
        await keys.touch_key(doc)
        viewer = str(doc.get("company_id") or "")
        if viewer == company_id:
            return
        if not await link_allows(viewer, company_id, kind):
            raise HTTPException(status_code=403, detail="Bu veri paylaşımına izniniz yok.")
        return
    if not user:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    await keys.enforce_user_rate(str(user.get("_id") or user.get("id") or "user"))
    if member or user_may_access_company(user, company_id):
        return
    viewer = str(user.get("active_company_id") or "").strip()
    if not viewer or not user_may_access_company(user, viewer):
        ids = [item for item in (user.get("company_ids") or []) if item]
        viewer = str(ids[0]) if len(ids) == 1 else ""
    if not viewer or not user_may_access_company(user, viewer) or viewer == company_id:
        raise HTTPException(status_code=403, detail="Bu veri paylaşımına izniniz yok.")
    if not await link_allows(viewer, company_id, kind):
        raise HTTPException(status_code=403, detail="Bu veri paylaşımına izniniz yok.")


async def _shared(request: Request, company_id: str, kind: str, limit: int, member: bool) -> dict:
    user = await keys.optional_user(request)
    if user and user_may_access_company(user, company_id):
        member = True
    await authorize_shared(request, user, company_id, kind, member=member)
    scope = tenant_scope.current()
    if scope is not None and company_id not in scope.allowed:
        with tenant_scope.unscoped("paylaşım kapsamı doğrulandı; hedef şirketin verisi okunur"):
            return await read_kind(company_id, kind, limit)
    return await read_kind(company_id, kind, limit)


@router.get("/shared/{company_id}/cari")
async def shared_cari(company_id: str, request: Request, limit: int = 100):
    user = await keys.optional_user(request)
    member = bool(user) and user_may_access_company(user, company_id)
    return await _shared(request, company_id, "cari", limit, member)


@router.get("/shared/{company_id}/stok")
async def shared_stok(company_id: str, request: Request, limit: int = 100):
    user = await keys.optional_user(request)
    member = bool(user) and user_may_access_company(user, company_id)
    return await _shared(request, company_id, "stok", limit, member)


@router.get("/shared/{company_id}/fiyat")
async def shared_fiyat(company_id: str, request: Request, limit: int = 100):
    user = await keys.optional_user(request)
    member = bool(user) and user_may_access_company(user, company_id)
    return await _shared(request, company_id, "fiyat", limit, member)


@router.get("/shared/{company_id}/fatura")
async def shared_fatura(company_id: str, request: Request, limit: int = 100):
    user = await keys.optional_user(request)
    member = bool(user) and user_may_access_company(user, company_id)
    return await _shared(request, company_id, "fatura", limit, member)


@router.get("/license/companies/{company_id}/links")
async def list_company_links(company_id: str, request: Request):
    user = await keys._user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await keys.require_admin_company(user, company_id)
    # tenant-ok: bağlantı iki şirkete ait; user_may_access_company çağıranı doğruladı
    rows = await _db.company_links.find({
        "$or": [{"company_id": company_id}, {"from_company": company_id}],
    }).to_list(200)
    rows.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return {"links": [_public_link(row) for row in rows]}


@router.post("/license/companies/{company_id}/links")
async def create_company_link(company_id: str, request: Request):
    user = await keys._user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await keys.require_admin_company(user, company_id)
    await keys.enforce_link_rate(company_id, request)
    body = await _json_body(request)
    secret = str(body.pop("api_key", "") or "").strip()
    if not secret.startswith(keys.KEY_PREFIX):
        raise HTTPException(status_code=400, detail="Anahtar geçersiz.")
    target = await keys.resolve_api_key(secret)
    if not target:
        raise HTTPException(status_code=400, detail="Anahtar geçersiz.")
    to_company = str(target.get("company_id") or "")
    if not to_company or to_company == company_id:
        raise HTTPException(status_code=400, detail="Kendi şirket anahtarınızla bağlantı kurulamaz.")
    existing = await _pair(company_id, to_company)
    now = _now_iso()
    if existing and existing.get("status") == "active":
        raise HTTPException(status_code=409, detail="Bağlantı zaten aktif.")
    if existing and existing.get("status") == "pending":
        return _public_link(existing)
    if existing:
        saved = await _save(existing, {
            "status": "pending",
            "scopes": empty_scopes(),
            "revoked_at": None,
            "updated_at": now,
        })
    else:
        created = {
            "_id": f"lnk_{uuid.uuid4().hex[:16]}",
            "company_id": to_company,
            "from_company": company_id,
            "to_company": to_company,
            "scopes": empty_scopes(),
            "status": "pending",
            "created_at": now,
            "updated_at": now,
            "created_by": str(user.get("_id") or user.get("id") or ""),
            "revoked_at": None,
        }
        try:
            await _db.company_links.insert_one(created)
        except DuplicateKeyError:
            raise HTTPException(status_code=409, detail="Bağlantı zaten var.")
        saved = created
    owner_name = html.escape(await _company_name(to_company))
    asker_name = html.escape(await _company_name(company_id))
    text = (
        f"{await _company_name(company_id)} şirketi, {await _company_name(to_company)} verisine "
        "bağlanmak istiyor. İzinleri siz belirleyip onaylayabilirsiniz."
    )
    html_body = (
        f"<p><strong>{asker_name}</strong> şirketi, <strong>{owner_name}</strong> "
        "verisine bağlanmak istiyor.</p>"
        "<p>İzinleri siz belirleyip onaylayabilirsiniz.</p>"
    )
    await _notify(to_company, "company_link_request", "Şirket bağlantı isteği", text, html_body)
    await keys._audit(company_id, user, "create", "Şirket bağlantı isteği gönderildi", request, record_id=saved["_id"])
    return _public_link(saved)


@router.post("/license/companies/{company_id}/links/{link_id}/approve")
async def approve_company_link(company_id: str, link_id: str, request: Request):
    user = await keys._user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await keys.require_admin_company(user, company_id)
    row = await _link_for(company_id, link_id)
    if not row:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    _owner_only(row, company_id)
    if row.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Yalnız bekleyen bağlantı onaylanır.")
    body = await _json_body(request)
    scopes = normalize_scopes(body.get("scopes"))
    saved = await _save(row, {"status": "active", "scopes": scopes, "approved_at": _now_iso(), "revoked_at": None})
    text = (
        f"{await _company_name(company_id)} bağlantıyı onayladı. "
        f"İzinler: {_scope_text(scopes)}."
    )
    safe_owner = html.escape(await _company_name(company_id))
    html_body = f"<p><strong>{safe_owner}</strong> bağlantıyı onayladı.</p><p>İzinler: {html.escape(_scope_text(scopes))}.</p>"
    await _notify(str(row.get("from_company") or ""), "company_link_approved", "Şirket bağlantısı onaylandı", text, html_body)
    await keys._audit(company_id, user, "approve", "Şirket bağlantısı onaylandı", request, record_id=link_id)
    return _public_link(saved)


@router.post("/license/companies/{company_id}/links/{link_id}/reject")
async def reject_company_link(company_id: str, link_id: str, request: Request):
    user = await keys._user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await keys.require_admin_company(user, company_id)
    row = await _link_for(company_id, link_id)
    if not row:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    _owner_only(row, company_id)
    if row.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Yalnız bekleyen bağlantı reddedilir.")
    saved = await _save(row, {"status": "revoked", "revoked_at": _now_iso()})
    text = f"{await _company_name(company_id)} bağlantı isteğini reddetti."
    html_body = f"<p><strong>{html.escape(await _company_name(company_id))}</strong> bağlantı isteğini reddetti.</p>"
    await _notify(str(row.get("from_company") or ""), "company_link_rejected", "Şirket bağlantısı reddedildi", text, html_body)
    await keys._audit(company_id, user, "update", "Şirket bağlantı isteği reddedildi", request, record_id=link_id)
    return _public_link(saved)


@router.put("/license/companies/{company_id}/links/{link_id}/scopes")
async def update_company_link_scopes(company_id: str, link_id: str, request: Request):
    user = await keys._user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await keys.require_admin_company(user, company_id)
    row = await _link_for(company_id, link_id)
    if not row:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    _owner_only(row, company_id)
    if row.get("status") not in ("pending", "active"):
        raise HTTPException(status_code=409, detail="Kapalı bağlantının izni değişmez.")
    body = await _json_body(request)
    scopes = normalize_scopes(body.get("scopes"))
    saved = await _save(row, {"scopes": scopes})
    await keys._audit(company_id, user, "permission", "Şirket bağlantı izinleri güncellendi", request, record_id=link_id)
    return _public_link(saved)


@router.post("/license/companies/{company_id}/links/{link_id}/revoke")
async def revoke_company_link(company_id: str, link_id: str, request: Request):
    user = await keys._user(request)
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    await keys.require_admin_company(user, company_id)
    row = await _link_for(company_id, link_id)
    if not row:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    if row.get("status") != "revoked":
        saved = await _save(row, {"status": "revoked", "revoked_at": _now_iso()})
        other = str(row.get("to_company") if company_id == row.get("from_company") else row.get("from_company") or "")
        text = f"{await _company_name(company_id)} şirket bağlantısını kesti."
        html_body = f"<p><strong>{html.escape(await _company_name(company_id))}</strong> şirket bağlantısını kesti.</p>"
        await _notify(other, "company_link_revoked", "Şirket bağlantısı kesildi", text, html_body)
        await keys._audit(company_id, user, "delete", "Şirket bağlantısı kesildi", request, record_id=link_id)
    else:
        saved = row
    return _public_link(saved)
