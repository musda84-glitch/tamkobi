"""Platform SMS: Netgsm / İleti Merkezi / Verimor — şifre sıfırlama ve sistem bilgilendirmeleri."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

import saas
import comm_service
from safe_error import (
    looks_like_raw_body,
    mask_sensitive_text,
    public_provider_detail,
    provider_error_code,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["platform-sms"])
_db = None
SETTINGS_ID = "platform_sms"


def init(db):
    global _db
    _db = db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public_view(doc: Optional[dict]) -> dict:
    d = dict(doc or {})
    d.pop("password_enc", None)
    d.pop("_id", None)
    has_password = bool((doc or {}).get("password_enc"))
    password_unreadable = False
    if has_password:
        try:
            comm_service.decrypt((doc or {}).get("password_enc") or "")
        except Exception:
            password_unreadable = True
            has_password = False
    return {
        "provider": comm_service.normalize_sms_provider(d.get("provider")),
        "usercode": d.get("usercode") or "",
        "msgheader": d.get("msgheader") or "",
        "is_active": bool(d.get("is_active", False)),
        "verified": bool(d.get("verified", False)),
        "verified_at": d.get("verified_at"),
        "verify_message": d.get("verify_message") or "",
        "last_test_at": d.get("last_test_at"),
        "has_password": has_password,
        "password_unreadable": password_unreadable,
        "updated_at": d.get("updated_at"),
        "providers": comm_service.list_sms_providers(),
        "purposes": {
            "forgot_password": "Panel / ERP şifre sıfırlama SMS'i",
            "announcements": "Güncelleme & duyuru bilgilendirme SMS'i",
        },
    }


async def load_settings() -> dict:
    return await _db.platform_settings.find_one({"_id": SETTINGS_ID}) or {}


async def resolve_platform_sms_creds() -> Optional[dict]:
    """Aktif ve şifresi okunabilir platform SMS hesabı; yoksa None."""
    s = await load_settings()
    if not s or not s.get("is_active"):
        return None
    if not s.get("usercode") or not s.get("password_enc"):
        return None
    try:
        password = comm_service.decrypt(s.get("password_enc") or "")
    except Exception:
        return None
    if not password:
        return None
    return {
        "provider": comm_service.normalize_sms_provider(s.get("provider")),
        "usercode": s.get("usercode") or "",
        "password": password,
        "msgheader": s.get("msgheader") or "",
    }


async def send_platform_sms(
    *,
    phone: str,
    message: str,
    context: str = "platform",
    ref_id: Optional[str] = None,
    company_id: Optional[str] = None,
    contact_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Send via platform SMS provider. Provider responses never raise — always return a result dict.

    Returns: {ok, provider, job_id, code, detail, status, phone}
    Config / validation errors still raise HTTPException (400).
    """
    creds = await resolve_platform_sms_creds()
    if not creds:
        raise HTTPException(status_code=400, detail="Platform SMS henüz yapılandırılmadı veya pasif.")
    no = comm_service.normalize_phone(phone)
    if not no:
        raise HTTPException(status_code=400, detail="Geçerli telefon numarası yok.")
    msg = (message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="SMS metni boş.")
    try:
        res = await comm_service.sms_send(creds, [{"no": no, "msg": msg}])
    except Exception as e:
        raw_err = comm_service.sms_detail_text(getattr(e, "detail", None) or e, limit=500)
        logger.warning("platform sms send failed: %s", mask_sensitive_text(raw_err or str(e))[:2000])
        code = provider_error_code(getattr(e, "detail", None) or e)
        public = public_provider_detail("SMS gönderilemedi.", raw_err, code=code)
        res = {
            "ok": False,
            "jobid": None,
            "code": code,
            "error": public,
            "message": public,
            "raw": None,
        }
    if not isinstance(res, dict):
        res = {"ok": False, "error": "Geçersiz sağlayıcı cevabı", "raw": res}
    ok = bool(res.get("ok"))
    raw_for_log = comm_service.sms_detail_text(
        res.get("error") or res.get("message") or res.get("description") or res.get("raw") or ("" if ok else "SMS gönderilemedi."),
        limit=500,
    )
    code = str(res.get("code") or "") or provider_error_code(res.get("raw") or res.get("error") or res)
    if ok:
        detail = comm_service.sms_detail_text(res.get("message") or "OK", limit=300)
    else:
        logger.warning("platform sms provider error: %s", mask_sensitive_text(raw_for_log)[:2000])
        mapped = res.get("error") if isinstance(res.get("error"), str) else ""
        if looks_like_raw_body(mapped) or mapped.startswith("slice("):
            mapped = ""
        mapped = mask_sensitive_text(mapped) if mapped else ""
        if any(tag in mapped for tag in ("[url]", "[token]", "[user]")):
            mapped = ""
        detail = public_provider_detail(mapped or "SMS gönderilemedi.", raw_for_log, code=code)
    job_id = res.get("jobid")
    if job_id is not None and not isinstance(job_id, str):
        job_id = str(job_id)
    log = {
        "_id": f"sms_{uuid.uuid4().hex[:12]}",
        "company_id": company_id or "platform",
        "phone": no,
        "message": msg[:500],
        "context": context,
        "ref_id": ref_id,
        "contact_name": contact_name or "",
        "provider": creds.get("provider"),
        "status": "sent" if ok else "failed",
        "detail": detail,
        "code": code,
        "job_id": job_id,
        "source": "platform",
        "created_at": _now_iso(),
    }
    try:
        await _db.sms_logs.insert_one(log)
    except Exception:
        logger.exception("platform sms_logs insert failed")
    return {
        "ok": ok,
        "provider": creds.get("provider"),
        "job_id": job_id,
        "code": code,
        "detail": detail,
        "status": "sent" if ok else "failed",
        "phone": no,
    }


async def collect_admin_phones(company_ids: Optional[List[str]] = None, limit: int = 500) -> List[Dict[str, str]]:
    """Hedef şirket admin telefonları (tekrarlar elenir)."""
    q: Dict[str, Any] = {"role": "admin", "is_super_admin": {"$ne": True}, "is_active": {"$ne": False}}
    if company_ids:
        q["company_ids"] = {"$in": list(company_ids)}
    rows = await _db.users.find(q).to_list(limit)
    out: List[Dict[str, str]] = []
    seen = set()
    for u in rows:
        phone = comm_service.normalize_phone(u.get("phone") or "")
        if not phone or phone in seen:
            continue
        seen.add(phone)
        cids = u.get("company_ids") or []
        out.append({
            "phone": phone,
            "name": u.get("name") or u.get("email") or "",
            "company_id": (cids[0] if cids else None) or u.get("active_company_id") or "platform",
            "user_id": u.get("_id") or "",
        })
    return out


async def notify_companies_sms(message: str, company_ids: Optional[List[str]] = None, *, context: str = "announcement", ref_id: Optional[str] = None) -> Dict[str, Any]:
    creds = await resolve_platform_sms_creds()
    if not creds:
        return {"status": "skipped", "sent": 0, "failed": 0, "detail": "Platform SMS pasif veya yapılandırılmamış."}
    recipients = await collect_admin_phones(company_ids)
    if not recipients:
        return {"status": "skipped", "sent": 0, "failed": 0, "detail": "Hedef admin telefonu yok."}
    msg = (message or "").strip()[:400]
    sent = failed = 0
    for r in recipients:
        try:
            out = await send_platform_sms(
                phone=r["phone"], message=msg, context=context, ref_id=ref_id,
                company_id=r.get("company_id"), contact_name=r.get("name"),
            )
            if out.get("ok"):
                sent += 1
            else:
                failed += 1
        except Exception:
            failed += 1
    return {"status": "ok" if sent else "failed", "sent": sent, "failed": failed, "total": len(recipients)}


@router.get("/system/sms")
async def get_platform_sms(_: dict = Depends(saas.require_super_admin)):
    return _public_view(await load_settings())


@router.put("/system/sms")
async def save_platform_sms(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    cur = await load_settings()
    provider = comm_service.normalize_sms_provider(req.get("provider") or cur.get("provider"))
    usercode = str(req.get("usercode") if req.get("usercode") is not None else cur.get("usercode") or "").strip()
    msgheader = str(req.get("msgheader") if req.get("msgheader") is not None else cur.get("msgheader") or "").strip()
    is_active = bool(req["is_active"]) if "is_active" in req else bool(cur.get("is_active", False))
    password_raw = str(req.get("password") or "").strip()
    patch: Dict[str, Any] = {
        "provider": provider,
        "usercode": usercode,
        "msgheader": msgheader,
        "is_active": is_active,
        "updated_at": _now_iso(),
    }
    if password_raw:
        patch["password_enc"] = comm_service.encrypt(password_raw)
        patch["verified"] = False
        patch["verify_message"] = ""
    herr = comm_service.validate_msgheader(msgheader) if msgheader else None
    if herr:
        raise HTTPException(status_code=400, detail=herr)
    if is_active and not usercode:
        raise HTTPException(status_code=400, detail="Aktif SMS için kullanıcı kodu gerekli.")
    if is_active and not (password_raw or cur.get("password_enc")):
        raise HTTPException(status_code=400, detail="Aktif SMS için API şifresi gerekli.")
    await _db.platform_settings.update_one({"_id": SETTINGS_ID}, {"$set": patch}, upsert=True)
    return _public_view(await load_settings())


@router.post("/system/sms/verify")
async def verify_platform_sms(_: dict = Depends(saas.require_super_admin)):
    creds = await resolve_platform_sms_creds()
    if not creds:
        # Pasif olsa da doğrulamaya izin ver — kayıtlı şifre varsa
        s = await load_settings()
        if not s.get("usercode") or not s.get("password_enc"):
            raise HTTPException(status_code=400, detail="Önce kullanıcı ve API şifresini kaydedin.")
        try:
            password = comm_service.decrypt(s.get("password_enc") or "")
        except Exception as e:
            raise HTTPException(status_code=400, detail="Kayıtlı şifre okunamıyor; yeniden girin.") from e
        creds = {
            "provider": comm_service.normalize_sms_provider(s.get("provider")),
            "usercode": s.get("usercode") or "",
            "password": password,
            "msgheader": s.get("msgheader") or "",
        }
    try:
        res = await comm_service.sms_verify(creds)
    except Exception as e:
        raw_err = comm_service.sms_detail_text(getattr(e, "detail", None) or e, limit=500)
        logger.warning("platform sms verify failed: %s", mask_sensitive_text(raw_err)[:2000])
        raise HTTPException(
            status_code=502,
            detail=public_provider_detail("SMS doğrulaması başarısız.", raw_err),
        ) from e
    ok = bool(res.get("ok"))
    raw_verify = comm_service.sms_detail_text(
        res.get("message") or res.get("error") or res.get("raw") or ("OK" if ok else "Başarısız"),
        limit=500,
    )
    if ok:
        verify_message = comm_service.sms_detail_text(res.get("message") or "OK", limit=300)
    else:
        logger.warning("platform sms verify body: %s", mask_sensitive_text(raw_verify)[:2000])
        mapped = res.get("error") or res.get("message") or ""
        if looks_like_raw_body(mapped):
            mapped = ""
        verify_message = public_provider_detail(
            mapped or "SMS doğrulaması başarısız.",
            raw_verify,
            code=str(res.get("code") or ""),
        )
    patch = {
        "verified": ok,
        "verified_at": _now_iso() if ok else None,
        "verify_message": verify_message,
        "updated_at": _now_iso(),
    }
    await _db.platform_settings.update_one({"_id": SETTINGS_ID}, {"$set": patch}, upsert=True)
    out = _public_view(await load_settings())
    safe_test = dict(res) if isinstance(res, dict) else {"ok": ok}
    safe_test.pop("raw", None)
    if not ok:
        safe_test["error"] = verify_message
        safe_test["message"] = verify_message
    out["test"] = safe_test
    return out


@router.get("/system/sms/balance")
async def platform_sms_balance(_: dict = Depends(saas.require_super_admin)):
    creds = await resolve_platform_sms_creds()
    if not creds:
        s = await load_settings()
        if not s.get("password_enc"):
            raise HTTPException(status_code=400, detail="Platform SMS yapılandırılmamış.")
        try:
            password = comm_service.decrypt(s.get("password_enc") or "")
        except Exception as e:
            raise HTTPException(status_code=400, detail="Şifre okunamıyor.") from e
        creds = {
            "provider": comm_service.normalize_sms_provider(s.get("provider")),
            "usercode": s.get("usercode") or "",
            "password": password,
            "msgheader": s.get("msgheader") or "",
        }
    try:
        res = await comm_service.sms_balance(creds)
    except Exception as e:
        raw_err = comm_service.sms_detail_text(getattr(e, "detail", None) or e, limit=500)
        logger.warning("platform sms balance failed: %s", mask_sensitive_text(raw_err)[:2000])
        raise HTTPException(
            status_code=502,
            detail=public_provider_detail("SMS bakiye sorgusu başarısız.", raw_err),
        ) from e
    return res


def _unique_test_sms_body(custom: str = "") -> str:
    """Netgsm mükerrer engeli için her testte saat + kısa rastgele kod."""
    import secrets
    from datetime import datetime
    stamp = datetime.now().strftime("%H:%M:%S")
    code = secrets.token_hex(2).upper()
    base = str(custom or "").strip() or "TamKobi platform SMS test"
    return f"{base} {stamp} #{code}"[:400]


@router.post("/system/sms/send-test")
async def platform_sms_send_test(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    phone = str(req.get("phone") or "").strip()
    message = _unique_test_sms_body(str(req.get("message") or ""))
    try:
        result = await send_platform_sms(phone=phone, message=message, context="platform_test")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("platform sms send-test failed")
        raw = comm_service.sms_detail_text(getattr(e, "detail", None) or e, limit=500)
        logger.warning("platform sms send-test body: %s", mask_sensitive_text(raw)[:2000])
        raise HTTPException(
            status_code=502,
            detail=public_provider_detail("Test SMS gönderilemedi.", raw),
        ) from e
    await _db.platform_settings.update_one(
        {"_id": SETTINGS_ID},
        {"$set": {"last_test_at": _now_iso(), "updated_at": _now_iso()}},
        upsert=True,
    )
    if result.get("ok"):
        msg = f"Test SMS gönderildi: {result.get('phone')}"
        return {**result, "message": msg}
    msg = public_provider_detail(
        "Test SMS gönderilemedi.",
        result.get("detail"),
        code=str(result.get("code") or ""),
    )
    return {**result, "detail": msg, "message": msg}


async def platform_sms_log_rows(
    limit: int,
    *,
    before: Optional[str] = None,
    status: Optional[str] = None,
    context: Optional[str] = None,
) -> list:
    """source=platform SMS günlükleri, created_at azalan.

    before verilirse created_at o andan küçük olanlar (hariç).
    """
    q: Dict[str, Any] = {"source": "platform"}
    before_s = str(before).strip() if before else ""
    if before_s:
        q["created_at"] = {"$lt": before_s}
    status_s = str(status).strip() if status else ""
    if status_s:
        q["status"] = status_s
    context_s = str(context).strip() if context else ""
    if context_s:
        q["context"] = context_s
    return await _db.sms_logs.find(q).sort("created_at", -1).to_list(int(limit))


@router.get("/system/sms/logs")
async def platform_sms_logs(limit: int = 100, _: dict = Depends(saas.require_super_admin)):
    rows = await platform_sms_log_rows(min(max(int(limit or 100), 1), 300))
    out = []
    for r in rows:
        d = dict(r)
        d["id"] = d.pop("_id", None)
        out.append(d)
    return {"items": out, "total": len(out)}


async def failed_reset_rows(limit: int = 40) -> dict:
    """Son başarısız şifre sıfırlama denemeleri (SMS/e-posta hata logu)."""
    lim = min(max(int(limit or 40), 1), 300)
    rows = await _db.password_resets.find({
        "$or": [{"sms_failed": True}, {"mail_failed": True}],
    }).sort("created_at", -1).to_list(lim)
    items = []
    for r in rows:
        phone = r.get("phone") or ""
        email = r.get("email") or ""
        items.append({
            "id": (str(r.get("_id") or "")[:8] + "…") if r.get("_id") else None,
            "channel": r.get("channel") or ("sms" if r.get("sms_failed") else "email"),
            "phone_masked": password_reset_mask_phone(phone) if phone else "",
            "email_masked": password_reset_mask_email(email) if email else "",
            "error": (r.get("sms_error") or r.get("mail_error") or "")[:200],
            "company_id": r.get("company_id"),
            "created_at": r.get("created_at"),
            "sms_failed": bool(r.get("sms_failed")),
            "mail_failed": bool(r.get("mail_failed")),
        })
    return {"items": items, "total": len(items)}


@router.get("/system/password-resets/failed")
async def list_failed_password_resets(limit: int = 40, _: dict = Depends(saas.require_super_admin)):
    return await failed_reset_rows(limit)


def password_reset_mask_phone(phone: str) -> str:
    from password_reset import mask_phone
    return mask_phone(phone)


def password_reset_mask_email(email: str) -> str:
    from password_reset import mask_email
    return mask_email(email)
