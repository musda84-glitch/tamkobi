"""İş devralma uyarısı.

Karar: varsayılan takeover_confirm=device. Onay (409) yalnız atolye
hesabı ve atolye_device ister; ikisi de operatör token'ı ile çalışır.
Klasik web çağrısı kırılmaz: 200 ve takeover=true bayrağı.
takeover_confirm=always herkeste 409, off hiç 409 üretmez.
Kullanıcı dict'i yoksa (doğrudan birim çağrı) klasik yol sayılır.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

import company_audit
import shopfloor_accounts
import shopfloor_pin
import shopfloor_settings

CODE = "takeover_confirm_required"
_RUN_ACTIONS = frozenset({"start", "resume", "pause", "finish", "takeover"})


class _LiveDB:
    def __getattr__(self, name):
        import server
        return getattr(server.db, name)

    def __getitem__(self, name):
        import server
        return server.db[name]


_db = _LiveDB()


def operator_patch(who: Any) -> dict:
    """operator_name korunur. employee token'ında operator_employee_id yazılır."""
    out = {}
    name = str(who or "").strip()
    if name:
        out["operator_name"] = name
    if getattr(who, "operator_type", "") == "employee":
        eid = str(getattr(who, "operator_id", "") or "").strip()
        if eid:
            out["operator_employee_id"] = eid
    return out


def employee_id_of(who: Any) -> str:
    if getattr(who, "operator_type", "") == "employee":
        return str(getattr(who, "operator_id", "") or "").strip()
    return ""


def device_id_of(user: Any) -> str:
    if shopfloor_accounts.is_device_user(user):
        return str((user or {}).get("_id") or (user or {}).get("id") or "")
    return ""


def previous_run(work_order: Optional[dict]) -> Optional[dict]:
    row = work_order or {}
    eid = str(row.get("operator_employee_id") or "").strip()
    name = str(row.get("operator_name") or "").strip()
    if not eid and not name:
        return None
    last = ""
    for item in row.get("logs") or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("action") or "") in _RUN_ACTIONS and item.get("at"):
            last = str(item.get("at"))
    if not last:
        last = str(row.get("paused_at") or row.get("started_at") or "")
    return {"employee_id": eid, "name": name, "last_action_at": last}


def is_different(previous: Optional[dict], who: Any) -> bool:
    if not previous:
        return False
    cur_eid = employee_id_of(who)
    prev_eid = str(previous.get("employee_id") or "").strip()
    cur_name = str(who or "").strip()
    prev_name = str(previous.get("name") or "").strip()
    if cur_eid and prev_eid:
        return cur_eid != prev_eid
    if not prev_name and not prev_eid:
        return False
    return bool(cur_name) and cur_name != prev_name


def confirm_required(user: Any, mode: str) -> bool:
    """device: atolye + cihaz. always: her oturum. off: hiçbiri. Dict yoksa kapalı."""
    if mode == "off":
        return False
    if not isinstance(user, dict):
        return False
    if mode == "always":
        return True
    return shopfloor_accounts.is_atolye_user(user)


def _confirmed(req: Optional[dict]) -> bool:
    body = req or {}
    value = body.get("confirm_takeover")
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in ("1", "true", "yes", "evet")


async def decide(db, work_order: dict, who: Any, req: Optional[dict], user: Any) -> dict:
    """block=True ise çağıran 409 fırlatır. flag=True ise yanıt bayrağı ve kayıt."""
    previous = previous_run(work_order)
    if not is_different(previous, who):
        return {"block": False, "flag": False, "record": False}
    company = await shopfloor_settings.load_company(db, str(work_order.get("company_id") or ""))
    mode = shopfloor_settings.takeover_mode(company)
    confirmed = _confirmed(req)
    required = confirm_required(user, mode)
    payload = {
        "block": False,
        "flag": True,
        "record": True,
        "previous_operator": previous.get("name") or previous.get("employee_id") or "",
        "previous_operator_id": previous.get("employee_id") or "",
        "last_action_at": previous.get("last_action_at") or "",
    }
    if required and not confirmed:
        payload["block"] = True
        payload["record"] = False
        payload["detail"] = {
            "code": CODE,
            "previous_operator": payload["previous_operator"],
            "last_action_at": payload["last_action_at"],
        }
        return payload
    return payload


def raise_if_blocked(decision: dict) -> None:
    if decision.get("block"):
        raise HTTPException(status_code=409, detail=decision.get("detail") or {"code": CODE})


def log_note(decision: dict, who: Any, user: Any) -> str:
    device = device_id_of(user)
    text = f"önceki {decision.get('previous_operator') or ''} → {who}"
    if device:
        text += f" cihaz {device}"
    return text.strip()


async def audit(company_id: str, work_order: dict, who: Any, decision: dict, user: Any) -> None:
    cid = str(company_id or "").strip()
    if not cid or not decision.get("record"):
        return
    device = device_id_of(user)
    summary = (
        f"Devralma: önceki {decision.get('previous_operator') or '-'}, "
        f"yeni {who}"
    )
    if device:
        summary += f", cihaz {device}"
    await company_audit.write(
        _db,
        company_id=cid,
        user=user if isinstance(user, dict) else None,
        module="/atolye",
        action="update",
        record_id=str(work_order.get("_id") or ""),
        record_label=str(work_order.get("step_name") or ""),
        record_no=str(work_order.get("order_code") or ""),
        summary=summary,
        path="/api/production/work-orders/start",
    )
    await shopfloor_pin._audit(
        cid,
        "takeover",
        actor_user_id=shopfloor_pin._actor_id(user) if isinstance(user, dict) else "",
        atolye_user_id=shopfloor_pin._actor_id(user) if isinstance(user, dict) and shopfloor_accounts.is_atolye_user(user) else "",
        operator_type=getattr(who, "operator_type", "") or "",
        operator_id=getattr(who, "operator_id", "") or "",
        wo_id=str(work_order.get("_id") or ""),
    )


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
