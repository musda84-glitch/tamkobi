"""Platform SMS: Netgsm / İleti Merkezi / Verimor — şifre sıfırlama ve sistem bilgilendirmeleri."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

import saas
import comm_service

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
        logger.warning("platform sms send failed: %s", e)
        raise HTTPException(status_code=502, detail=f"SMS gönderilemedi: {str(e)[:160]}") from e
    ok = bool(res.get("ok"))
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
        "detail": (res.get("message") or res.get("raw") or "")[:300],
        "source": "platform",
        "created_at": _now_iso(),
    }
    try:
        await _db.sms_logs.insert_one(log)
    except Exception:
        pass
    if not ok:
        raise HTTPException(status_code=502, detail=log["detail"] or "SMS gönderilemedi.")
    return {"status": "sent", "phone": no, "provider": creds.get("provider"), "detail": log["detail"]}


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
            await send_platform_sms(
                phone=r["phone"], message=msg, context=context, ref_id=ref_id,
                company_id=r.get("company_id"), contact_name=r.get("name"),
            )
            sent += 1
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
        raise HTTPException(status_code=502, detail=f"Doğrulama başarısız: {str(e)[:160]}") from e
    ok = bool(res.get("ok"))
    patch = {
        "verified": ok,
        "verified_at": _now_iso() if ok else None,
        "verify_message": (res.get("message") or res.get("raw") or ("OK" if ok else "Başarısız"))[:300],
        "updated_at": _now_iso(),
    }
    await _db.platform_settings.update_one({"_id": SETTINGS_ID}, {"$set": patch}, upsert=True)
    out = _public_view(await load_settings())
    out["test"] = res
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
        raise HTTPException(status_code=502, detail=str(e)[:160]) from e
    return res


@router.post("/system/sms/send-test")
async def platform_sms_send_test(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    phone = str(req.get("phone") or "").strip()
    message = str(req.get("message") or "TamKobi platform SMS test mesajı.").strip()
    result = await send_platform_sms(phone=phone, message=message, context="platform_test")
    await _db.platform_settings.update_one(
        {"_id": SETTINGS_ID},
        {"$set": {"last_test_at": _now_iso(), "updated_at": _now_iso()}},
        upsert=True,
    )
    return {**result, "message": f"Test SMS gönderildi: {result.get('phone')}"}


@router.get("/system/sms/logs")
async def platform_sms_logs(limit: int = 100, _: dict = Depends(saas.require_super_admin)):
    rows = await _db.sms_logs.find({"source": "platform"}).sort("created_at", -1).to_list(min(max(int(limit or 100), 1), 300))
    out = []
    for r in rows:
        d = dict(r)
        d["id"] = d.pop("_id", None)
        out.append(d)
    return {"items": out, "total": len(out)}
