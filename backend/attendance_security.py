"""Mesai giriş hatırlatması ve kayıtlı telefon kilidi.

İlk hatırlatma mesai başlangıcından 5 dk önce.
İkincisi, giriş hâlâ yoksa ilkinden 15 dk sonra (başlangıç + 10 dk).
Saatler firma saat dilimine göredir; varsayılan Europe/Istanbul.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional
from zoneinfo import ZoneInfo

REMIND_BEFORE_MIN = 5
REMIND_GAP_MIN = 15
REMIND_WINDOW_MIN = 1
CHECKIN_TITLE = "Giriş yapmayı unutma"
CHECKOUT_TITLE = "Çıkış hatırlatması"
CHECKIN_LINK = "/mesai"
PUNCH_AUTH_MODES = ("off", "pin", "biometric", "either")
_BLOCK_STATUS = ("leave", "absent", "holiday", "off")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hm_minutes(hm: str) -> int:
    text = str(hm or "")[:5]
    hour, minute = text.split(":")
    return int(hour) * 60 + int(minute)


def local_clock(moment: datetime, timezone_name: Optional[str] = None) -> tuple[str, str, int]:
    """UTC anını firma saat diliminde tarih, HH:MM ve haftanın günü olarak verir."""
    name = (timezone_name or "Europe/Istanbul").strip() or "Europe/Istanbul"
    try:
        zone = ZoneInfo(name)
    except Exception:
        zone = ZoneInfo("Europe/Istanbul")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    local = moment.astimezone(zone)
    return local.strftime("%Y-%m-%d"), local.strftime("%H:%M"), local.weekday()


def _in_slot(now_min: int, target_min: int, window: int) -> bool:
    target = target_min % (24 * 60)
    span = max(0, int(window))
    for delta in range(span + 1):
        if now_min == (target + delta) % (24 * 60):
            return True
    return False


def checkin_reminder_kind(
    now_hm: str,
    start_hm: str,
    *,
    checked_in: bool,
    eligible: bool,
    window: int = 0,
) -> Optional[str]:
    """'before' | 'after' | None. Giriş varsa veya gün uygun değilse None."""
    if not eligible or checked_in:
        return None
    try:
        now_m = hm_minutes(now_hm)
        start_m = hm_minutes(start_hm)
    except Exception:
        return None
    before = start_m - REMIND_BEFORE_MIN
    after = before + REMIND_GAP_MIN
    if _in_slot(now_m, before, window):
        return "before"
    if _in_slot(now_m, after, window):
        return "after"
    return None


def checkout_reminder_due(
    now_hm: str,
    end_hm: str,
    *,
    checked_in: bool,
    checked_out: bool,
    eligible: bool,
    window: int = 0,
) -> bool:
    if not eligible or not checked_in or checked_out:
        return False
    try:
        return _in_slot(hm_minutes(now_hm), hm_minutes(end_hm), window)
    except Exception:
        return False


def company_reminder_on(schedule: Optional[dict], key: str, default: bool) -> bool:
    if not isinstance(schedule, dict) or key not in schedule or schedule.get(key) is None:
        return default
    return bool(schedule.get(key))


def employee_reminder_on(company_on: bool, employee_flag: Any) -> bool:
    """Firma kapalıysa kimseye gitmez. Açıksa personel False ile kapatabilir."""
    if employee_flag is False:
        return False
    return bool(company_on)


def shift_context(schedule: Optional[dict], weekday: int, plan: Optional[dict]) -> dict:
    """Vardiya yok, tatil (plan.off) veya çalışma günü değilse eligible False."""
    sch = schedule or {}
    if plan:
        if plan.get("off"):
            return {"eligible": False, "reason": "holiday", "start": None, "end": None}
        days = sch.get("days") or {}
        day = days.get(str(weekday)) or {}
        start = str(plan.get("start") or day.get("start") or sch.get("start") or "09:00")[:5]
        end = str(plan.get("end") or day.get("end") or sch.get("end") or "18:00")[:5]
        return {"eligible": True, "reason": "plan", "start": start, "end": end}
    work_days = sch.get("work_days") if isinstance(sch.get("work_days"), list) else [0, 1, 2, 3, 4]
    if weekday not in work_days:
        return {"eligible": False, "reason": "no_shift", "start": None, "end": None}
    days = sch.get("days") or {}
    day = days.get(str(weekday)) or {}
    start = str(day.get("start") or sch.get("start") or "09:00")[:5]
    end = str(day.get("end") or sch.get("end") or "18:00")[:5]
    return {"eligible": True, "reason": "schedule", "start": start, "end": end}


def day_reminder_eligible(
    *,
    skip_check_in: bool,
    on_leave: bool,
    attendance_status: Optional[str],
    shift_ok: bool,
) -> bool:
    if skip_check_in or on_leave or not shift_ok:
        return False
    if str(attendance_status or "").lower() in _BLOCK_STATUS:
        return False
    return True


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "evet", "on")
    return False


def clean_device_id(raw: Any) -> str:
    text = str(raw or "").strip()[:80]
    if not text or any(ch.isspace() for ch in text):
        return ""
    return text


def normalize_punch_auth(raw: Any) -> str:
    mode = str(raw or "off").strip().lower()
    return mode if mode in PUNCH_AUTH_MODES else "off"


def registered_device_required(schedule: Optional[dict]) -> bool:
    if not isinstance(schedule, dict) or "require_registered_device" not in schedule:
        return True
    return bool(schedule.get("require_registered_device"))


def evaluate_device(
    devices: list,
    *,
    employee_id: str,
    device_id: str,
    is_mock: bool,
    is_rooted: bool,
    punch_auth_ok: bool,
    require_punch_auth: str,
    require_device: bool,
) -> dict:
    """allow + reason. bind = ilk telefon; pending = cihaz değişikliği."""
    if not require_device:
        return {"allow": True, "reason": "disabled", "detail": "", "bind": False, "pending": False}
    if not device_id:
        return {
            "allow": False, "reason": "device_required", "bind": False, "pending": False,
            "detail": "Giriş yalnızca kayıtlı telefondan yapılabilir.",
        }
    if is_mock:
        return {
            "allow": False, "reason": "mock_location", "bind": False, "pending": False,
            "detail": "Sahte konum algılandı. Giriş reddedildi.",
        }
    if is_rooted:
        return {
            "allow": False, "reason": "rooted", "bind": False, "pending": False,
            "detail": "Rootlu veya jailbreak yapılmış cihazdan giriş reddedildi.",
        }
    mode = normalize_punch_auth(require_punch_auth)
    if mode != "off" and not punch_auth_ok:
        return {
            "allow": False, "reason": "punch_auth_required", "bind": False, "pending": False,
            "detail": "Giriş için biyometrik veya PIN doğrulaması gerekli.",
        }
    active = [d for d in devices if (d or {}).get("status") == "active"]
    mine = [d for d in active if str(d.get("employee_id") or "") == employee_id]
    others = [d for d in active if str(d.get("device_id") or "") == device_id and str(d.get("employee_id") or "") != employee_id]
    if others:
        return {
            "allow": False, "reason": "device_other_employee", "bind": False, "pending": False,
            "detail": "Bu telefon başka bir personele kayıtlı. Giriş reddedildi.",
        }
    pending = [
        d for d in devices
        if (d or {}).get("status") == "pending"
        and str(d.get("employee_id") or "") == employee_id
        and str(d.get("device_id") or "") == device_id
    ]
    if pending:
        return {
            "allow": False, "reason": "device_pending", "bind": False, "pending": False,
            "detail": "Cihaz değişikliği yönetici onayı bekliyor.",
        }
    if any(str(d.get("device_id") or "") == device_id for d in mine):
        return {"allow": True, "reason": "matched", "detail": "", "bind": False, "pending": False}
    if mine:
        return {
            "allow": False, "reason": "device_change", "bind": False, "pending": True,
            "detail": "Bu telefon kayıtlı değil. Cihaz değişikliği yönetici onayı bekliyor.",
        }
    return {"allow": True, "reason": "bind", "detail": "", "bind": True, "pending": False}


def device_row_id(employee_id: str, device_id: str, pending: bool = False) -> str:
    prefix = "devpend" if pending else "devbind"
    return f"{prefix}:{employee_id}:{device_id}"[:160]


def _device_doc(company_id: str, employee: dict, device_id: str, req: dict, status: str) -> dict:
    return {
        "_id": device_row_id(employee["_id"], device_id, pending=status == "pending"),
        "company_id": company_id,
        "employee_id": employee["_id"],
        "employee_name": employee.get("full_name") or "",
        "user_id": employee.get("user_id"),
        "device_id": device_id,
        "status": status,
        "platform": str((req or {}).get("platform") or "")[:40],
        "label": str((req or {}).get("device_label") or "")[:80],
        "created_at": _now(),
        "updated_at": _now(),
    }


async def _event(db, company_id: str, employee_id: str, device_id: str, kind: str, detail: str) -> None:
    await db.attendance_device_events.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "employee_id": employee_id,
        "device_id": device_id,
        "type": kind,
        "detail": detail[:240],
        "created_at": _now(),
    })


async def _notify(notify, company_id: str, title: str, message: str, dedupe_key: str) -> None:
    if notify is None:
        return
    try:
        await notify(company_id, "attendance_device", title, message, link="/personnel?tab=attendance", dedupe_key=dedupe_key)
    except Exception:
        return


async def gate_self_punch(
    db,
    *,
    company_id: str,
    employee: dict,
    schedule: Optional[dict],
    req: Optional[dict],
    notify: Optional[Callable[..., Awaitable[Any]]] = None,
    today: Optional[str] = None,
) -> dict:
    """Girişi yazmadan önce cihaz kararını verir. Reddederse kayıt açmaz, yöneticiye haber verir."""
    sch = schedule or {}
    body = req or {}
    decision = evaluate_device(
        [],
        employee_id=str(employee.get("_id") or ""),
        device_id=clean_device_id(body.get("device_id")),
        is_mock=as_bool(body.get("is_mock")),
        is_rooted=as_bool(body.get("is_rooted")),
        punch_auth_ok=as_bool(body.get("punch_auth")),
        require_punch_auth=normalize_punch_auth(sch.get("require_punch_auth")),
        require_device=registered_device_required(sch),
    )
    if decision["reason"] == "disabled":
        return {**decision, "bind_doc": None}
    device_id = clean_device_id(body.get("device_id"))
    rows = []
    if device_id:
        rows.extend(await db.attendance_devices.find({"device_id": device_id}).to_list(20))
    mine = await db.attendance_devices.find({"employee_id": employee.get("_id"), "status": {"$in": ["active", "pending"]}}).to_list(20)
    seen = {r.get("_id") for r in rows}
    for row in mine:
        if row.get("_id") not in seen:
            rows.append(row)
    decision = evaluate_device(
        rows,
        employee_id=str(employee.get("_id") or ""),
        device_id=device_id,
        is_mock=as_bool(body.get("is_mock")),
        is_rooted=as_bool(body.get("is_rooted")),
        punch_auth_ok=as_bool(body.get("punch_auth")),
        require_punch_auth=normalize_punch_auth(sch.get("require_punch_auth")),
        require_device=True,
    )
    day = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    name = employee.get("full_name") or "Personel"
    emp_id = str(employee.get("_id") or "")
    if decision["reason"] in ("mock_location", "rooted", "device_other_employee", "device_required"):
        await _event(db, company_id, emp_id, device_id, decision["reason"], decision["detail"])
        await _notify(
            notify, company_id,
            f"Mesai girişi reddedildi: {name}",
            f"{name} — {decision['detail']}",
            dedupe_key=f"device-reject:{decision['reason']}:{emp_id}:{device_id or '-'}:{day}",
        )
        return {**decision, "bind_doc": None}
    if decision["pending"]:
        doc = _device_doc(company_id, employee, device_id, body, "pending")
        existing = await db.attendance_devices.find_one({"_id": doc["_id"]})
        if not existing:
            await db.attendance_devices.insert_one(doc)
        await _event(db, company_id, emp_id, device_id, "change_requested", decision["detail"])
        await _notify(
            notify, company_id,
            f"Cihaz değişikliği: {name}",
            f"{name} yeni bir telefondan giriş denedi. Onay olmadan giriş yapılmadı.",
            dedupe_key=f"device-change:{emp_id}:{device_id}:{day}",
        )
        return {**decision, "bind_doc": None}
    bind_doc = _device_doc(company_id, employee, device_id, body, "active") if decision["bind"] else None
    return {**decision, "bind_doc": bind_doc}


async def commit_device_bind(db, gate: Optional[dict]) -> None:
    doc = (gate or {}).get("bind_doc")
    if not doc:
        if (gate or {}).get("reason") == "matched":
            return
        return
    current = await db.attendance_devices.find_one({"_id": doc["_id"]})
    if current and current.get("status") == "active":
        await db.attendance_devices.update_one({"_id": doc["_id"]}, {"$set": {"updated_at": _now(), "last_seen_at": _now()}})
        return
    if current:
        await db.attendance_devices.update_one({"_id": doc["_id"]}, {"$set": {**doc, "status": "active", "last_seen_at": _now()}})
    else:
        doc = {**doc, "last_seen_at": _now()}
        await db.attendance_devices.insert_one(doc)
    await _event(db, doc["company_id"], doc["employee_id"], doc["device_id"], "bound", "İlk telefon kaydedildi.")


async def claim_once(db, company_id: str, key: str) -> bool:
    _id = f"{company_id}:{key}"
    if await db.attendance_alerts.find_one({"_id": _id}):
        return False
    try:
        await db.attendance_alerts.insert_one({
            "_id": _id, "company_id": company_id, "type": key.split(":")[0], "created_at": _now(),
        })
    except Exception:
        return False
    return True


async def _on_leave(db, employee_id: str, date: str) -> bool:
    row = await db.leave_requests.find_one({
        "employee_id": employee_id,
        "status": "approved",
        "start_date": {"$lte": date},
        "end_date": {"$gte": date},
    })
    return bool(row)


async def run_reminders(
    db,
    merge_schedule: Callable[..., dict],
    send: Callable[..., Awaitable[Any]],
    *,
    company_id: Optional[str] = None,
    now_utc: Optional[datetime] = None,
    window: int = REMIND_WINDOW_MIN,
) -> list:
    moment = now_utc or datetime.now(timezone.utc)
    query = {"_id": company_id} if company_id else {}
    companies = await db.companies.find(query).to_list(500)
    sent = []
    for company in companies:
        base = merge_schedule(company)
        tz_name = base.get("timezone") or "Europe/Istanbul"
        date, hm, weekday = local_clock(moment, tz_name)
        employees = await db.employees.find({"company_id": company["_id"], "status": "active"}).to_list(300)
        for emp in employees:
            sch = merge_schedule(company, emp)
            plan = await db.shift_plans.find_one({"employee_id": emp["_id"], "date": date})
            shift = shift_context(sch, weekday, plan)
            rec = await db.attendance.find_one({"employee_id": emp["_id"], "date": date}) or {}
            on_leave = await _on_leave(db, emp["_id"], date)
            base_ok = day_reminder_eligible(
                skip_check_in=bool(sch.get("skip_check_in") or emp.get("skip_check_in")),
                on_leave=on_leave,
                attendance_status=rec.get("status"),
                shift_ok=bool(shift["eligible"]),
            )
            checked_in = bool(str(rec.get("check_in") or "").strip())
            checked_out = bool(str(rec.get("check_out") or "").strip())
            checkin_on = employee_reminder_on(
                company_reminder_on(sch, "notify_checkin_reminder", True),
                emp.get("notify_checkin_reminder"),
            )
            kind = checkin_reminder_kind(
                hm, shift.get("start") or "",
                checked_in=checked_in,
                eligible=base_ok and checkin_on and bool(shift.get("start")),
                window=window,
            )
            if kind:
                key = f"remind-{kind}:{emp['_id']}:{date}"
                if await claim_once(db, company["_id"], key):
                    start = shift.get("start")
                    if kind == "before":
                        message = f"Mesainiz {start}’te başlıyor. Giriş ekranını açmak için bildirime dokunun."
                    else:
                        message = f"Mesai {start}’te başladı, giriş görünmüyor. Giriş yapmayı unutmayın."
                    await send(
                        emp, kind, CHECKIN_TITLE, message, CHECKIN_LINK,
                    )
                    sent.append({"employee_id": emp["_id"], "kind": kind, "date": date, "hm": hm, "timezone": tz_name})
            checkout_on = employee_reminder_on(
                company_reminder_on(sch, "notify_checkout_reminder", False),
                emp.get("notify_checkout_reminder"),
            )
            if checkout_reminder_due(
                hm, shift.get("end") or "",
                checked_in=checked_in, checked_out=checked_out,
                eligible=base_ok and checkout_on and bool(shift.get("end")),
                window=window,
            ):
                key = f"remind-out:{emp['_id']}:{date}"
                if await claim_once(db, company["_id"], key):
                    end = shift.get("end")
                    await send(
                        emp, "checkout", CHECKOUT_TITLE,
                        f"Mesai bitiş saatiniz ({end}) geldi. Mesaim ekranını açabilirsiniz.",
                        CHECKIN_LINK,
                    )
                    sent.append({"employee_id": emp["_id"], "kind": "checkout", "date": date, "hm": hm, "timezone": tz_name})
    return sent


def prefs_view(schedule: Optional[dict], employee: Optional[dict]) -> dict:
    sch = schedule or {}
    emp = employee or {}
    company_in = company_reminder_on(sch, "notify_checkin_reminder", True)
    company_out = company_reminder_on(sch, "notify_checkout_reminder", False)
    return {
        "timezone": sch.get("timezone") or "Europe/Istanbul",
        "require_punch_auth": normalize_punch_auth(sch.get("require_punch_auth")),
        "require_registered_device": registered_device_required(sch),
        "company_checkin_reminder": company_in,
        "company_checkout_reminder": company_out,
        "employee_checkin_reminder": emp.get("notify_checkin_reminder"),
        "employee_checkout_reminder": emp.get("notify_checkout_reminder"),
        "notify_checkin_reminder": employee_reminder_on(company_in, emp.get("notify_checkin_reminder")),
        "notify_checkout_reminder": employee_reminder_on(company_out, emp.get("notify_checkout_reminder")),
    }


def manager_user(user: Optional[dict]) -> bool:
    role = str((user or {}).get("role") or "").lower()
    return bool((user or {}).get("is_super_admin") or role in ("admin", "manager", "accountant", "owner"))


async def list_devices(db, company_id: str) -> dict:
    rows = await db.attendance_devices.find({"company_id": company_id}).to_list(400)
    rows.sort(key=lambda r: str(r.get("updated_at") or r.get("created_at") or ""), reverse=True)
    events = await db.attendance_device_events.find({"company_id": company_id}).to_list(80)
    events.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    devices = []
    for row in rows:
        if row.get("status") not in ("active", "pending", "revoked"):
            continue
        devices.append({
            "id": row.get("_id"),
            "employee_id": row.get("employee_id"),
            "employee_name": row.get("employee_name") or "",
            "device_id": row.get("device_id"),
            "status": row.get("status"),
            "platform": row.get("platform") or "",
            "label": row.get("label") or "",
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "approved_at": row.get("approved_at"),
            "revoked_at": row.get("revoked_at"),
        })
    return {
        "devices": devices,
        "events": [{
            "id": e.get("_id"),
            "employee_id": e.get("employee_id"),
            "device_id": e.get("device_id"),
            "type": e.get("type"),
            "detail": e.get("detail"),
            "created_at": e.get("created_at"),
        } for e in events[:40]],
    }


async def approve_device(db, company_id: str, row_id: str, approver_id: str) -> dict:
    row = await db.attendance_devices.find_one({"_id": row_id, "company_id": company_id})
    if not row:
        return {"ok": False, "status": 404, "detail": "Cihaz kaydı bulunamadı."}
    if row.get("status") != "pending":
        return {"ok": False, "status": 400, "detail": "Yalnız bekleyen cihaz değişikliği onaylanır."}
    clash = await db.attendance_devices.find_one({
        "device_id": row.get("device_id"), "status": "active", "employee_id": {"$ne": row.get("employee_id")},
    })
    if clash:
        return {"ok": False, "status": 409, "detail": "Bu telefon başka bir personele kayıtlı."}
    previous = await db.attendance_devices.find({
        "employee_id": row.get("employee_id"), "status": "active",
    }).to_list(20)
    for old in previous:
        await db.attendance_devices.update_one({"_id": old["_id"]}, {"$set": {
            "status": "revoked", "revoked_at": _now(), "revoked_by": approver_id, "updated_at": _now(),
        }})
        await _event(db, company_id, old.get("employee_id"), old.get("device_id"), "revoked", "Yeni cihaz onaylandı, önceki iptal edildi.")
    await db.attendance_devices.update_one({"_id": row_id}, {"$set": {
        "status": "active", "approved_at": _now(), "approved_by": approver_id, "updated_at": _now(),
    }})
    await _event(db, company_id, row.get("employee_id"), row.get("device_id"), "approved", "Yönetici cihaz değişikliğini onayladı.")
    return {"ok": True, "status": 200, "detail": "Cihaz onaylandı."}


async def revoke_device(db, company_id: str, row_id: str, approver_id: str) -> dict:
    row = await db.attendance_devices.find_one({"_id": row_id, "company_id": company_id})
    if not row:
        return {"ok": False, "status": 404, "detail": "Cihaz kaydı bulunamadı."}
    if row.get("status") == "revoked":
        return {"ok": True, "status": 200, "detail": "Cihaz zaten iptal."}
    await db.attendance_devices.update_one({"_id": row_id}, {"$set": {
        "status": "revoked", "revoked_at": _now(), "revoked_by": approver_id, "updated_at": _now(),
    }})
    await _event(db, company_id, row.get("employee_id"), row.get("device_id"), "revoked", "Yönetici cihaz kaydını iptal etti.")
    return {"ok": True, "status": 200, "detail": "Cihaz iptal edildi."}


def optional_bool(value: Any) -> Any:
    if value is None or value == "":
        return None
    return bool(value)
