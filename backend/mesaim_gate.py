"""Personel mesai kilidi: çıkıştan sonra (veya bugün giriş yokken) modül API'leri.

Mobil ve web ile aynı kural: bugünkü kayıtta giriş dolu ve çıkış boşsa açık mesai.
Dünden süren gece vardiyası burada muaf değildir; istemciler de yalnız bugünü okur.
Atölye tabletinin başka personeli açan shopfloor-unlock kontrolüne dokunulmaz.
"""
from typing import Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

import attendance
import rbac
from rbac import (
    SELF_SERVICE_SUFFIXES,
    SKIP_PREFIXES,
    get_user_from_token,
    is_public_api_path,
    module_for_path,
    normalize_role_code,
    session_token,
)

_db = None

MESAIM_LOCKED_DETAIL = (
    "Mesai çıkışı yapıldı. Diğer modüller bir sonraki mesai girişine kadar kapalı. "
    "Mesaim'den giriş yapın."
)
MESAIM_LOCKED_CODE = "mesaim_locked"

# SKIP_PREFIXES zaten self-servis mesai uçlarının çoğunu taşır. /api/companies
# modül haritasında /settings'tir; şirket listesi ve seçimi kilitliyken de açık kalır.
# /api/dashboard "/" modülüne düşer. Mobil Özet (HomeScreen) kilitliyken de
# /dashboard/overview çağırır; rozetler /dashboard/tile-badges. İkisi 403 olursa
# Özet "yüklenemedi" der. stats ve manager-summary personelde çağrılmaz
# (employee_id varken finans özeti kapalı), bu yüzden listede yoklar.
_OPEN_PREFIXES = (
    "/api/auth",
    "/api/personnel/me",
    "/api/personnel/attendance/self",
    "/api/personnel/attendance/me",
    "/api/personnel/attendance/geo",
    "/api/personnel/attendance/reminder-prefs",
    "/api/personnel/attendance/early-leave-request",
    "/api/personnel/attendance/intraday-leave-request",
    "/api/personnel/leaves/self",
    "/api/personnel/leaves/me",
    "/api/personnel/bonuses/self",
    "/api/personnel/messages",
    "/api/notifications",
    "/api/mobile",
    "/api/companies",
    "/api/files",
    "/api/health",
    "/api/version",
    "/api/license",
    "/api/dashboard/overview",
    "/api/dashboard/tile-badges",
)

_EXEMPT_ROLES = frozenset({"admin", "manager"})


def init(db):
    global _db
    _db = db


def _path(path: str) -> str:
    return str(path or "").split("?", 1)[0]


def _starts(path: str, prefixes) -> bool:
    return path.startswith(prefixes)


def is_mesaim_gated_path(path, method) -> bool:
    """Modül API'si kilitlensin mi. Mesaim, self-servis ve Özet uçları False."""
    p = _path(path)
    method_u = str(method or "GET").upper()
    if _starts(p, SKIP_PREFIXES) or is_public_api_path(p, method_u):
        return False
    if _starts(p, _OPEN_PREFIXES):
        return False
    # rbac bu sonekleri /mesai sayar (module_for_path /personnel döner). Mesaim ekranı
    # kilitliyken de onay ve düzeltme talebi gönderebilsin.
    if p.startswith("/api/personnel/attendance/") and p.endswith(SELF_SERVICE_SUFFIXES):
        return False
    module = module_for_path(p)
    if module and module not in ("/mesai", "/personelim"):
        return True
    return False


def _impersonating(user: dict) -> bool:
    if user.get("impersonation") or user.get("imp_by"):
        return True
    payload = user.get("_token_payload") or {}
    return bool(payload.get("imp_by") or payload.get("imp_session"))


def _open_session(today_rec: Optional[dict]) -> bool:
    if not today_rec:
        return False
    inn = str(today_rec.get("check_in") or "").strip()
    out = str(today_rec.get("check_out") or "").strip()
    return bool(inn) and not out


def mesaim_locked(user: dict, employee: Optional[dict], today_rec: Optional[dict]) -> bool:
    """True: personel bugün açık mesaide değil. Yönetici, owner, süper admin ve impersonation değil."""
    user = user or {}
    if user.get("is_super_admin") or _impersonating(user):
        return False
    if not str(user.get("employee_id") or "").strip():
        return False
    if user.get("skip_check_in") or attendance.employee_skips_check_in(employee):
        return False
    if normalize_role_code(user.get("role")) in _EXEMPT_ROLES:
        return False
    return not _open_session(today_rec)


def _exempt_without_db(user: dict) -> bool:
    """Admin / müdür / owner / skip / süper admin / impersonation / personel kartı yok: sorgu yok."""
    if user.get("is_super_admin") or _impersonating(user):
        return True
    if not str(user.get("employee_id") or "").strip():
        return True
    if user.get("skip_check_in"):
        return True
    return normalize_role_code(user.get("role")) in _EXEMPT_ROLES


def _company_id(user: dict) -> str:
    cid = str(user.get("active_company_id") or "").strip()
    if cid:
        return cid
    for item in user.get("company_ids") or []:
        text = str(item or "").strip()
        if text:
            return text
    return ""


async def _locked_now(user: dict) -> bool:
    """Kilitlenebilir kullanıcı: en fazla 3 find_one (personel, şirket, bugünkü puantaj)."""
    # rbac._db rota testlerinde sonradan değişir; init edilen db yedektir.
    db = rbac._db or _db
    if db is None:
        return False
    cid = _company_id(user)
    emp_id = str(user.get("employee_id") or "").strip()
    if not cid or not emp_id:
        return mesaim_locked(user, None, None)
    employee = await db.employees.find_one({"_id": emp_id, "company_id": cid})
    if attendance.employee_skips_check_in(employee):
        return False
    company = await db.companies.find_one({"_id": cid}) or {}
    schedule = attendance.merge_schedule(company, employee)
    today = attendance._today(schedule)
    today_rec = await db.attendance.find_one({"employee_id": emp_id, "date": today, "company_id": cid})
    return mesaim_locked(user, employee, today_rec)


class MesaimGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api") or request.method == "OPTIONS":
            return await call_next(request)
        if not is_mesaim_gated_path(path, request.method):
            return await call_next(request)

        token = session_token(request)
        user = None
        db = rbac._db or _db
        if token and db is not None:
            try:
                user = await get_user_from_token(token, db, request=request, path=path)
            except HTTPException:
                user = None
        if not user or _exempt_without_db(user):
            return await call_next(request)
        if await _locked_now(user):
            return JSONResponse(
                {"detail": MESAIM_LOCKED_DETAIL, "code": MESAIM_LOCKED_CODE},
                status_code=403,
            )
        return await call_next(request)
