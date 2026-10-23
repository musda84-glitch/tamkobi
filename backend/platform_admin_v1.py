"""Yönetim paneli salt okunur API: /api/platform/admin-v1/* (HMAC, platform_admin).

Yazma, mail/SMS gönderimi ve SMTP/IMAP bağlantısı yok. authenticate'in
audit / nonce / last_used kayıtları dışında yan etki yoktur.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query, Request

import applog
from build_stamp import read_stamp
import company_sms
import event_notify
import password_reset
import platform_auth
import platform_mail
import platform_sms
import platform_store as store
import company_numbers
import saas
import saas_billing
import support_tickets

router = APIRouter(prefix="/api", tags=["platform-admin-v1"])

# Uzun parçalar alt dizgi. "pan" kart numarasıdır; "plan" / "company" düşmesin.
_DROP_SUBSTR = (
    "password",
    "password_hash",
    "_enc",
    "secret",
    "totp",
    "recovery",
    "token",
    "api_key",
    "card",
    "cvv",
    "iban_enc",
    "smtp_pass",
)
_PAN_PART = re.compile(r"[^a-z0-9]+")


def _drop_key(name: str, value: Any) -> bool:
    kl = str(name).lower()
    if kl == "has_password" or (kl.startswith("has_") and isinstance(value, bool)):
        return False
    if kl == "confirmation_token":
        return False
    if any(part in kl for part in _DROP_SUBSTR):
        return True
    parts = _PAN_PART.split(kl)
    return "pan" in parts or "pin" in parts


def _redact(obj: Any) -> Any:
    """Son katman: sır alanlarını özyinelemeli düşür. Girdiyi değiştirmez."""
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if _drop_key(key, value):
                continue
            out[key] = _redact(value)
        return out
    if isinstance(obj, list):
        return [_redact(item) for item in obj]
    return obj


def _page(items: List[Any], limit: int, offset: int, total: int) -> dict:
    return _redact({"items": items, "limit": limit, "offset": offset, "total": total})


def _item(item: Any) -> dict:
    return _redact({"item": item})


async def _auth(request: Request, scope: str) -> Tuple[dict, Dict[str, Any]]:
    """platform_v1._authenticate ile aynı devir; audit öneki admin_v1.

    Kapsam doğru olsa bile kind platform_admin değilse veya anahtar bir
    instance'a bağlıysa 403 (plan D).
    """
    key_doc, payload = await platform_auth.authenticate(
        request,
        required_scope=scope,
        audit_prefix="admin_v1",
    )
    if key_doc.get("kind") != store.KEY_KIND_PLATFORM_ADMIN:
        raise HTTPException(status_code=403, detail="Kapsam yetersiz")
    if str(key_doc.get("instance_id") or "").strip():
        raise HTTPException(status_code=403, detail="Kapsam yetersiz")
    return key_doc, payload


def _window(rows: List[Any], limit: int, offset: int) -> Tuple[List[Any], int]:
    total = len(rows)
    if offset >= total:
        return [], total
    return rows[offset:offset + limit], total


@router.get("/platform/admin-v1/companies")
async def admin_v1_companies(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: Optional[str] = Query(None),
):
    await _auth(request, store.SCOPE_ADMIN_COMPANIES_READ)
    rows = await saas._db.companies.find({}).sort("created_at", -1).to_list(5000)
    needle = (q or "").strip().casefold()
    if needle:
        rows = [
            c for c in rows
            if needle in str(c.get("name") or "").casefold()
            or company_numbers.matches_exact(c.get("company_no"), needle)
        ]
    page, total = _window(rows, limit, offset)
    items = [await saas._company_row(c) for c in page]
    return _page(items, limit, offset, total)


@router.get("/platform/admin-v1/companies/{company_id}")
async def admin_v1_company(company_id: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_COMPANIES_READ)
    row = await saas.company_detail(company_id, include_users=False)
    if row is None:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return _item(row)


@router.get("/platform/admin-v1/companies/{company_id}/users")
async def admin_v1_company_users(
    company_id: str,
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    await _auth(request, store.SCOPE_ADMIN_USERS_READ)
    if not await saas._db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    members = await saas.company_staff(company_id)
    page, total = _window(members, limit, offset)
    return _page(page, limit, offset, total)


@router.get("/platform/admin-v1/plans")
async def admin_v1_plans(request: Request):
    await _auth(request, store.SCOPE_ADMIN_LICENSES_READ)
    plans = await saas.list_plans({})
    catalog = await saas.catalog_with_prices()
    return _item({"plans": plans, "catalog": catalog})


@router.get("/platform/admin-v1/api-keys")
async def admin_v1_api_keys(
    request: Request,
    product_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    await _auth(request, store.SCOPE_ADMIN_KEYS_READ)
    pid = (product_id or "").strip() or None
    rows = await store.list_api_keys(product_id=pid)
    page, total = _window(rows, limit, offset)
    return _page(page, limit, offset, total)


@router.get("/platform/admin-v1/integrators")
async def admin_v1_integrators(
    request: Request,
    include_instances: bool = Query(False),
    product_id: Optional[str] = Query(None),
):
    await _auth(request, store.SCOPE_ADMIN_INTEGRATORS_READ)
    item: Dict[str, Any] = {"products": await store.list_products()}
    if include_instances:
        pid = (product_id or "").strip() or None
        item["instances"] = await store.list_instances(product_id=pid)
    return _item(item)


@router.get("/platform/admin-v1/audit")
async def admin_v1_audit(
    request: Request,
    action: Optional[str] = Query(None),
    actor_id: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = Query(None),
):
    await _auth(request, store.SCOPE_ADMIN_AUDIT_READ)
    rows = await store.list_audit(
        action=(action or "").strip() or None,
        actor_id=(actor_id or "").strip() or None,
        target_type=(target_type or "").strip() or None,
        limit=limit + 1,
        before=(before or "").strip() or None,
    )
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].get("at") if has_more and items else None
    return _redact({"items": items, "limit": limit, "next_cursor": next_cursor})


def _mail_server_public(row: dict) -> dict:
    out = platform_mail._public_server(row)
    out.pop("password_enc", None)
    return out


def _mail_box_public(row: dict) -> dict:
    """_public_box aynen kalır; admin-v1 üyelik ve sır alanlarını yanıtta taşımaz."""
    out = platform_mail._public_box(row)
    out.pop("password_enc", None)
    out.pop("allowed_user_ids", None)
    out.pop("allow_all_admins", None)
    return out


@router.get("/platform/admin-v1/mail/status")
async def admin_v1_mail_status(request: Request):
    """Posta özeti. SMTP/IMAP açılmaz, mektup gönderilmez."""
    await _auth(request, store.SCOPE_ADMIN_MAIL_READ)
    db = platform_mail._db if platform_mail._db is not None else saas._db
    servers = [
        _mail_server_public(row)
        for row in await db.platform_mail_servers.find({}).sort("created_at", 1).to_list(100)
    ]
    boxes = [
        _mail_box_public(row)
        for row in await db.platform_mailboxes.find({}).sort("created_at", 1).to_list(200)
    ]
    default_from = next(
        (box["email"] for box in boxes if box.get("is_default") and box.get("is_active", True)),
        None,
    ) or next((box["email"] for box in boxes if box.get("is_active", True)), None)
    return _item({"servers": servers, "mailboxes": boxes, "default_from": default_from})


@router.get("/platform/admin-v1/system/health")
async def admin_v1_system_health(request: Request):
    """Sürüm damgası. Veritabanı sorgusu yok."""
    await _auth(request, store.SCOPE_ADMIN_SYSTEM_READ)
    stamp = read_stamp()
    return _item({
        "status": "healthy",
        "version": stamp.get("version"),
        "git_sha": stamp.get("git_sha"),
    })


def _log_filter(value: Optional[str], field: str, limit: int = 200) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > limit:
        raise HTTPException(status_code=400, detail=f"{field} en çok {limit} karakter olabilir.")
    return text


@router.get("/platform/admin-v1/system/logs")
async def admin_v1_system_logs(
    request: Request,
    category: Optional[str] = Query(None),
    event: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    before_id: Optional[int] = Query(None, ge=1),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100_000),
):
    """Sistem logu. Yeniden eskiye; offset sayfa, before_id daha eski kuyruk.

    applog.query_log_page (/system/logs ile aynı sorgu). Yazma yok.
    """
    await _auth(request, store.SCOPE_ADMIN_SYSTEM_READ)
    page = await asyncio.to_thread(
        applog.query_log_page,
        category=_log_filter(category, "category"),
        event=_log_filter(event, "event"),
        user_email=_log_filter(email, "email"),
        level=_log_filter(level, "level", 32),
        company_id=_log_filter(company_id, "company_id"),
        q=_log_filter(q, "q"),
        before_id=before_id,
        limit=limit,
        offset=offset,
    )
    items = page["items"]
    next_before_id = items[-1].get("id") if len(items) == limit and items[-1].get("id") is not None else None
    return _redact({
        "items": items,
        "limit": limit,
        "offset": offset,
        "total": page["total"],
        "before_id": before_id,
        "next_before_id": next_before_id,
    })


_PAYMENT_FIELDS = (
    "id",
    "provider",
    "company_id",
    "company_name",
    "plan_id",
    "plan_name",
    "period",
    "product_type",
    "pack_id",
    "credits",
    "amount",
    "currency",
    "status",
    "payment_status",
    "applied",
    "applied_at",
    "paid_at",
    "created_at",
    "updated_at",
    "invoice_id",
    "invoice_number",
    "payment_type",
    "failed_reason_code",
    "failed_reason_msg",
    "paytr_error",
)
_UPGRADE_STATUSES = ("pending", "approved", "rejected")


def _payment_public(row: dict) -> dict:
    """Beyaz liste. session_id ve merchant_oid yetki taşır; kart alanları da yok."""
    out = {key: row[key] for key in _PAYMENT_FIELDS if key in row}
    mail = row.get("invoice_mail")
    if isinstance(mail, dict):
        out["invoice_mail_status"] = mail.get("status")
    return out


def _paid_totals(rows: List[dict]) -> Tuple[float, int]:
    """payment_rows ile aynı hesap: yalnızca payment_status=paid."""
    paid = [row for row in rows if row["payment_status"] == "paid"]
    return round(sum(float(row["amount"]) for row in paid), 2), len(paid)


@router.get("/platform/admin-v1/overview")
async def admin_v1_overview(request: Request):
    """Genel bakış. Sayfalama yok; saas.overview_stats (/system/overview ile aynı)."""
    await _auth(request, store.SCOPE_ADMIN_OVERVIEW_READ)
    return _item(await saas.overview_stats())


@router.get("/platform/admin-v1/quotas")
async def admin_v1_quotas(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: Optional[str] = Query(None),
):
    await _auth(request, store.SCOPE_ADMIN_QUOTAS_READ)
    data = await saas.quota_rows()
    rows = data["quotas"]
    needle = (q or "").strip().casefold()
    if needle:
        rows = [row for row in rows if needle in str(row.get("name") or "").casefold()]
    page, total = _window(rows, limit, offset)
    return _redact({
        "items": page,
        "limit": limit,
        "offset": offset,
        "total": total,
        "plans": data["plans"],
    })


@router.get("/platform/admin-v1/upgrade-requests")
async def admin_v1_upgrade_requests(
    request: Request,
    status: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    await _auth(request, store.SCOPE_ADMIN_REQUESTS_READ)
    st = (status or "").strip()
    if st and st not in _UPGRADE_STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    cid = (company_id or "").strip() or None
    rows = await saas.upgrade_request_rows(status=st or None, company_id=cid)
    page, total = _window(rows, limit, offset)
    return _page(page, limit, offset, total)


@router.get("/platform/admin-v1/payments")
async def admin_v1_payments(
    request: Request,
    status: Optional[str] = Query(None),
    payment_status: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Ödeme listesi. Stripe/PayTR çağrılmaz; session_id ve merchant_oid dönmez."""
    await _auth(request, store.SCOPE_ADMIN_PAYMENTS_READ)
    data = await saas_billing.payment_rows()
    rows = data["items"]
    st = (status or "").strip()
    ps = (payment_status or "").strip()
    cid = (company_id or "").strip()
    if st:
        rows = [row for row in rows if row.get("status") == st]
    if ps:
        rows = [row for row in rows if row.get("payment_status") == ps]
    if cid:
        rows = [row for row in rows if str(row.get("company_id") or "") == cid]
    total_paid, paid_count = _paid_totals(rows)
    page, total = _window(rows, limit, offset)
    return _redact({
        "items": [_payment_public(row) for row in page],
        "limit": limit,
        "offset": offset,
        "total": total,
        "total_paid": total_paid,
        "paid_count": paid_count,
    })


@router.get("/platform/admin-v1/platform-users")
async def admin_v1_platform_users(
    request: Request,
    q: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Platform yöneticileri. Numara yazılmaz; companies haritası ve roles dönmez."""
    await _auth(request, store.SCOPE_ADMIN_PLATFORM_USERS_READ)
    data = await saas.platform_user_rows(q, assign_numbers=False)
    page, total = _window(data["users"], limit, offset)
    return _page(page, limit, offset, total)


@router.get("/platform/admin-v1/sms/settings")
async def admin_v1_sms_settings(request: Request):
    """Platform SMS ayar özeti. Sağlayıcıya istek yok, bakiye sorgusu yok."""
    await _auth(request, store.SCOPE_ADMIN_SMS_READ)
    view = platform_sms._public_view(await platform_sms.load_settings())
    body = _item(view)
    # Ortak redact anahtar adındaki "password" yüzünden bu boolean'ı düşürür; sır değildir.
    flag = view.get("password_unreadable")
    if isinstance(flag, bool) and isinstance(body.get("item"), dict):
        body["item"]["password_unreadable"] = flag
    return body


@router.get("/platform/admin-v1/sms/logs")
async def admin_v1_sms_logs(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    context: Optional[str] = Query(None),
):
    """Platform SMS günlüğü. Gönderim yok; özet yalnızca sms_logs sayımıdır."""
    await _auth(request, store.SCOPE_ADMIN_SMS_READ)
    rows = await platform_sms.platform_sms_log_rows(
        limit + 1,
        before=(before or "").strip() or None,
        status=(status or "").strip() or None,
        context=(context or "").strip() or None,
    )
    has_more = len(rows) > limit
    page = rows[:limit]
    items = [platform_sms.sms_log_public(row) for row in page]
    next_cursor = items[-1].get("created_at") if has_more and items else None
    sent_n = await platform_sms._db.sms_logs.count_documents({"source": "platform", "status": "sent"})
    failed_n = await platform_sms._db.sms_logs.count_documents({"source": "platform", "status": "failed"})
    return _redact({
        "items": items,
        "limit": limit,
        "next_cursor": next_cursor,
        "summary": {"sent": sent_n, "failed": failed_n},
    })


@router.get("/platform/admin-v1/sms/failed-resets")
async def admin_v1_failed_resets(
    request: Request,
    limit: int = Query(40, ge=1, le=200),
):
    await _auth(request, store.SCOPE_ADMIN_SMS_READ)
    return _redact(await platform_sms.failed_reset_rows(limit))


@router.get("/platform/admin-v1/companies/{company_id}/sms")
async def admin_v1_company_sms(company_id: str, request: Request):
    """Şirket SMS özeti. Şifre çözülmez, sağlayıcıya istek yok."""
    await _auth(request, store.SCOPE_ADMIN_SMS_READ)
    if not await saas._db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return _item(await company_sms.company_sms_summary(saas._db, company_id))


@router.get("/platform/admin-v1/support/tickets")
async def admin_v1_support_tickets(
    request: Request,
    status: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    await _auth(request, store.SCOPE_ADMIN_SUPPORT_READ)
    st = (status or "").strip()
    if st and st not in support_tickets.STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    cid = (company_id or "").strip() or None
    rows = await support_tickets.admin_ticket_rows(status=st or None, company_id=cid, q=q)
    counts = await support_tickets.ticket_counts()
    open_count = counts["open"] + counts["in_progress"] + counts["waiting_customer"]
    page, total = _window(rows, limit, offset)
    items = [
        support_tickets.public_ticket(row, staff=True, include_messages=False)
        for row in page
    ]
    return _redact({
        "items": items,
        "limit": limit,
        "offset": offset,
        "total": total,
        "counts": counts,
        "open_count": open_count,
        **support_tickets.meta(),
    })


def _mask_address(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "@" in text:
        return password_reset.mask_email(text)
    return password_reset.mask_phone(text)


def _mask_mail_log(payload: dict) -> dict:
    sent = []
    for row in payload.get("sent") or []:
        item = dict(row)
        masked = [_mask_address(addr) for addr in (item.get("to") or [])]
        item["to"] = masked
        item["recipients"] = ", ".join(part for part in masked if part)
        sent.append(item)
    deferred = []
    for row in payload.get("deferred") or []:
        item = dict(row)
        raw = str(item.get("recipients") or "")
        parts = [part.strip() for part in raw.split(",") if part.strip()]
        item["recipients"] = ", ".join(_mask_address(part) for part in parts)
        deferred.append(item)
    return {"sent": sent, "deferred": deferred}


@router.get("/platform/admin-v1/companies/{company_id}/notify-prefs")
async def admin_v1_notify_prefs_read(company_id: str, request: Request):
    """Bildirim tercihleri. Yazmaz. extra_emails düzenleme için açık döner."""
    await _auth(request, store.SCOPE_ADMIN_NOTIFICATIONS_READ)
    await event_notify._require_existing_company(company_id)
    prefs = await event_notify.present_prefs(
        await event_notify.get_prefs(company_id), with_usage=True,
    )
    return _item(prefs)


@router.get("/platform/admin-v1/companies/{company_id}/notify-mail-log")
async def admin_v1_notify_mail_log(
    company_id: str,
    request: Request,
    limit: int = Query(50, ge=1, le=200),
):
    """Posta günlüğü. Alıcılar maskelenir. Idempotency-Key yok."""
    await _auth(request, store.SCOPE_ADMIN_NOTIFICATIONS_READ)
    log = await event_notify.company_notify_mail_log(company_id, limit)
    return _redact(_mask_mail_log(log))


@router.get("/platform/admin-v1/support/tickets/{ticket_id}")
async def admin_v1_support_ticket(ticket_id: str, request: Request):
    """Talep okuma. Okundu, atama ve durum alanları yazılmaz."""
    await _auth(request, store.SCOPE_ADMIN_SUPPORT_READ)
    doc = await support_tickets._db.support_tickets.find_one({"_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Destek talebi bulunamadı.")
    return _redact(support_tickets.public_ticket(doc, staff=True))
