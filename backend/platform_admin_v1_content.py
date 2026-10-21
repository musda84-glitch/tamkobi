"""admin-v1: CMS, yardım, bakım, duyuru, XSLT, kontör, veritabanı özeti, destek eki.

Bakım açma ve eşik üstü kontör danger akışındadır. Veritabanı ucu salt okunurdur.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

import db_relocate
import einvoice_designs
import gib_credits
import help_center
import platform_notices
import platform_store as store
import public_sites
import saas
import storage_service
import support_tickets
from platform_admin_v1 import _auth, _item, _redact
from platform_admin_v1_write import (
    _present,
    _reject_unknown,
    _require_bool,
    _write,
    audit_field_names,
)

router = APIRouter(prefix="/api", tags=["platform-admin-v1-content"])

_HELP_FIELDS = (
    "title", "slug", "summary", "body_md", "transcript", "content_type", "video_url",
    "video_duration_sec", "product_tags", "page_keys", "category", "tags", "locale",
    "status", "featured", "sort", "assistant",
)
_SITE_FIELDS = ("brand_name", "public_url", "active", "theme")
_MAINT_FIELDS = (
    "enabled", "notify_popup", "notify_sms", "title", "body", "starts_at", "ends_at",
    "support_email", "support_phone", "audience", "company_ids",
)
_ANNOUNCE_FIELDS = (
    "title", "body", "active", "status", "kind", "starts_at", "ends_at",
    "audience", "company_ids", "notify_sms",
)
_DESIGN_FIELDS = ("name", "kind", "xslt", "layout", "company_id", "copy_from_id", "source")


def _operator_from_payload(payload: Dict[str, Any]) -> dict:
    email = payload.get("operator_email")
    return {"email": email if isinstance(email, str) else "api", "_id": "api"}


@router.get("/platform/admin-v1/maintenance")
async def admin_v1_maintenance_read(request: Request):
    await _auth(request, store.SCOPE_ADMIN_MAINTENANCE_READ)
    current = await platform_notices.get_maintenance()
    now = platform_notices._now()
    return _redact({
        **current,
        "active": platform_notices.maintenance_active(current, now=now),
        "upcoming": platform_notices.maintenance_upcoming(current, now=now),
        "server_time": now.isoformat(),
    })


@router.put("/platform/admin-v1/maintenance")
async def admin_v1_maintenance_save(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _MAINT_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        for flag in ("enabled", "notify_popup", "notify_sms"):
            if flag in payload and not isinstance(payload[flag], bool):
                raise HTTPException(status_code=400, detail=f"{flag} boolean olmalı.")
        current = await platform_notices.get_maintenance()
        if payload.get("enabled") is True and not current.get("enabled"):
            raise HTTPException(status_code=400, detail="Bakım modunu açmak için danger akışını kullanın.")
        return _present(payload, _MAINT_FIELDS)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        admin = {"email": str(key_doc.get("_id") or ""), "_id": key_doc.get("_id")}
        row = await platform_notices.system_put_maintenance(payload, admin)
        return _item(row)

    return await _write(
        request, store.SCOPE_ADMIN_MAINTENANCE_WRITE, "maintenance", "platform",
        apply, op="maintenance.save", prepare=prepare,
    )


@router.get("/platform/admin-v1/announcements")
async def admin_v1_announcements(request: Request):
    await _auth(request, store.SCOPE_ADMIN_MAINTENANCE_READ)
    return _redact(await platform_notices.system_list_announcements({}))


@router.post("/platform/admin-v1/announcements")
async def admin_v1_announcement_create(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _ANNOUNCE_FIELDS + ("operator_email",))
        if not isinstance(payload.get("title"), str) or not payload["title"].strip():
            raise HTTPException(status_code=400, detail="Başlık zorunlu.")
        if not isinstance(payload.get("body"), str) or not payload["body"].strip():
            raise HTTPException(status_code=400, detail="Metin zorunlu.")
        return audit_field_names(_present(payload, _ANNOUNCE_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        body = {k: v for k, v in payload.items() if k != "operator_email"}
        row = await platform_notices.system_create_announcement(body, _operator_from_payload(payload))
        return _item(row), audit_field_names(_present(payload, _ANNOUNCE_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_MAINTENANCE_WRITE, "announcement", "new",
        apply, op="announcement.create", prepare=prepare,
    )


@router.put("/platform/admin-v1/announcements/{announce_id}")
async def admin_v1_announcement_update(announce_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _ANNOUNCE_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if not await platform_notices._db.platform_announcements.find_one({"_id": announce_id}):
            raise HTTPException(status_code=404, detail="Duyuru bulunamadı.")
        return _present(payload, _ANNOUNCE_FIELDS)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await platform_notices.system_update_announcement(announce_id, payload, {}))

    return await _write(
        request, store.SCOPE_ADMIN_MAINTENANCE_WRITE, "announcement", announce_id,
        apply, op="announcement.update", prepare=prepare,
    )


@router.post("/platform/admin-v1/announcements/{announce_id}/delete")
async def admin_v1_announcement_delete(announce_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        if not await platform_notices._db.platform_announcements.find_one({"_id": announce_id}):
            raise HTTPException(status_code=404, detail="Duyuru bulunamadı.")
        return ["delete"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await platform_notices.system_delete_announcement(announce_id, {}))

    return await _write(
        request, store.SCOPE_ADMIN_MAINTENANCE_WRITE, "announcement", announce_id,
        apply, op="announcement.delete", prepare=prepare,
    )


@router.get("/platform/admin-v1/sites")
async def admin_v1_sites(request: Request):
    await _auth(request, store.SCOPE_ADMIN_CMS_READ)
    return _redact(await public_sites.list_sites({}))


@router.get("/platform/admin-v1/sites/{slug}")
async def admin_v1_site(slug: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_CMS_READ)
    return _redact(await public_sites.get_site(slug, {}))


@router.put("/platform/admin-v1/sites/{slug}")
async def admin_v1_site_save(slug: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _SITE_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if "active" in payload:
            _require_bool(payload, "active")
        await public_sites._require_site(slug)
        return _present(payload, _SITE_FIELDS)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await public_sites.update_site(slug, payload, {}))

    return await _write(
        request, store.SCOPE_ADMIN_CMS_WRITE, "site", slug, apply, op="site.update", prepare=prepare,
    )


@router.put("/platform/admin-v1/sites/{slug}/content")
async def admin_v1_site_content(slug: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        if not isinstance(payload, dict) or not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        await public_sites._require_site(slug)
        return ["content"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await public_sites.update_content(slug, payload, {}))

    return await _write(
        request, store.SCOPE_ADMIN_CMS_WRITE, "site", slug, apply, op="site.content", prepare=prepare,
    )


@router.get("/platform/admin-v1/sites/{slug}/inquiries")
async def admin_v1_site_inquiries(slug: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_CMS_READ)
    return _redact(await public_sites.list_inquiries(slug, {}))


@router.get("/platform/admin-v1/help/articles")
async def admin_v1_help_list(request: Request):
    await _auth(request, store.SCOPE_ADMIN_CMS_READ)
    return _redact(await help_center.system_help_list(q="", product="", status="", content_type="", _={}))


@router.post("/platform/admin-v1/help/articles")
async def admin_v1_help_create(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _HELP_FIELDS + ("operator_email",))
        if not isinstance(payload.get("title"), str) or not payload["title"].strip():
            raise HTTPException(status_code=400, detail="Başlık gerekli.")
        return audit_field_names(_present(payload, _HELP_FIELDS))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        body = {k: v for k, v in payload.items() if k != "operator_email"}
        row = await help_center.system_help_create(body, _operator_from_payload(payload))
        return _item(row), audit_field_names(_present(payload, _HELP_FIELDS))

    return await _write(
        request, store.SCOPE_ADMIN_CMS_WRITE, "help_article", "new",
        apply, op="help.create", prepare=prepare,
    )


@router.put("/platform/admin-v1/help/articles/{article_id}")
async def admin_v1_help_update(article_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _HELP_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        return _present(payload, _HELP_FIELDS)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await help_center.system_help_update(article_id, payload, {}))

    return await _write(
        request, store.SCOPE_ADMIN_CMS_WRITE, "help_article", article_id,
        apply, op="help.update", prepare=prepare,
    )


@router.post("/platform/admin-v1/help/articles/{article_id}/delete")
async def admin_v1_help_delete(article_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        return ["delete"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await help_center.system_help_delete(article_id, {}))

    return await _write(
        request, store.SCOPE_ADMIN_CMS_WRITE, "help_article", article_id,
        apply, op="help.delete", prepare=prepare,
    )


@router.get("/platform/admin-v1/einvoice-designs")
async def admin_v1_designs(request: Request, company_id: Optional[str] = None):
    await _auth(request, store.SCOPE_ADMIN_EINVOICE_READ)
    await einvoice_designs.ensure_defaults()
    return _redact({"items": await einvoice_designs._list(company_id)})


@router.post("/platform/admin-v1/einvoice-designs")
async def admin_v1_design_create(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _DESIGN_FIELDS)
        if not isinstance(payload.get("name"), str) or not payload["name"].strip():
            raise HTTPException(status_code=400, detail="Tasarım adı boş olamaz.")
        return _present(payload, _DESIGN_FIELDS)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        cid = str(payload.get("company_id") or "").strip() or None
        row = await einvoice_designs._create_design_impl(payload, company_id=cid)
        return _item(row)

    return await _write(
        request, store.SCOPE_ADMIN_EINVOICE_WRITE, "einvoice_design", "new",
        apply, op="einvoice_design.create", prepare=prepare,
    )


@router.put("/platform/admin-v1/einvoice-designs/{design_id}")
async def admin_v1_design_update(design_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _DESIGN_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        return _present(payload, _DESIGN_FIELDS)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        cid = str(payload.get("company_id") or "").strip() or None
        if cid:
            row = await einvoice_designs._update_scoped(design_id, payload, cid)
        else:
            row = await einvoice_designs._update_design_impl(design_id, payload)
        return _item(row)

    return await _write(
        request, store.SCOPE_ADMIN_EINVOICE_WRITE, "einvoice_design", design_id,
        apply, op="einvoice_design.update", prepare=prepare,
    )


@router.post("/platform/admin-v1/einvoice-designs/{design_id}/select")
async def admin_v1_design_select(design_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("company_id",))
        if "company_id" in payload and payload["company_id"] is not None and not isinstance(payload["company_id"], str):
            raise HTTPException(status_code=400, detail="company_id metin olmalı.")
        return ["select"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        cid = str(payload.get("company_id") or "").strip() or None
        return _item(await einvoice_designs._select_scoped(design_id, cid))

    return await _write(
        request, store.SCOPE_ADMIN_EINVOICE_WRITE, "einvoice_design", design_id,
        apply, op="einvoice_design.select", prepare=prepare,
    )


@router.post("/platform/admin-v1/einvoice-designs/{design_id}/delete")
async def admin_v1_design_delete(design_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("company_id",))
        return ["delete"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        cid = str(payload.get("company_id") or "").strip() or None
        return _item(await einvoice_designs._delete_scoped(design_id, cid))

    return await _write(
        request, store.SCOPE_ADMIN_EINVOICE_WRITE, "einvoice_design", design_id,
        apply, op="einvoice_design.delete", prepare=prepare,
    )


@router.get("/platform/admin-v1/einvoice-designs/settings/embed")
async def admin_v1_design_embed_read(request: Request):
    await _auth(request, store.SCOPE_ADMIN_EINVOICE_READ)
    return _redact({"xslt_embed": await einvoice_designs.get_xslt_embed_mode()})


@router.put("/platform/admin-v1/einvoice-designs/settings/embed")
async def admin_v1_design_embed_save(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("xslt_embed",))
        if not isinstance(payload.get("xslt_embed"), str) or not payload["xslt_embed"].strip():
            raise HTTPException(status_code=400, detail="xslt_embed zorunlu.")
        return ["xslt_embed"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        mode = await einvoice_designs.set_xslt_embed_mode(payload["xslt_embed"])
        return _item({"xslt_embed": mode})

    return await _write(
        request, store.SCOPE_ADMIN_EINVOICE_WRITE, "platform", "xslt_embed",
        apply, op="einvoice_design.embed", prepare=prepare,
    )


@router.post("/platform/admin-v1/companies/{company_id}/gib-credits/gift")
async def admin_v1_gib_gift(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("credits", "note"))
        credits = payload.get("credits")
        if isinstance(credits, bool) or not isinstance(credits, int) or credits <= 0:
            raise HTTPException(status_code=400, detail="credits pozitif bir tamsayı olmalı.")
        if credits > gib_credits.GIFT_DIRECT_MAX:
            raise HTTPException(status_code=400, detail="Bu tutar danger akışı gerektirir.")
        if "note" in payload and not isinstance(payload["note"], str):
            raise HTTPException(status_code=400, detail="note metin olmalı.")
        if not await saas._db.companies.find_one({"_id": company_id}):
            raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
        return ["credits"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        note = str(payload.get("note") or "Platform yüklemesi")[:200]
        balance = await gib_credits.gift(company_id, int(payload["credits"]), note)
        return _item({"company_id": company_id, "credits": int(payload["credits"]), "balance": balance})

    return await _write(
        request, store.SCOPE_ADMIN_LICENSES_WRITE, "company", company_id,
        apply, op="gib.gift", prepare=prepare,
    )


@router.get("/platform/admin-v1/database")
async def admin_v1_database(request: Request):
    """Salt okunur. Bilinen tablo satır sayıları. Parola ve serbest SQL yok."""
    await _auth(request, store.SCOPE_ADMIN_DB_READ)
    current = db_relocate.current_settings()
    view = db_relocate.public_view(current)
    try:
        tables = await asyncio.to_thread(db_relocate.whitelisted_table_counts, current)
        reachable = True
    except Exception:
        tables, reachable = {}, False
    allowed = {name: int(tables.get(name) or 0) for name in db_relocate.KNOWN_TABLES} if reachable else {}
    return _redact({
        "configured": bool(current.get("host") and current.get("db")),
        "reachable": reachable,
        "host": view.get("host") or "",
        "port": view.get("port"),
        "db": view.get("db") or "",
        "ssl_mode": view.get("ssl_mode") or "",
        "has_password": bool(current.get("password")),
        "tables": allowed,
        "documents": int(allowed.get("docs") or 0),
    })


def _attachment_at(ticket: dict, message_id: str, index: int) -> dict:
    messages = ticket.get("messages") or []
    message = next((m for m in messages if str(m.get("id") or m.get("_id") or "") == message_id), None)
    if message is None and message_id.isdigit():
        pos = int(message_id)
        if 0 <= pos < len(messages):
            message = messages[pos]
    if not message:
        raise HTTPException(status_code=404, detail="İleti bulunamadı.")
    attachments = message.get("attachments") or []
    if index < 0 or index >= len(attachments):
        raise HTTPException(status_code=404, detail="Ek bulunamadı.")
    item = attachments[index]
    if not isinstance(item, dict):
        raise HTTPException(status_code=404, detail="Ek bulunamadı.")
    return item


@router.get("/platform/admin-v1/support/tickets/{ticket_id}/attachments/{message_id}/{index}")
async def admin_v1_support_attachment(ticket_id: str, message_id: str, index: int, request: Request):
    await _auth(request, store.SCOPE_ADMIN_SUPPORT_READ)
    ticket = await support_tickets._db.support_tickets.find_one({"_id": ticket_id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Destek talebi bulunamadı.")
    item = _attachment_at(ticket, message_id, index)
    url = str(item.get("url") or "")
    if not url.startswith("/api/files/"):
        raise HTTPException(status_code=404, detail="Ek bulunamadı.")
    path = url.split("?", 1)[0][len("/api/files/"):]
    try:
        data, content_type = storage_service.get_object(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Ek dosyası bulunamadı.") from None
    filename = str(item.get("filename") or "ek")[:180]
    media = content_type or item.get("content_type") or "application/octet-stream"
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
