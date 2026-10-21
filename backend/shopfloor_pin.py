"""Atölye operatör PIN'i ve sunucu imzalı operatör token'ı.

PIN giriş şifresinden ayrıdır; düz metin saklanmaz. Operatör token'ı
normal erişim token'ı değildir (ayrı typ ve audience).
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request

import applog
import attendance
import auth_utils
import rbac
import shopfloor_accounts
import tenant_access
from auth_utils import JWT_ALGORITHM, get_jwt_secret, hash_password, verify_password

router = APIRouter(prefix="/api")
_current_user = None


class _LiveDB:
    """Sorgular her zaman güncel server.db'yi kullanır (testler server.db'yi değiştirir)."""

    def __getattr__(self, name):
        import server
        return getattr(server.db, name)

    def __getitem__(self, name):
        import server
        return server.db[name]


_db = _LiveDB()

AUD = "tamkobi-shopfloor"
TYP = "shopfloor_op"
PIN_RE = re.compile(r"^[0-9]{4}$")
LOCK_FAILS = 5
LOCK_MINUTES = 15
ACCOUNT_WINDOW = timedelta(minutes=10)
ACCOUNT_MAX = 20
TOKEN_MAX = timedelta(hours=12)
TOKEN_FALLBACK = timedelta(hours=8)
PIN_VERSION = 2

TRIVIAL_PINS = frozenset({
    "0000", "1111", "2222", "3333", "4444",
    "5555", "6666", "7777", "8888", "9999",
    "1234", "4321", "0123", "3210",
})

TOKEN_DETAIL = "Operatör oturumu geçersiz veya süresi doldu."
PIN_FORMAT_UNLOCK = "PIN 4 haneli olmalı; yöneticinizden yeni PIN isteyin."
PIN_FORMAT_SET = "PIN 4 haneli olmalı."
PIN_TRIVIAL = "Bu PIN çok kolay. Daha zor bir PIN seçin."
PIN_REQUIRED = "Personel ve şifre gerekli."
PIN_UNDEFINED = "Bu personel için atölye şifresi tanımlı değil. Personel kartından şifre belirleyin."
PIN_MISMATCH = "PIN tekrarı eşleşmiyor."
SELF_PIN_DENIED = "Atölye PIN'ini yalnızca yönetici ayarlayabilir."
PERSONNEL_PIN_DENIED = "Bu işlem için personel düzenleme yetkisi gerekir."
RATE_DETAIL = "Çok fazla deneme. Lütfen daha sonra tekrar deneyin."
NOT_FOUND_EMP = "Çalışan bulunamadı."
NOT_FOUND_USER = "Kullanıcı bulunamadı."

_SELF_ROLE = "admin"
_LIST_ROLES = frozenset({"admin", "owner", "yönetici", "yonetici"})
_DUMMY_HASH = None


class PinResult(Exception):
    """Unlock yanıtı. detail düz metindir; PIN/token/hash taşımaz."""

    def __init__(self, status_code: int, detail: str, **extra: Any):
        self.status_code = int(status_code)
        self.detail = str(detail)
        self.extra = {k: v for k, v in extra.items() if v is not None}


class OperatorName(str):
    """İş emri 'who' değeri. str gibi davranır; audit için kimlik taşır."""

    operator_type: str
    operator_id: str

    def __new__(cls, value: str, operator_type: str = "", operator_id: str = ""):
        obj = str.__new__(cls, value)
        obj.operator_type = str(operator_type or "")
        obj.operator_id = str(operator_id or "")
        return obj


def init(db, get_current_user) -> None:
    """db argümanı shopfloor_accounts.init ile aynı imza içindir. Sorgular server.db kullanır."""
    global _current_user
    _current_user = get_current_user
    if db is None:
        return


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Atölye PIN yetkisi bağlanmadı.")
    return await _current_user(request)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(now: Optional[datetime]) -> datetime:
    if now is None:
        return utcnow()
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return _aware(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except Exception:
            return None
    try:
        return _aware(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except Exception:
        return None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if not _DUMMY_HASH:
        _DUMMY_HASH = hash_password("*")
    return _DUMMY_HASH


def validate_pin(pin: Any, *, reject_trivial: bool = False) -> bool:
    """4 rakam. Baştaki/sondaki boşluk da reddedilir. Trivial liste opsiyoneldir."""
    text = "" if pin is None else str(pin)
    if PIN_RE.fullmatch(text) is None:
        return False
    if reject_trivial and text in TRIVIAL_PINS:
        return False
    return True


def is_locked(state: Optional[dict], now: datetime) -> Optional[datetime]:
    """Kilit sürüyorsa bitiş anı, değilse None."""
    if not state:
        return None
    until = _parse_dt(state.get("locked_until"))
    if until and until > _aware(now):
        return until
    return None


def lock_minutes_left(until: datetime, now: datetime) -> int:
    seconds = ( _aware(until) - _aware(now)).total_seconds()
    if seconds <= 0:
        return 0
    return max(1, int((seconds + 59) // 60))


def register_failure(state: Optional[dict], now: datetime) -> dict:
    """5. hatada locked_until = now + 15 dk. Süresi dolmuş kilit sayacı sıfırdan başlar."""
    now = _aware(now)
    state = state or {}
    until = _parse_dt(state.get("locked_until"))
    fails = int(state.get("fails") or 0)
    window = state.get("window_start")
    if until and until <= now:
        fails = 0
        window = None
    fails += 1
    locked = (now + timedelta(minutes=LOCK_MINUTES)).isoformat() if fails >= LOCK_FAILS else None
    if not window:
        window = now.isoformat()
    return {"fails": fails, "window_start": window, "locked_until": locked}


def reset_failures() -> dict:
    return {"fails": 0, "window_start": None, "locked_until": None}


def account_blocked(state: Optional[dict], now: datetime) -> bool:
    """Atölye hesabı: 10 dk pencerede 20 deneme dolmuşsa True."""
    if not state:
        return False
    now = _aware(now)
    start = _parse_dt(state.get("window_start"))
    if start is None or now - start > ACCOUNT_WINDOW:
        return False
    return int(state.get("fails") or 0) >= ACCOUNT_MAX


def register_account_attempt(state: Optional[dict], now: datetime) -> dict:
    now = _aware(now)
    state = state or {}
    start = _parse_dt(state.get("window_start"))
    fails = int(state.get("fails") or 0)
    if start is None or now - start > ACCOUNT_WINDOW:
        return {"fails": 1, "window_start": now.isoformat(), "locked_until": None}
    return {
        "fails": fails + 1,
        "window_start": start.isoformat(),
        "locked_until": state.get("locked_until"),
    }


def failure_detail(fails: int) -> tuple:
    """(status, message, remaining). 5. hatada kilit mesajı."""
    remaining = max(0, LOCK_FAILS - int(fails))
    if int(fails) >= LOCK_FAILS:
        return 423, f"{LOCK_MINUTES} dk sonra tekrar deneyin", 0
    text = (
        f"PIN hatalı: {remaining} deneme hakkınız kaldı — "
        f"{LOCK_FAILS} hatalı denemede {LOCK_MINUTES} dk kilitlenir"
    )
    return 401, text, remaining


def operator_session_expiry(schedule: Optional[dict], now: datetime) -> datetime:
    """min(12 saat, mesai bitişi). Mesai bitişi yoksa veya geçmişse 8 saat."""
    now = _aware(now)
    fallback = now + TOKEN_FALLBACK
    cap = now + TOKEN_MAX
    if not isinstance(schedule, dict) or not str(schedule.get("end") or "").strip():
        return fallback
    try:
        local = now.astimezone(attendance._tz(schedule))
        end_hm = attendance.day_end_hm(schedule, local.strftime("%Y-%m-%d"))
    except Exception:
        return fallback
    if not end_hm or len(str(end_hm)) < 4:
        return fallback
    try:
        hour, minute = [int(part) for part in str(end_hm)[:5].split(":")]
        end_local = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    except Exception:
        return fallback
    if end_local <= local:
        return fallback
    end_utc = end_local.astimezone(timezone.utc)
    if end_utc <= now:
        return fallback
    return min(cap, end_utc)


def issue_operator_token(
    *,
    company_id: str,
    atolye_user_id: str,
    operator_id: str,
    operator_type: str,
    operator_name: str,
    pin_ver: int,
    exp: datetime,
    now: Optional[datetime] = None,
    device_id: str = "",
) -> str:
    now = _aware(now)
    payload = {
        "typ": TYP,
        "aud": AUD,
        "cid": str(company_id),
        "aid": str(atolye_user_id),
        "oid": str(operator_id),
        "otype": str(operator_type),
        "oname": str(operator_name or ""),
        "pver": int(pin_ver or 0),
        "iat": int(now.timestamp()),
        "exp": exp,
    }
    did = str(device_id or "").strip()
    if did:
        payload["did"] = did
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


_DEVICE_UNSET = object()


def _operator_claims(token: str, *, company_id: str, atolye_user_id: str, now: Optional[datetime] = None) -> dict:
    """aud + typ + cid + aid + exp. Hatalar genel mesaja map edilir; değer dönmez."""
    now = _aware(now)
    try:
        payload = jwt.decode(
            str(token or ""),
            get_jwt_secret(),
            algorithms=[JWT_ALGORITHM],
            audience=AUD,
            options={"require": ["exp", "aud"]},
        )
    except jwt.ExpiredSignatureError:
        raise PinResult(401, TOKEN_DETAIL)
    except jwt.InvalidTokenError:
        raise PinResult(401, TOKEN_DETAIL)
    if payload.get("typ") != TYP:
        raise PinResult(401, TOKEN_DETAIL)
    if str(payload.get("cid") or "") != str(company_id or ""):
        raise PinResult(403, TOKEN_DETAIL)
    if str(payload.get("aid") or "") != str(atolye_user_id or ""):
        raise PinResult(403, TOKEN_DETAIL)
    exp = _parse_dt(payload.get("exp"))
    if exp is None or exp <= now:
        raise PinResult(401, TOKEN_DETAIL)
    otype = str(payload.get("otype") or "")
    if otype not in ("employee", "user"):
        raise PinResult(401, TOKEN_DETAIL)
    return payload


def _device_claim_active(row: Any, company_id: str, device_id: str) -> bool:
    if not isinstance(row, dict):
        return False
    if str(row.get("_id") or "") != str(device_id or ""):
        return False
    if str(row.get("company_id") or "") != str(company_id or ""):
        return False
    return str(row.get("status") or "") == "active"


def decode_operator_token(
    token: str,
    *,
    company_id: str,
    atolye_user_id: str,
    now: Optional[datetime] = None,
    device_row: Any = _DEVICE_UNSET,
) -> dict:
    """JWT doğrulaması. did claim varsa cihaz satırı active olmak zorunda."""
    payload = _operator_claims(token, company_id=company_id, atolye_user_id=atolye_user_id, now=now)
    did = str(payload.get("did") or "").strip()
    if not did:
        return payload
    if not _device_claim_active(device_row, str(payload.get("cid") or ""), did):
        raise PinResult(401, TOKEN_DETAIL)
    return payload


def _log(user_id: str, company_id: str, operator_id: str, result: str) -> None:
    applog.log_event(
        "shopfloor_pin",
        "shopfloor_pin",
        user_id=str(user_id or ""),
        company_id=str(company_id or ""),
        operator_id=str(operator_id or ""),
        result=str(result or ""),
    )


def _actor_id(user: Optional[dict]) -> str:
    if not isinstance(user, dict):
        return ""
    return str(user.get("_id") or user.get("id") or "")


async def _audit(
    company_id: str,
    action: str,
    *,
    actor_user_id: str = "",
    atolye_user_id: str = "",
    operator_type: str = "",
    operator_id: str = "",
    wo_id: str = "",
) -> None:
    if not str(company_id or "").strip():
        return
    await _db.shopfloor_pin_audit.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": str(company_id),
        "at": utcnow().isoformat(),
        "action": str(action),
        "actor_user_id": str(actor_user_id or ""),
        "atolye_user_id": str(atolye_user_id or ""),
        "operator_type": str(operator_type or ""),
        "operator_id": str(operator_id or ""),
        "wo_id": str(wo_id or ""),
    })


def _read_pin(body: Optional[dict]) -> str:
    """pin yoksa password alan adı PIN olarak okunur. Değer kırpılmaz."""
    body = body or {}
    if "pin" in body and body.get("pin") is not None:
        return str(body.get("pin"))
    return str(body.get("password") if body.get("password") is not None else "")


def _require_format(pin: str, *, unlock: bool) -> None:
    if validate_pin(pin, reject_trivial=False):
        return
    raise PinResult(400, PIN_FORMAT_UNLOCK if unlock else PIN_FORMAT_SET)


def _require_set_pin(pin: str) -> None:
    if not validate_pin(pin, reject_trivial=False):
        raise HTTPException(status_code=400, detail=PIN_FORMAT_SET)
    if pin in TRIVIAL_PINS:
        raise HTTPException(status_code=400, detail=PIN_TRIVIAL)


async def _load_attempt(company_id: str, subject: str) -> Optional[dict]:
    return await _db.shopfloor_pin_attempts.find_one({
        "company_id": str(company_id),
        "subject": subject,
    })


async def _save_attempt(company_id: str, subject: str, state: dict) -> None:
    await _db.shopfloor_pin_attempts.update_one(
        {"company_id": str(company_id), "subject": subject},
        {"$set": {
            "company_id": str(company_id),
            "subject": subject,
            "fails": int(state.get("fails") or 0),
            "window_start": state.get("window_start"),
            "locked_until": state.get("locked_until"),
        }},
        upsert=True,
    )


async def _absorb_plaintext(kind: str, doc: dict, company_id: str) -> dict:
    """shopfloor_pin düz metin alanı varsa hash'le ve alanı kaldır. Değer loglanmaz."""
    if not isinstance(doc, dict):
        return doc
    raw = doc.get("shopfloor_pin")
    if not isinstance(raw, str) or not raw.strip() or raw.startswith("$2"):
        return doc
    hashed = hash_password(raw.strip())
    if kind == "users":
        await _db.users.update_one(
            {"_id": doc["_id"], "company_ids": company_id},
            {
                "$set": {"shopfloor_pin_hash": hashed, "shopfloor_pin_v": PIN_VERSION},
                "$unset": {"shopfloor_pin": ""},
                "$inc": {"shopfloor_pin_ver": 1},
            },
        )
    else:
        await _db.employees.update_one(
            {"_id": doc["_id"], "company_id": company_id},
            {
                "$set": {"shopfloor_pin_hash": hashed, "shopfloor_pin_v": PIN_VERSION},
                "$unset": {"shopfloor_pin": ""},
                "$inc": {"shopfloor_pin_ver": 1},
            },
        )
    out = dict(doc)
    out["shopfloor_pin_hash"] = hashed
    out.pop("shopfloor_pin", None)
    out["shopfloor_pin_ver"] = int(out.get("shopfloor_pin_ver") or 0) + 1
    return out


async def _write_employee_pin(emp_id: str, company_id: str, pin: str) -> None:
    await _db.employees.update_one(
        {"_id": emp_id, "company_id": company_id},
        {
            "$set": {
                "shopfloor_pin_hash": hash_password(pin),
                "shopfloor_pin_v": PIN_VERSION,
                "updated_at": utcnow().isoformat(),
            },
            "$unset": {"shopfloor_pin": ""},
            "$inc": {"shopfloor_pin_ver": 1},
        },
    )


async def _write_user_pin(user_id: str, company_id: str, pin: str) -> None:
    await _db.users.update_one(
        {"_id": user_id, "company_ids": company_id},
        {
            "$set": {
                "shopfloor_pin_hash": hash_password(pin),
                "shopfloor_pin_v": PIN_VERSION,
                "updated_at": utcnow().isoformat(),
            },
            "$unset": {"shopfloor_pin": ""},
            "$inc": {"shopfloor_pin_ver": 1},
        },
    )


async def _clear_employee_pin(emp_id: str, company_id: str) -> None:
    await _db.employees.update_one(
        {"_id": emp_id, "company_id": company_id},
        {"$unset": {"shopfloor_pin_hash": "", "shopfloor_pin": ""}, "$inc": {"shopfloor_pin_ver": 1}},
    )


async def _clear_user_pin(user_id: str, company_id: str) -> None:
    await _db.users.update_one(
        {"_id": user_id, "company_ids": company_id},
        {"$unset": {"shopfloor_pin_hash": "", "shopfloor_pin": ""}, "$inc": {"shopfloor_pin_ver": 1}},
    )


def _is_owner_role(user: Optional[dict]) -> bool:
    return str((user or {}).get("role") or "").strip().lower() == "owner"


def _list_role(user: Optional[dict]) -> bool:
    raw = str((user or {}).get("role") or "").strip().lower()
    return raw in _LIST_ROLES


async def _linked_employee(user: dict, company_id: str) -> Optional[dict]:
    eid = str(user.get("employee_id") or "").strip()
    uid = _actor_id(user)
    if eid:
        emp = await _db.employees.find_one({"_id": eid, "company_id": company_id})
        if emp:
            return emp
    if uid:
        return await _db.employees.find_one({"user_id": uid, "company_id": company_id})
    return None


async def _owner_of_employee(emp: dict) -> bool:
    cid = str(emp.get("company_id") or "")
    eid = str(emp.get("_id") or "")
    uid = str(emp.get("user_id") or "").strip()
    clauses = [{"employee_id": eid}]
    if uid and uid != "-":
        clauses.append({"_id": uid})
    found = await _db.users.find({"$or": clauses, "company_ids": cid}).to_list(5)
    return any(_is_owner_role(row) for row in found or [])


async def employee_is_shopfloor_ready(emp: Optional[dict]) -> bool:
    """_shopfloor_require_mesaim_check_in ile aynı kural; hata atmaz.

    skip_check_in ve owner muaf. Yoklama sorguları company_id taşır.
    """
    if not emp:
        return False
    if attendance.employee_skips_check_in(emp):
        return True
    if await _owner_of_employee(emp):
        return True
    cid = str(emp.get("company_id") or "")
    company = await _db.companies.find_one({"_id": cid}) or {}
    schedule = attendance.merge_schedule(company, emp)
    today_s = attendance._today(schedule)
    yest_s = attendance.previous_ymd(today_s)
    today_rec = await _db.attendance.find_one({
        "employee_id": emp["_id"],
        "date": today_s,
        "company_id": cid,
    })
    yest_rec = await _db.attendance.find_one({
        "employee_id": emp["_id"],
        "date": yest_s,
        "company_id": cid,
    })
    return attendance.shopfloor_operator_checked_in(today_rec, yest_rec)


async def _require_ready(target: dict) -> None:
    user = target.get("user")
    emp = target.get("employee")
    if user and _is_owner_role(user):
        return
    if emp is None:
        return
    if await employee_is_shopfloor_ready(emp):
        return
    raise PinResult(403, attendance.SHOPFLOOR_REQUIRE_CHECKIN_DETAIL)


async def _load_user_target(user_id: str, company_id: str) -> dict:
    doc = await _db.users.find_one({"_id": user_id, "company_ids": company_id})
    if not doc or shopfloor_accounts.is_atolye_user(doc) or doc.get("is_active") is False:
        raise PinResult(404, NOT_FOUND_USER)
    emp = None
    eid = str(doc.get("employee_id") or "").strip()
    if eid:
        emp = await _db.employees.find_one({"_id": eid, "company_id": company_id})
    if emp:
        emp = await _absorb_plaintext("employees", emp, company_id)
        return {
            "operator_type": "employee",
            "operator_id": emp["_id"],
            "name": emp.get("full_name") or doc.get("name") or "",
            "hash": emp.get("shopfloor_pin_hash") or "",
            "pin_ver": int(emp.get("shopfloor_pin_ver") or 0),
            "employee": emp,
            "user": doc,
            "subject": f"emp:{emp['_id']}",
        }
    doc = await _absorb_plaintext("users", doc, company_id)
    return {
        "operator_type": "user",
        "operator_id": doc["_id"],
        "name": doc.get("name") or "",
        "hash": doc.get("shopfloor_pin_hash") or "",
        "pin_ver": int(doc.get("shopfloor_pin_ver") or 0),
        "employee": None,
        "user": doc,
        "subject": f"usr:{doc['_id']}",
    }


async def _resolve_target(body: dict, company_id: str) -> dict:
    otype = str(body.get("operator_type") or "").strip().lower()
    oid = str(body.get("operator_id") or "").strip()
    emp_id = str(body.get("employee_id") or "").strip()
    user_id = str(body.get("user_id") or "").strip()
    if otype == "user" and oid:
        user_id = oid
    elif otype == "employee" and oid:
        emp_id = oid
    if user_id and not emp_id:
        return await _load_user_target(user_id, company_id)
    if not emp_id:
        raise PinResult(400, PIN_REQUIRED)
    emp = await _db.employees.find_one({"_id": emp_id, "company_id": company_id})
    if not emp:
        raise PinResult(404, NOT_FOUND_EMP)
    emp = await _absorb_plaintext("employees", emp, company_id)
    return {
        "operator_type": "employee",
        "operator_id": emp["_id"],
        "name": emp.get("full_name") or "",
        "hash": emp.get("shopfloor_pin_hash") or "",
        "pin_ver": int(emp.get("shopfloor_pin_ver") or 0),
        "employee": emp,
        "user": None,
        "subject": f"emp:{emp['_id']}",
    }


async def _schedule_for(company_id: str, emp: Optional[dict]) -> dict:
    company = await _db.companies.find_one({"_id": company_id}) or {}
    if emp:
        return attendance.merge_schedule(company, emp)
    raw = company.get("work_schedule")
    return raw if isinstance(raw, dict) else {}


async def unlock(req: Optional[dict], user: dict) -> dict:
    """PIN doğrula ve operatör token'ı ver. users.password_hash hiç okunmaz."""
    body = req or {}
    company_id = tenant_access.resolve_company_id(user, body.get("company_id"))
    pin = _read_pin(body)
    has_target = any(str(body.get(key) or "").strip() for key in ("employee_id", "user_id", "operator_id"))
    if not pin or not has_target:
        raise PinResult(400, PIN_REQUIRED)
    if not validate_pin(pin, reject_trivial=False):
        _log(_actor_id(user), company_id, "", "format")
        raise PinResult(400, PIN_FORMAT_UNLOCK)
    target = await _resolve_target(body, company_id)
    actor = _actor_id(user)
    atolye_id = actor if shopfloor_accounts.is_atolye_user(user) else ""
    now = utcnow()
    if atolye_id:
        acct_subject = f"acct:{atolye_id}"
        acct = await _load_attempt(company_id, acct_subject)
        if account_blocked(acct, now):
            _log(actor, company_id, target["operator_id"], "rate")
            raise PinResult(429, RATE_DETAIL)
        await _save_attempt(company_id, acct_subject, register_account_attempt(acct, now))
    state = await _load_attempt(company_id, target["subject"])
    locked = is_locked(state, now)
    if locked:
        minutes = lock_minutes_left(locked, now)
        _log(actor, company_id, target["operator_id"], "locked")
        await _audit(
            company_id, "locked",
            actor_user_id=actor, atolye_user_id=atolye_id,
            operator_type=target["operator_type"], operator_id=target["operator_id"],
        )
        raise PinResult(423, f"{minutes} dk sonra tekrar deneyin", remaining_attempts=0)
    pin_hash = str(target.get("hash") or "")
    if not pin_hash:
        verify_password(pin, _dummy_hash())
        _log(actor, company_id, target["operator_id"], "undefined")
        raise PinResult(400, PIN_UNDEFINED)
    if not verify_password(pin, pin_hash):
        nxt = register_failure(state, now)
        await _save_attempt(company_id, target["subject"], nxt)
        status, detail, remaining = failure_detail(nxt["fails"])
        action = "locked" if status == 423 else "unlock_fail"
        _log(actor, company_id, target["operator_id"], action)
        await _audit(
            company_id, action,
            actor_user_id=actor, atolye_user_id=atolye_id,
            operator_type=target["operator_type"], operator_id=target["operator_id"],
        )
        extra = {"remaining_attempts": remaining}
        if status == 423 and nxt.get("locked_until"):
            extra["locked_until"] = nxt["locked_until"]
        raise PinResult(status, detail, **extra)
    await _save_attempt(company_id, target["subject"], reset_failures())
    await _require_ready(target)
    schedule = await _schedule_for(company_id, target.get("employee"))
    exp = operator_session_expiry(schedule, now)
    device_id = _actor_id(user) if shopfloor_accounts.is_device_user(user) else ""
    token = issue_operator_token(
        company_id=company_id,
        atolye_user_id=actor,
        operator_id=target["operator_id"],
        operator_type=target["operator_type"],
        operator_name=target["name"],
        pin_ver=int(target.get("pin_ver") or 0),
        exp=exp,
        now=now,
        device_id=device_id,
    )
    _log(actor, company_id, target["operator_id"], "unlock_ok")
    await _audit(
        company_id, "unlock_ok",
        actor_user_id=actor, atolye_user_id=atolye_id,
        operator_type=target["operator_type"], operator_id=target["operator_id"],
    )
    emp = target.get("employee") or {}
    return {
        "status": "success",
        "employee_id": emp.get("_id") or (target["operator_id"] if target["operator_type"] == "employee" else None),
        "operator_name": target["name"],
        "operator_token": token,
        "operator_type": target["operator_type"],
        "operator_id": target["operator_id"],
        "expires_at": exp.isoformat(),
    }


def _extract_token(req: Any, request: Any = None) -> str:
    if request is not None:
        headers = getattr(request, "headers", None)
        if headers is not None:
            tok = str(headers.get("x-shopfloor-operator") or "").strip()
            if tok:
                return tok
    if isinstance(req, dict):
        return str(req.get("operator_token") or "").strip()
    headers = getattr(req, "headers", None)
    if headers is not None:
        return str(headers.get("x-shopfloor-operator") or "").strip()
    return ""


async def _pin_ver_matches(payload: dict, company_id: str) -> bool:
    oid = str(payload.get("oid") or "")
    otype = str(payload.get("otype") or "")
    try:
        want = int(payload.get("pver") or 0)
    except (TypeError, ValueError):
        return False
    if otype == "employee":
        doc = await _db.employees.find_one(
            {"_id": oid, "company_id": company_id},
            {"shopfloor_pin_hash": 1, "shopfloor_pin_ver": 1},
        )
    else:
        doc = await _db.users.find_one({"_id": oid, "company_ids": company_id})
    if not doc or not doc.get("shopfloor_pin_hash"):
        return False
    return int(doc.get("shopfloor_pin_ver") or 0) == want


async def caller_display_name(user: dict) -> OperatorName:
    """Bağlı personelin adı, yoksa users.name. body.operator_name kullanılmaz."""
    if not isinstance(user, dict):
        return OperatorName("")
    cid = str(user.get("active_company_id") or "").strip()
    if not cid:
        ids = [str(item).strip() for item in (user.get("company_ids") or []) if str(item or "").strip()]
        cid = ids[0] if ids else ""
    emp = None
    if cid:
        emp = await _linked_employee(user, cid)
    if emp and str(emp.get("full_name") or "").strip():
        return OperatorName(str(emp.get("full_name")).strip(), "employee", str(emp.get("_id") or ""))
    return OperatorName(str(user.get("name") or "").strip(), "user", _actor_id(user))


async def resolve_operator(req: Any, user: Any, w: Optional[dict] = None, *, fallback: str = "", request: Any = None, prefer_body: bool = True) -> OperatorName:
    """Atölye hesabında token zorunlu. Normal kullanıcıda her zaman kendisi.

    Oturum dict'i yoksa (doğrudan birim çağrı) eski operator_name / fallback korunur.
    """
    if not isinstance(user, dict):
        body = req if isinstance(req, dict) else {}
        if prefer_body:
            name = str(body.get("operator_name") or fallback or "").strip()
        else:
            name = str(fallback or "").strip()
        return OperatorName(name)
    if shopfloor_accounts.is_atolye_user(user):
        token = _extract_token(req, request)
        if not token:
            raise HTTPException(status_code=401, detail=TOKEN_DETAIL)
        cid = str((w or {}).get("company_id") or user.get("active_company_id") or "").strip()
        aid = _actor_id(user)
        try:
            claims = _operator_claims(token, company_id=cid, atolye_user_id=aid, now=utcnow())
            did = str(claims.get("did") or "").strip()
            if did:
                device_row = await _db.shopfloor_devices.find_one({
                    "_id": did,
                    "company_id": cid,
                })
                decode_operator_token(
                    token, company_id=cid, atolye_user_id=aid, now=utcnow(), device_row=device_row,
                )
            payload = claims
        except PinResult as exc:
            raise HTTPException(status_code=exc.status_code, detail=TOKEN_DETAIL) from None
        if not await _pin_ver_matches(payload, cid):
            raise HTTPException(status_code=401, detail=TOKEN_DETAIL)
        return OperatorName(str(payload.get("oname") or "").strip(), str(payload.get("otype") or ""), str(payload.get("oid") or ""))
    return await caller_display_name(user)


async def record_wo_action(user: Any, w: Optional[dict], who: Any) -> None:
    if not isinstance(user, dict):
        return
    cid = str((w or {}).get("company_id") or user.get("active_company_id") or "").strip()
    if not cid:
        return
    actor = _actor_id(user)
    atolye_id = actor if shopfloor_accounts.is_atolye_user(user) else ""
    otype = getattr(who, "operator_type", "") or ""
    oid = getattr(who, "operator_id", "") or ""
    wo_id = str((w or {}).get("_id") or "")
    _log(actor, cid, oid, "wo_action")
    await _audit(
        cid, "wo_action",
        actor_user_id=actor, atolye_user_id=atolye_id,
        operator_type=otype, operator_id=oid, wo_id=wo_id,
    )


async def _require_self_pin_role(user: dict, company_id: str) -> None:
    if shopfloor_accounts.is_atolye_user(user):
        shopfloor_accounts.log_denied(user)
        raise HTTPException(status_code=403, detail=shopfloor_accounts.ACTION_DENIED)
    if user.get("is_super_admin"):
        return
    role = await rbac.role_for(user, company_id)
    code = rbac.normalize_role_code(role.get("code") or user.get("role"))
    if code != _SELF_ROLE:
        raise HTTPException(status_code=403, detail=SELF_PIN_DENIED)


async def _require_personnel_editor(user: dict, company_id: str) -> None:
    if shopfloor_accounts.is_atolye_user(user):
        shopfloor_accounts.log_denied(user)
        raise HTTPException(status_code=403, detail=shopfloor_accounts.ACTION_DENIED)
    if user.get("is_super_admin"):
        return
    if rbac.normalize_role_code(user.get("role")) == "admin":
        return
    role = await rbac.role_for(user, company_id)
    perms = role.get("permissions") or {}
    if rbac.level_allows(perms.get("/personnel"), "edit"):
        return
    raise HTTPException(status_code=403, detail=PERSONNEL_PIN_DENIED)


async def _self_target(user: dict, company_id: str) -> tuple:
    emp = await _linked_employee(user, company_id)
    if emp:
        return "employee", emp
    return "user", user


async def set_employee_pin(emp_id: str, req: Optional[dict], user: dict) -> dict:
    emp = await tenant_access.get_tenant_doc(_db, "employees", emp_id, user, not_found=NOT_FOUND_EMP)
    cid = str(emp.get("company_id") or "")
    await _require_personnel_editor(user, cid)
    pin = _read_pin(req or {})
    _require_set_pin(pin)
    await _write_employee_pin(emp_id, cid, pin)
    _log(_actor_id(user), cid, emp_id, "pin_set")
    await _audit(
        cid, "pin_set",
        actor_user_id=_actor_id(user), operator_type="employee", operator_id=emp_id,
    )
    return {"status": "success", "has_shopfloor_pin": True, "message": "Atölye şifresi kaydedildi."}


async def clear_employee_pin(emp_id: str, user: dict) -> dict:
    emp = await tenant_access.get_tenant_doc(_db, "employees", emp_id, user, not_found=NOT_FOUND_EMP)
    cid = str(emp.get("company_id") or "")
    await _require_personnel_editor(user, cid)
    await _clear_employee_pin(emp_id, cid)
    _log(_actor_id(user), cid, emp_id, "pin_cleared")
    await _audit(
        cid, "pin_cleared",
        actor_user_id=_actor_id(user), operator_type="employee", operator_id=emp_id,
    )
    return {"status": "success", "has_shopfloor_pin": False, "message": "Atölye PIN'i kaldırıldı."}


@router.put("/auth/me/shopfloor-pin")
async def put_my_shopfloor_pin(req: dict, user: dict = Depends(_user_dep)):
    body = req or {}
    cid = tenant_access.resolve_company_id(user, body.get("company_id"))
    await _require_self_pin_role(user, cid)
    pin = _read_pin(body)
    confirm = body.get("pin_confirm")
    if confirm is not None and str(confirm) != pin:
        raise HTTPException(status_code=400, detail=PIN_MISMATCH)
    _require_set_pin(pin)
    kind, doc = await _self_target(user, cid)
    if kind == "employee":
        await _write_employee_pin(doc["_id"], cid, pin)
        oid, otype = doc["_id"], "employee"
    else:
        await _write_user_pin(_actor_id(user), cid, pin)
        oid, otype = _actor_id(user), "user"
    _log(_actor_id(user), cid, oid, "pin_set")
    await _audit(cid, "pin_set", actor_user_id=_actor_id(user), operator_type=otype, operator_id=oid)
    return {"status": "success", "has_shopfloor_pin": True}


@router.delete("/auth/me/shopfloor-pin")
async def delete_my_shopfloor_pin(user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, None)
    await _require_self_pin_role(user, cid)
    kind, doc = await _self_target(user, cid)
    if kind == "employee":
        await _clear_employee_pin(doc["_id"], cid)
        oid, otype = doc["_id"], "employee"
    else:
        await _clear_user_pin(_actor_id(user), cid)
        oid, otype = _actor_id(user), "user"
    _log(_actor_id(user), cid, oid, "pin_cleared")
    await _audit(cid, "pin_cleared", actor_user_id=_actor_id(user), operator_type=otype, operator_id=oid)
    return {"status": "success", "has_shopfloor_pin": False}


@router.delete("/personnel/employees/{emp_id}/shopfloor-pin")
async def delete_employee_shopfloor_pin(emp_id: str, user: dict = Depends(_user_dep)):
    await tenant_access.get_tenant_doc(_db, "employees", emp_id, user, not_found=NOT_FOUND_EMP)
    return await clear_employee_pin(emp_id, user)


@router.get("/production/work-orders/shopfloor-operators")
async def list_shopfloor_operators(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    employees = await _db.employees.find({"company_id": cid, "status": "active"}).to_list(500)
    out = []
    seen_emp = set()
    for emp in employees:
        if not emp.get("shopfloor_pin_hash"):
            continue
        if not await employee_is_shopfloor_ready(emp):
            continue
        seen_emp.add(str(emp.get("_id")))
        row = {
            "operator_type": "employee",
            "id": emp.get("_id"),
            "name": emp.get("full_name") or "",
            "has_shopfloor_pin": True,
        }
        station = str(emp.get("station") or "").strip()
        if station:
            row["station"] = station
        out.append(row)
    users = await _db.users.find({"company_ids": cid, "is_active": {"$ne": False}}).to_list(500)
    for person in users:
        if shopfloor_accounts.is_atolye_user(person):
            continue
        if not person.get("shopfloor_pin_hash"):
            continue
        if not _list_role(person):
            continue
        linked = str(person.get("employee_id") or "").strip()
        if linked:
            continue
        out.append({
            "operator_type": "user",
            "id": person.get("_id"),
            "name": person.get("name") or "",
            "has_shopfloor_pin": True,
        })
    return out
