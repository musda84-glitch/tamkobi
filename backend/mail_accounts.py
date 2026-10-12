"""Firma e-posta (IMAP/SMTP) hesap API — tenant izolasyonlu /api/comm/mail/*."""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

import comm_service
import mail_tracking
import tenant_access
from models import MailAccount, MailLog

logger = logging.getLogger("TamKobiERP")

router = APIRouter(prefix="/api", tags=["comm-mail"])
_db = None
_current_user: Optional[Callable[..., Awaitable[dict]]] = None
_public_base_url: Optional[Callable[..., Awaitable[str]]] = None

NEEDS_REAUTH_MSG = "Kayıtlı şifre çözülemedi — lütfen yeniden girin."
MAIL_LOGS_LIMIT_MAX = 500


def init(db, get_current_user=None, public_base_url_fn=None):
    global _db, _current_user, _public_base_url
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user
    if public_base_url_fn is not None:
        _public_base_url = public_base_url_fn


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Mail auth bağlanmadı.")
    return await _current_user(request)


def _err_text(e: Exception) -> str:
    args = getattr(e, "args", None)
    raw = args[0] if args else str(e)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    return str(raw)[:160]


def _mail_error(e: Exception) -> HTTPException:
    return HTTPException(status_code=424, detail=f"Posta sunucusu hatası: {_err_text(e)}")


def _clean_doc(doc: dict) -> dict:
    d = dict(doc or {})
    if "_id" in d and "id" not in d:
        d["id"] = d.pop("_id")
    elif "_id" in d:
        d["id"] = d.get("id") or d.pop("_id")
        d.pop("_id", None)
    return d


def mask_mail_account(a: dict) -> dict:
    """Şifre / password_enc asla istemciye dönmez."""
    a = _clean_doc(dict(a))
    a.pop("password", None)
    a["has_password"] = bool(a.pop("password_enc", ""))
    a.pop("smtp_password_enc", None)
    a.pop("oauth_refresh_enc", None)
    return a


async def mark_needs_reauth(account_id: str, detail: str = NEEDS_REAUTH_MSG) -> None:
    try:
        await _db.mail_accounts.update_one(
            {"_id": account_id},
            {"$set": {"status": "needs_reauth", "last_error": detail[:200]}},
        )
    except Exception:
        pass


async def load_mail_account(company_id: str, *, with_password: bool = True) -> dict:
    """Şirketin mail hesabını yükle; decrypt hatasında status=needs_reauth + 409."""
    cid = str(company_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket seçilmedi.")
    a = await _db.mail_accounts.find_one({"company_id": cid})
    if not a:
        raise HTTPException(status_code=404, detail="E-posta hesabı tanımlı değil. Önce hesabınızı bağlayın.")
    if with_password:
        try:
            a["password"] = comm_service.decrypt(a.get("password_enc") or "")
        except Exception:
            await mark_needs_reauth(a["_id"])
            raise HTTPException(status_code=409, detail=NEEDS_REAUTH_MSG)
    return a


def resolve_mail_company(user: dict, requested: Optional[str]) -> str:
    return tenant_access.resolve_company_id(user, requested)


@router.get("/comm/mail/presets")
async def mail_presets():
    return [{"code": k, **v} for k, v in comm_service.MAIL_PRESETS.items()]


@router.get("/comm/mail/account")
async def get_mail_account(
    request: Request,
    company_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = resolve_mail_company(user, company_id or request.query_params.get("company_id"))
    a = await _db.mail_accounts.find_one({"company_id": cid})
    return mask_mail_account(a) if a else None


@router.put("/comm/mail/account")
async def save_mail_account(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = resolve_mail_company(user, req.get("company_id"))
    await tenant_access.require_company_admin(user, cid)
    preset = comm_service.MAIL_PRESETS.get(req.get("provider", "custom"), comm_service.MAIL_PRESETS["custom"])
    existing = await _db.mail_accounts.find_one({"company_id": cid})
    if not req.get("password") and not existing:
        raise HTTPException(status_code=400, detail="Uygulama şifresi gerekli.")
    data = {
        "company_id": cid,
        "user_id": user.get("id") or user.get("_id"),
        "email": (req.get("email") or "").strip(),
        "display_name": req.get("display_name") or "",
        "provider": req.get("provider", "custom"),
        "imap_host": req.get("imap_host") or preset["imap_host"],
        "imap_port": int(req.get("imap_port") or preset["imap_port"]),
        "smtp_host": req.get("smtp_host") or preset["smtp_host"],
        "smtp_port": int(req.get("smtp_port") or preset["smtp_port"]),
        "signature": req.get("signature") or "",
    }
    if not data["email"] or not data["imap_host"] or not data["smtp_host"]:
        raise HTTPException(status_code=400, detail="E-posta, IMAP ve SMTP sunucu bilgileri zorunludur.")
    if req.get("password"):
        data["password_enc"] = comm_service.encrypt(req["password"])
        data["status"] = "unverified"
        data["last_error"] = None
    if existing:
        await _db.mail_accounts.update_one({"_id": existing["_id"]}, {"$set": data})
    else:
        acc = MailAccount(**data)
        await _db.mail_accounts.insert_one(acc.to_mongo())
    a = await load_mail_account(cid)
    try:
        await comm_service.run_blocking(comm_service.imap_test, a)
        await comm_service.smtp_login_test(a)
        await _db.mail_accounts.update_one({"_id": a["_id"]}, {"$set": {"status": "connected", "last_error": None}})
        test = {"ok": True, "message": "IMAP ve SMTP bağlantısı doğrulandı."}
    except Exception as e:
        err = f"Posta bağlantı hatası: {_err_text(e)}"
        await _db.mail_accounts.update_one({"_id": a["_id"]}, {"$set": {"status": "error", "last_error": err}})
        test = {"ok": False, "message": err}
    saved = await _db.mail_accounts.find_one({"_id": a["_id"]})
    out = mask_mail_account(saved)
    assert "password" not in out and "password_enc" not in out
    return {**out, "test_result": test}


@router.delete("/comm/mail/account")
async def delete_mail_account(
    request: Request,
    company_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = resolve_mail_company(user, company_id or request.query_params.get("company_id"))
    await tenant_access.require_company_admin(user, cid)
    await _db.mail_accounts.delete_one({"company_id": cid})
    return {"status": "success"}


@router.post("/comm/mail/account/test")
async def test_mail_account(
    request: Request,
    company_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    body = {}
    try:
        if (request.headers.get("content-type") or "").startswith("application/json"):
            body = await request.json()
    except Exception:
        body = {}
    cid = resolve_mail_company(user, company_id or body.get("company_id") or request.query_params.get("company_id"))
    a = await load_mail_account(cid)
    try:
        res = await comm_service.run_blocking(comm_service.imap_test, a)
        await _db.mail_accounts.update_one({"_id": a["_id"]}, {"$set": {"status": "connected", "last_error": None}})
        return {"ok": True, "message": f"Bağlantı başarılı. {res.get('folders', 0)} klasör bulundu."}
    except Exception as e:
        err = f"IMAP bağlantı hatası: {_err_text(e)}"
        await _db.mail_accounts.update_one({"_id": a["_id"]}, {"$set": {"status": "error", "last_error": err}})
        return {"ok": False, "message": err}


@router.get("/comm/mail/folders")
async def mail_folders(
    request: Request,
    company_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = resolve_mail_company(user, company_id or request.query_params.get("company_id"))
    a = await load_mail_account(cid)
    try:
        return await comm_service.run_blocking(comm_service.imap_folders, a)
    except Exception as e:
        raise _mail_error(e)


@router.get("/comm/mail/messages")
async def mail_messages(
    request: Request,
    company_id: Optional[str] = None,
    folder: str = "INBOX",
    limit: int = 30,
    unread_only: bool = False,
    user: dict = Depends(_user_dep),
):
    cid = resolve_mail_company(user, company_id or request.query_params.get("company_id"))
    a = await load_mail_account(cid)
    try:
        return await comm_service.run_blocking(
            comm_service.imap_list, a, folder, min(max(limit, 1), 100), unread_only
        )
    except Exception as e:
        raise _mail_error(e)


@router.get("/comm/mail/messages/{uid}")
async def mail_message(
    uid: str,
    request: Request,
    company_id: Optional[str] = None,
    folder: str = "INBOX",
    user: dict = Depends(_user_dep),
):
    cid = resolve_mail_company(user, company_id or request.query_params.get("company_id"))
    a = await load_mail_account(cid)
    try:
        return await comm_service.run_blocking(comm_service.imap_fetch, a, folder, uid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Mesaj bulunamadı.")
    except Exception as e:
        raise _mail_error(e)


@router.post("/comm/mail/messages/{uid}/flag")
async def mail_flag(uid: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = resolve_mail_company(user, req.get("company_id"))
    a = await load_mail_account(cid)
    flag_map = {"read": "\\Seen", "flagged": "\\Flagged", "deleted": "\\Deleted"}
    flag = flag_map.get(req.get("flag", "read"))
    if not flag:
        raise HTTPException(status_code=400, detail="Geçersiz bayrak.")
    try:
        await comm_service.run_blocking(
            comm_service.imap_set_flag, a, req.get("folder", "INBOX"), uid, flag, bool(req.get("add", True))
        )
        return {"status": "success"}
    except Exception as e:
        raise _mail_error(e)


async def send_tracked_mail(
    *,
    company_id: str,
    to: List[str],
    subject: str,
    body: str,
    html: Optional[str] = None,
    account: Optional[dict] = None,
    contact_id: Optional[str] = None,
    contact_name: Optional[str] = None,
    context: str = "manual",
    ref_id: Optional[str] = None,
    base_url: str = "",
    cc: Optional[List[str]] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> dict:
    a = account or await load_mail_account(company_id)
    log = MailLog(
        company_id=company_id,
        from_email=a["email"],
        to=list(to),
        cc=list(cc or []),
        subject=subject or "",
        body=body or "",
        attachments=[x.get("filename") for x in (attachments or []) if x.get("filename")],
        contact_id=contact_id or None,
        contact_name=contact_name or None,
        context=context or "manual",
        ref_id=ref_id or None,
        open_count=0,
    )
    doc = log.to_mongo()
    html_body = mail_tracking.append_pixel(html or mail_tracking.text_to_html(body or ""), base_url, doc["_id"])
    try:
        await comm_service.smtp_send(a, list(to), subject or "", body or "", html=html_body, cc=cc or None, attachments=attachments)
    except Exception as e:
        doc["status"] = "failed"
        doc["error"] = f"SMTP hatası: {_err_text(e)}"
        await _db.mail_logs.insert_one(doc)
        raise HTTPException(status_code=424, detail=doc["error"])
    await _db.mail_logs.insert_one(doc)
    return doc


@router.post("/comm/mail/send")
async def mail_send(
    request: Request,
    company_id: Optional[str] = Form(None),
    to: str = Form(...),
    cc: str = Form(""),
    subject: str = Form(""),
    body: str = Form(""),
    context: str = Form("manual"),
    ref_id: str = Form(""),
    contact_id: str = Form(""),
    contact_name: str = Form(""),
    files: List[UploadFile] = File(default=[]),
    user: dict = Depends(_user_dep),
):
    cid = resolve_mail_company(user, company_id)
    a = await load_mail_account(cid)
    to_list = [x.strip() for x in to.split(",") if x.strip()]
    cc_list = [x.strip() for x in cc.split(",") if x.strip()]
    if not to_list:
        raise HTTPException(status_code=400, detail="Alıcı e-posta adresi gerekli.")
    attachments, total = [], 0
    for f in files:
        data = await f.read()
        total += len(data)
        if total > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Ekler toplam 25 MB'ı aşamaz.")
        attachments.append({"filename": f.filename, "content_type": f.content_type, "data": data})
    full_body = body + (f"\n\n--\n{a.get('signature')}" if a.get("signature") else "")
    base = ""
    if _public_base_url:
        try:
            base = await _public_base_url(request)
        except Exception:
            base = ""
    try:
        await send_tracked_mail(
            company_id=cid,
            to=to_list,
            subject=subject,
            body=full_body,
            account=a,
            contact_id=contact_id or None,
            contact_name=contact_name or None,
            context=context or "manual",
            ref_id=ref_id or None,
            base_url=base,
            cc=cc_list,
            attachments=attachments,
        )
    except HTTPException:
        raise
    return {"status": "success", "message": f"E-posta {', '.join(to_list)} adresine gönderildi."}


@router.get("/comm/mail/logs")
async def mail_logs(
    request: Request,
    company_id: Optional[str] = None,
    limit: int = 200,
    user: dict = Depends(_user_dep),
):
    cid = resolve_mail_company(user, company_id or request.query_params.get("company_id"))
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        lim = 200
    lim = min(max(lim, 1), MAIL_LOGS_LIMIT_MAX)
    logs = await _db.mail_logs.find({"company_id": cid}).sort("created_at", -1).to_list(lim)
    return [_clean_doc(x) for x in logs]
