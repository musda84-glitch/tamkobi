"""Hızlı Satış kasiyer oturumu, rol kuralları, yönetici onayı ve vardiya."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request

import notify
import rbac
import tenant_access
from auth_utils import hash_password, verify_password
from client_ip import request_ip

router = APIRouter(prefix="/api")
_db = None
_current_user = None
_checkout_hooks: Dict[str, Any] = {}

PIN_RE = re.compile(r"^\d{4,6}$")
PIN_ATTEMPT_LIMIT = 5
PIN_LOCK_MINUTES = 15
PIN_FAIL_MESSAGE = "PIN hatalı."
PIN_TAKEN_MESSAGE = "PIN kaydedilemedi. Farklı bir PIN seçin."
PIN_LOCK_MESSAGE = "Çok fazla hatalı PIN denemesi. Lütfen 15 dakika sonra tekrar deneyin."
SELF_APPROVE_MESSAGE = "Talebi açan kasiyer bu talebi onaylayamaz."
DEFAULT_IDLE_SEC = 120
KIND_LABELS = {
    "delete_line": "Satır silme",
    "cancel_cart": "Sepet iptali",
    "cancel_sale": "Satış iptali",
    "refund": "İade",
    "price_change": "Fiyat değiştirme",
    "discount": "Limit üstü iskonto",
    "out_of_stock": "Stoksuz satış",
    "open_drawer": "Satışsız çekmece",
    "exit": "Hızlı Satış çıkışı",
}
BOOL_RULE_KEYS = (
    "can_change_price",
    "can_refund",
    "can_cancel",
    "can_credit_sale",
    "can_exit",
    "can_delete_line",
    "can_out_of_stock",
    "can_open_drawer",
    "can_approve",
)
RULE_HELP = {
    "can_change_price": "Satır fiyatını katalog dışında değiştirebilir (yönetici onayı gerekmez).",
    "max_discount_pct": "Bu yüzdeye kadar iskonto serbest; üstü yönetici onayı ister.",
    "can_refund": "POS iadesi yapabilir.",
    "can_cancel": "Sepeti veya tamamlanmış satışı iptal edebilir.",
    "can_credit_sale": "Veresiye (cari) satış yapabilir.",
    "can_exit": "Hızlı Satış ekranından yönetici onayı olmadan çıkabilir.",
    "can_delete_line": "Sepet satırını silebilir.",
    "can_out_of_stock": "Stok eksiye düşecek satışı onaylamadan yapabilir.",
    "can_open_drawer": "Satışsız çekmece açabilir.",
    "can_approve": "POS yönetici onaylarını verebilir (PIN veya uzaktan).",
}

RESTRICTED_DEFAULT = {
    "can_change_price": False,
    "max_discount_pct": 0.0,
    "can_refund": False,
    "can_cancel": False,
    "can_credit_sale": False,
    "can_exit": False,
    "can_delete_line": False,
    "can_out_of_stock": False,
    "can_open_drawer": False,
    "can_approve": False,
}
OPEN_DEFAULT = {
    "can_change_price": True,
    "max_discount_pct": 100.0,
    "can_refund": True,
    "can_cancel": True,
    "can_credit_sale": True,
    "can_exit": True,
    "can_delete_line": True,
    "can_out_of_stock": True,
    "can_open_drawer": True,
    "can_approve": True,
}


def init(db, get_current_user=None, hooks: Optional[Dict[str, Any]] = None):
    global _db, _current_user, _checkout_hooks
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user
    if hooks:
        _checkout_hooks = dict(hooks)


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="POS auth bağlanmadı.")
    return await _current_user(request)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user: Optional[dict]) -> str:
    return str((user or {}).get("_id") or (user or {}).get("id") or "")


def _uname(user: Optional[dict]) -> str:
    return str((user or {}).get("name") or (user or {}).get("email") or "Kullanıcı")


def _role_code(user: Optional[dict]) -> str:
    return rbac.normalize_role_code((user or {}).get("role"))


def normalize_pin(pin: Any) -> str:
    s = str(pin or "").strip()
    if not PIN_RE.fullmatch(s):
        raise HTTPException(status_code=400, detail="PIN 4-6 haneli rakam olmalı.")
    return s


def public_user(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    row = dict(doc)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    row["has_cashier_pin"] = bool(row.pop("cashier_pin_hash", None) or doc.get("cashier_pin_hash"))
    row.pop("password_hash", None)
    row.pop("cashier_pin_hash", None)
    return row


def default_pos_rules(role_code: str) -> Dict[str, Any]:
    code = rbac.normalize_role_code(role_code)
    if code in ("admin", "manager"):
        return dict(OPEN_DEFAULT)
    return dict(RESTRICTED_DEFAULT)


def normalize_pos_rules(raw: Optional[dict], role_code: str) -> Dict[str, Any]:
    base = default_pos_rules(role_code)
    src = raw if isinstance(raw, dict) else {}
    out = dict(base)
    for k in BOOL_RULE_KEYS:
        if k in src:
            out[k] = bool(src[k])
    if "max_discount_pct" in src:
        try:
            pct = float(src.get("max_discount_pct") or 0)
        except (TypeError, ValueError):
            pct = 0.0
        out["max_discount_pct"] = max(0.0, min(100.0, pct))
    if rbac.normalize_role_code(role_code) == "admin":
        out.update(OPEN_DEFAULT)
    return out


def idle_timeout_sec(company: Optional[dict]) -> int:
    try:
        n = int((company or {}).get("pos_idle_timeout_sec") or DEFAULT_IDLE_SEC)
    except (TypeError, ValueError):
        n = DEFAULT_IDLE_SEC
    return max(15, min(3600, n))


def session_is_idle(session: Optional[dict], now: Optional[datetime] = None, timeout_sec: int = DEFAULT_IDLE_SEC) -> bool:
    if not session:
        return True
    if session.get("locked"):
        return True
    raw = session.get("last_activity") or session.get("created_at") or ""
    try:
        last = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return (now - last).total_seconds() >= max(1, int(timeout_sec or DEFAULT_IDLE_SEC))


def exit_is_blocked(session: Optional[dict], rules: Optional[dict] = None) -> bool:
    """Hızlı Satış'tan çıkış varsayılan kapalı; can_exit veya verilmiş onay açar."""
    if not session or not session.get("cashier_user_id"):
        return False
    if session.get("exit_granted"):
        return False
    r = rules if rules is not None else (session.get("rules") or {})
    return not bool(r.get("can_exit"))


def refresh_keeps_lock(session: Optional[dict], timeout_sec: int = DEFAULT_IDLE_SEC) -> bool:
    """Sayfa yenileme kilit/çıkış kısıtını atlatamaz."""
    if not session or not session.get("cashier_user_id"):
        return False
    if session.get("ended_at"):
        return False
    if session.get("locked") or session_is_idle(session, timeout_sec=timeout_sec):
        return True
    return exit_is_blocked(session)


def catalog_unit_price(product: dict) -> float:
    return float(product.get("sale_price") or 0)


def line_discount_pct(catalog_price: float, unit_price: float) -> float:
    cat = float(catalog_price or 0)
    if cat <= 0:
        return 0.0
    return max(0.0, round((1.0 - float(unit_price or 0) / cat) * 100.0, 4))


def price_change_needs_approval(rules: dict, catalog_price: float, unit_price: float) -> bool:
    if abs(float(unit_price or 0) - float(catalog_price or 0)) < 0.0001:
        return False
    if float(unit_price or 0) < float(catalog_price or 0):
        pct = line_discount_pct(catalog_price, unit_price)
        if pct - 0.0001 <= float(rules.get("max_discount_pct") or 0):
            return False
        return True
    return not bool(rules.get("can_change_price"))


def action_is_free(rules: dict, kind: str, extra: Optional[dict] = None) -> bool:
    extra = extra or {}
    if kind == "delete_line":
        return bool(rules.get("can_delete_line") or rules.get("can_cancel"))
    if kind == "cancel_cart":
        return bool(rules.get("can_cancel"))
    if kind == "cancel_sale":
        return bool(rules.get("can_cancel"))
    if kind == "refund":
        return bool(rules.get("can_refund"))
    if kind == "price_change":
        return not price_change_needs_approval(
            rules, float(extra.get("catalog_price") or 0), float(extra.get("unit_price") or 0)
        )
    if kind == "discount":
        pct = float(extra.get("discount_pct") or 0)
        return pct - 0.0001 <= float(rules.get("max_discount_pct") or 0)
    if kind == "out_of_stock":
        return bool(rules.get("can_out_of_stock"))
    if kind == "open_drawer":
        return bool(rules.get("can_open_drawer"))
    if kind == "exit":
        return bool(rules.get("can_exit"))
    if kind == "credit_sale":
        return bool(rules.get("can_credit_sale"))
    return False


def public_session(doc: Optional[dict], *, company: Optional[dict] = None) -> Optional[dict]:
    if not doc:
        return None
    timeout = idle_timeout_sec(company)
    locked = bool(doc.get("locked")) or session_is_idle(doc, timeout_sec=timeout)
    row = dict(doc)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    row.pop("supervisor_pin_hash", None)
    row["locked"] = locked
    row["idle_timeout_sec"] = timeout
    row["exit_blocked"] = exit_is_blocked(row)
    row["refresh_lock"] = refresh_keeps_lock(doc, timeout_sec=timeout)
    return row


def public_approval(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    row = dict(doc)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    row["kind_label"] = KIND_LABELS.get(row.get("kind"), row.get("kind"))
    payload = row.get("payload") or {}
    row["summary"] = row.get("summary") or payload.get("summary") or KIND_LABELS.get(row.get("kind"), "")
    return row


def public_event(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    row = dict(doc)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    return row


def public_shift(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    row = dict(doc)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    return row


def public_hold(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    row = dict(doc)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    return row


def empty_cart(customer_name: str = "Perakende Müşteri") -> dict:
    return {"items": [], "customer_name": customer_name or "Perakende Müşteri"}


def cart_snapshot(cart: Optional[dict]) -> dict:
    c = cart if isinstance(cart, dict) else empty_cart()
    items = [dict(x) for x in (c.get("items") or [])]
    return {"items": items, "customer_name": c.get("customer_name") or "Perakende Müşteri"}


def restore_cart_from_snapshot(snapshot: Optional[dict]) -> dict:
    return cart_snapshot(snapshot)


async def _role_doc(company_id: str, code: str) -> dict:
    await rbac.ensure_roles(company_id)
    return await _db.roles.find_one({"company_id": company_id, "code": rbac.normalize_role_code(code)}) or {}


async def rules_for_user(user: dict, company_id: str) -> Dict[str, Any]:
    code = _role_code(user)
    role = await _role_doc(company_id, code)
    return normalize_pos_rules(role.get("pos_rules"), code)


async def _company(company_id: str) -> dict:
    return await _db.companies.find_one({"_id": company_id}) or {}


def _can_manage_rules(user: dict) -> bool:
    return _role_code(user) == "admin" or (user or {}).get("is_super_admin") is True


async def _can_approve(user: dict, company_id: str) -> bool:
    if not user:
        return False
    if _role_code(user) in ("admin", "manager"):
        return True
    rules = await rules_for_user(user, company_id)
    return bool(rules.get("can_approve"))


async def _write_event(
    company_id: str,
    *,
    kind: str,
    summary: str,
    user: Optional[dict] = None,
    cashier: Optional[dict] = None,
    extra: Optional[dict] = None,
):
    uid = _uid(user)
    name = _uname(user)
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "kind": kind,
        "kind_label": KIND_LABELS.get(kind, kind),
        "summary": summary,
        "user_id": uid,
        "user_name": name,
        "cashier_user_id": (cashier or {}).get("id") or (cashier or {}).get("_id") or (extra or {}).get("cashier_user_id"),
        "cashier_name": (cashier or {}).get("name") or (extra or {}).get("cashier_name"),
        "created_at": _now(),
        **(extra or {}),
    }
    await _db.pos_events.insert_one(doc)
    await _db.activity_logs.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "user_id": uid,
        "user_name": name,
        "method": "POS",
        "path": f"/pos/{kind}",
        "module": "/hizli-satis",
        "status": 200,
        "detail": summary,
        "created_at": _now(),
    })
    return doc


async def _session_by_terminal(company_id: str, terminal_id: str) -> Optional[dict]:
    if not terminal_id:
        return None
    return await _db.pos_sessions.find_one({
        "company_id": company_id,
        "terminal_id": terminal_id,
        "ended_at": {"$in": [None, ""]},
    })


async def require_session(company_id: str, terminal_id: str, *, allow_locked: bool = False) -> dict:
    sess = await _session_by_terminal(company_id, terminal_id)
    if not sess or not sess.get("cashier_user_id"):
        raise HTTPException(status_code=403, detail="Kasiyer girişi gerekli.")
    company = await _company(company_id)
    if not allow_locked and session_is_idle(sess, timeout_sec=idle_timeout_sec(company)):
        await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"locked": True, "updated_at": _now()}})
        raise HTTPException(status_code=423, detail="Ekran kilitlendi. PIN ile açın.")
    if sess.get("locked") and not allow_locked:
        raise HTTPException(status_code=423, detail="Ekran kilitlendi. PIN ile açın.")
    return sess


def _parse_dt(raw: Any) -> Optional[datetime]:
    if isinstance(raw, datetime):
        dt = raw
    else:
        try:
            dt = datetime.fromisoformat(str(raw or "").replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _client_ip(request: Optional[Request]) -> str:
    if request is None:
        return "unknown"
    try:
        return request_ip(request) or "unknown"
    except Exception:
        return "unknown"


def _pin_attempt_id(company_id: str, terminal_id: str, ip: str) -> str:
    tid = (terminal_id or "").strip() or "-"
    return f"pospin:{company_id}:{tid}:{ip or 'unknown'}"


async def _guard_pin_attempts(company_id: str, terminal_id: str, request: Optional[Request]) -> str:
    """Şirket + terminal + IP. 5 hatalı denemeden sonra 15 dk 429."""
    ident = _pin_attempt_id(company_id, terminal_id, _client_ip(request))
    row = await _db.login_attempts.find_one({"identifier": ident})
    if row and int(row.get("count") or 0) >= PIN_ATTEMPT_LIMIT:
        last = _parse_dt(row.get("last_attempt"))
        if last and datetime.now(timezone.utc) - last < timedelta(minutes=PIN_LOCK_MINUTES):
            raise HTTPException(status_code=429, detail=PIN_LOCK_MESSAGE)
        await _db.login_attempts.delete_one({"identifier": ident})
    return ident


async def _fail_pin_attempt(ident: str):
    row = await _db.login_attempts.find_one({"identifier": ident})
    now = _now()
    if not row:
        await _db.login_attempts.insert_one({
            "_id": ident,
            "identifier": ident,
            "count": 1,
            "last_attempt": now,
        })
        return
    await _db.login_attempts.update_one(
        {"identifier": ident},
        {"$inc": {"count": 1}, "$set": {"last_attempt": now}},
    )


async def _clear_pin_attempt(ident: str):
    await _db.login_attempts.delete_one({"identifier": ident})


async def _company_pin_users(company_id: str) -> List[dict]:
    return await _db.users.find({
        "is_active": {"$ne": False},
        "is_super_admin": {"$ne": True},
        "cashier_pin_hash": {"$exists": True, "$nin": [None, ""]},
        "$or": [{"active_company_id": company_id}, {"company_ids": company_id}],
    }).to_list(400)


async def _find_user_by_pin(
    company_id: str,
    pin: str,
    *,
    user_id: Optional[str] = None,
    include_approvers: bool = True,
) -> dict:
    """PIN doğrulama. user_id verilirse yalnızca o kullanıcıyla eşleşir; başka hesaba düşmez.
    user_id yoksa ve include_approvers False ise onay yetkilisi PIN taramasıyla açılmaz.
    """
    pin = normalize_pin(pin)
    if user_id:
        target = await _db.users.find_one({
            "_id": str(user_id),
            "is_active": {"$ne": False},
            "is_super_admin": {"$ne": True},
            "$or": [{"active_company_id": company_id}, {"company_ids": company_id}],
        })
        if not target or not verify_password(pin, target.get("cashier_pin_hash") or ""):
            raise HTTPException(status_code=401, detail=PIN_FAIL_MESSAGE)
        return target
    matched = []
    for u in await _company_pin_users(company_id):
        if not verify_password(pin, u.get("cashier_pin_hash") or ""):
            continue
        if not include_approvers and await _can_approve(u, company_id):
            continue
        matched.append(u)
    if len(matched) != 1:
        raise HTTPException(status_code=401, detail=PIN_FAIL_MESSAGE)
    return matched[0]


async def _notify_approval(company_id: str, req_doc: dict):
    actor = req_doc.get("requested_by_name") or "Kasiyer"
    kind_label = KIND_LABELS.get(req_doc.get("kind"), req_doc.get("kind"))
    await notify.insert_notification(_db, notify.notification_doc(
        company_id,
        "pos_approval",
        "POS onay bekliyor",
        f"{actor}: {kind_label}. {req_doc.get('summary') or ''}".strip(),
        link="/hizli-satis?onay=" + str(req_doc.get("_id")),
        roles=("admin", "manager"),
        ref_type="pos_approval",
        ref_id=req_doc.get("_id"),
        extra={"kind": req_doc.get("kind")},
    ))


async def _notify_decision(company_id: str, req_doc: dict, approved: bool, decided_by: dict):
    cashier_id = req_doc.get("requested_by")
    if not cashier_id:
        return
    title = "POS onaylandı" if approved else "POS onay reddedildi"
    kind_label = KIND_LABELS.get(req_doc.get("kind"), req_doc.get("kind"))
    await notify.insert_notification(_db, notify.notification_doc(
        company_id,
        "pos_approval_decision",
        title,
        f"{kind_label}: {req_doc.get('summary') or ''} ({_uname(decided_by)})",
        link="/hizli-satis",
        user_id=cashier_id,
        roles=(),
        ref_type="pos_approval",
        ref_id=req_doc.get("_id"),
    ))


async def queue_approval(
    *,
    company_id: str,
    session: dict,
    kind: str,
    payload: dict,
    summary: str,
    user: dict,
    snapshot: Optional[dict] = None,
) -> dict:
    req_id = str(uuid.uuid4())
    doc = {
        "_id": req_id,
        "company_id": company_id,
        "session_id": session.get("_id"),
        "terminal_id": session.get("terminal_id"),
        "kind": kind,
        "payload": payload or {},
        "snapshot": snapshot or cart_snapshot(session.get("cart")),
        "summary": summary,
        "status": "pending",
        "applied": False,
        "requested_by": session.get("cashier_user_id") or _uid(user),
        "requested_by_name": session.get("cashier_name") or _uname(user),
        "requested_by_email": session.get("cashier_email") or (user or {}).get("email"),
        "created_at": _now(),
    }
    await _db.pos_approvals.insert_one(doc)
    await _write_event(
        company_id, kind=kind, summary=f"Onay istendi: {summary}", user=user,
        extra={"status": "pending", "approval_id": req_id, "cashier_user_id": doc["requested_by"], "cashier_name": doc["requested_by_name"]},
    )
    try:
        await _notify_approval(company_id, doc)
    except Exception:
        pass
    return {
        "status": "pending_approval",
        "request_id": req_id,
        "kind": kind,
        "kind_label": KIND_LABELS.get(kind, kind),
        "message": "Yönetici onayı bekleniyor. İşlem henüz uygulanmadı.",
    }


async def _apply_payload(company_id: str, sess: dict, kind: str, payload: dict) -> dict:
    """Onaylanan eylemi uygula. Sepet değişikliği oturuma yazılır."""
    cart = cart_snapshot(sess.get("cart"))
    items = list(cart.get("items") or [])
    if kind == "delete_line":
        lid = str(payload.get("line_id") or "")
        items = [x for x in items if str(x.get("id")) != lid]
        cart["items"] = items
        await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"cart": cart, "updated_at": _now()}})
        return {"cart": cart}
    if kind == "cancel_cart":
        cart = empty_cart(cart.get("customer_name"))
        await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"cart": cart, "updated_at": _now()}})
        return {"cart": cart}
    if kind == "price_change":
        lid = str(payload.get("line_id") or "")
        price = float(payload.get("unit_price") or 0)
        for it in items:
            if str(it.get("id")) == lid:
                it["unit_price"] = price
                if payload.get("discount_pct") is not None:
                    it["discount_pct"] = float(payload.get("discount_pct") or 0)
        cart["items"] = items
        await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"cart": cart, "updated_at": _now()}})
        return {"cart": cart}
    if kind == "discount":
        lid = str(payload.get("line_id") or "")
        pct = float(payload.get("discount_pct") or 0)
        cat = float(payload.get("catalog_price") or 0)
        for it in items:
            if str(it.get("id")) == lid:
                it["discount_pct"] = pct
                if cat > 0:
                    it["unit_price"] = round(cat * (1 - pct / 100.0), 4)
        cart["items"] = items
        await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"cart": cart, "updated_at": _now()}})
        return {"cart": cart}
    if kind == "exit":
        now = _now()
        await _db.pos_sessions.update_one(
            {"_id": sess["_id"]},
            {"$set": {"exit_granted": True, "locked": True, "ended_at": now, "updated_at": now}},
        )
        return {"exit_granted": True, "ended": True}
    if kind == "open_drawer":
        return {"drawer": "opened"}
    if kind == "out_of_stock":
        # Satış anında preflight bu onayı tüketir; sepet değişmez.
        return {"out_of_stock": True}
    if kind == "refund":
        fn = (_checkout_hooks or {}).get("do_return")
        if not fn:
            raise HTTPException(status_code=500, detail="İade motoru bağlı değil.")
        body = dict(payload or {})
        body.setdefault("company_id", company_id)
        body.setdefault("cashier_user_id", sess.get("cashier_user_id"))
        body.setdefault("cashier_name", sess.get("cashier_name"))
        return await fn(body)
    if kind == "cancel_sale":
        fn = (_checkout_hooks or {}).get("do_cancel_sale")
        if not fn:
            raise HTTPException(status_code=500, detail="Satış iptal motoru bağlı değil.")
        body = dict(payload or {})
        body.setdefault("company_id", company_id)
        body.setdefault("cashier_user_id", sess.get("cashier_user_id"))
        body.setdefault("cashier_name", sess.get("cashier_name"))
        return await fn(body)
    return {"ok": True}


async def _restore_snapshot(sess: dict, snapshot: Optional[dict]):
    cart = restore_cart_from_snapshot(snapshot)
    await _db.pos_sessions.update_one(
        {"_id": sess["_id"]},
        {"$set": {"cart": cart, "exit_granted": False, "updated_at": _now()}},
    )
    return cart


async def decide_approval(
    req_id: str,
    user: dict,
    *,
    approve: bool,
    pin: Optional[str] = None,
    request: Optional[Request] = None,
    terminal_id: Optional[str] = None,
) -> dict:
    doc = await tenant_access.get_tenant_doc(_db, "pos_approvals", req_id, user, not_found="Onay talebi bulunamadı.")
    company_id = doc["company_id"]
    if doc.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Bu talep zaten sonuçlandı.")
    if pin:
        tid = str(terminal_id or doc.get("terminal_id") or _terminal_of({}, request) or "")
        ident = await _guard_pin_attempts(company_id, tid, request)
        try:
            supervisor = await _find_user_by_pin(company_id, pin)
            if str(supervisor.get("_id") or "") == str(doc.get("requested_by") or ""):
                raise HTTPException(status_code=403, detail=SELF_APPROVE_MESSAGE)
            if not await _can_approve(supervisor, company_id):
                raise HTTPException(status_code=403, detail="Bu PIN yönetici onayı veremez.")
        except HTTPException as exc:
            if exc.status_code != 429:
                await _fail_pin_attempt(ident)
            raise
        await _clear_pin_attempt(ident)
        actor = supervisor
        via = "pin"
    else:
        if str(_uid(user)) == str(doc.get("requested_by") or ""):
            raise HTTPException(status_code=403, detail=SELF_APPROVE_MESSAGE)
        if not await _can_approve(user, company_id):
            raise HTTPException(status_code=403, detail="POS onayı için yetkiniz yok.")
        actor = user
        via = "remote"
    sess = await _db.pos_sessions.find_one({"_id": doc.get("session_id")}) or {}
    result = {"status": "rejected"}
    if approve:
        result = await _apply_payload(company_id, sess or doc, doc.get("kind"), doc.get("payload") or {})
        await _db.pos_approvals.update_one({"_id": req_id}, {"$set": {
            "status": "approved",
            "applied": True,
            "decided_at": _now(),
            "decided_by": _uid(actor),
            "decided_by_name": _uname(actor),
            "decided_via": via,
        }})
        await _write_event(
            company_id, kind=doc.get("kind"), summary=f"Onaylandı: {doc.get('summary')}",
            user=actor, extra={"status": "approved", "approval_id": req_id, "via": via},
        )
        try:
            await _notify_decision(company_id, doc, True, actor)
        except Exception:
            pass
        return {"status": "approved", "kind": doc.get("kind"), "result": result, "message": "Onaylandı, işlem uygulandı."}

    if sess:
        await _restore_snapshot(sess, doc.get("snapshot"))
    await _db.pos_approvals.update_one({"_id": req_id}, {"$set": {
        "status": "rejected",
        "applied": False,
        "decided_at": _now(),
        "decided_by": _uid(actor),
        "decided_by_name": _uname(actor),
        "decided_via": via,
    }})
    restored = restore_cart_from_snapshot(doc.get("snapshot"))
    await _write_event(
        company_id, kind=doc.get("kind"), summary=f"Reddedildi: {doc.get('summary')}",
        user=actor, extra={"status": "rejected", "approval_id": req_id, "via": via},
    )
    try:
        await _notify_decision(company_id, doc, False, actor)
    except Exception:
        pass
    return {
        "status": "rejected",
        "kind": doc.get("kind"),
        "cart": restored,
        "message": "Reddedildi; işlem geri alındı.",
    }


async def maybe_gate(kind: str, *, company_id: str, session: dict, user: dict, payload: dict, summary: str, extra: Optional[dict] = None, request: Optional[Request] = None):
    rules = session.get("rules") or await rules_for_user(
        {"role": session.get("cashier_role"), "id": session.get("cashier_user_id")},
        company_id,
    )
    pin = payload.get("supervisor_pin") or payload.get("pin")
    approval_id = payload.get("approval_id")
    if approval_id:
        decided = await _db.pos_approvals.find_one({"_id": approval_id, "company_id": company_id})
        if decided and decided.get("status") == "approved" and decided.get("kind") == kind:
            return None
    if action_is_free(rules, kind, extra):
        return None
    if pin:
        queued = await queue_approval(
            company_id=company_id, session=session, kind=kind, payload=payload,
            summary=summary, user=user, snapshot=cart_snapshot(session.get("cart")),
        )
        return await decide_approval(
            queued["request_id"], user, approve=True, pin=pin,
            request=request, terminal_id=session.get("terminal_id"),
        )
    return await queue_approval(
        company_id=company_id, session=session, kind=kind, payload=payload,
        summary=summary, user=user, snapshot=cart_snapshot(session.get("cart")),
    )


def _terminal_of(req: dict, request: Optional[Request] = None) -> str:
    tid = str((req or {}).get("terminal_id") or "").strip()
    if tid:
        return tid
    if request is not None:
        tid = str(request.headers.get("x-pos-terminal") or "").strip()
    return tid


async def consume_kind_approval(company_id: str, session: dict, kind: str) -> bool:
    """Onaylanmış ve henüz tüketilmemiş talebi işaretle. Yoksa False."""
    doc = await _db.pos_approvals.find_one({
        "company_id": company_id,
        "session_id": session.get("_id"),
        "kind": kind,
        "status": "approved",
        "consumed": {"$ne": True},
    })
    if not doc:
        return False
    await _db.pos_approvals.update_one({"_id": doc["_id"]}, {"$set": {"consumed": True, "consumed_at": _now()}})
    return True


async def preflight_checkout(user: dict, req: dict) -> dict:
    """Satış öncesi: oturum, fiyat, iskonto, stok, veresiye. Extra invoice alanları döner."""
    company_id = tenant_access.resolve_company_id(user, req.get("company_id"))
    terminal_id = _terminal_of(req)
    sess = None
    if terminal_id:
        try:
            sess = await require_session(company_id, terminal_id)
        except HTTPException:
            sess = None
    cashier_role = _role_code(user)
    rules = await rules_for_user(user, company_id)
    if sess:
        rules = sess.get("rules") or rules
        cashier_role = sess.get("cashier_role") or cashier_role
    payment_method = str(req.get("payment_method") or "cash").lower()
    if payment_method in ("credit", "veresiye"):
        payment_method = "credit"
        if not rules.get("can_credit_sale"):
            raise HTTPException(status_code=403, detail="Veresiye satış yetkiniz yok. Yönetici onayı veya rol yetkisi gerekir.")

    items_in = list(req.get("items") or [])
    if not items_in and sess and (sess.get("cart") or {}).get("items"):
        items_in = list((sess.get("cart") or {}).get("items") or [])
        req["items"] = items_in

    stock_short = []
    price_issues = []
    for raw in items_in:
        pid = raw.get("product_id")
        product = await _db.products.find_one({"_id": pid}) if pid else None
        if not product:
            continue
        qty = float(raw.get("quantity") or 0)
        stock = float(product.get("stock_quantity") or 0)
        if product.get("type") != "service" and product.get("track_stock") is not False and stock + 1e-9 < qty:
            stock_short.append(product.get("name") or pid)
        cat = catalog_unit_price(product)
        unit_price = float(raw.get("unit_price") if raw.get("unit_price") is not None else cat)
        if price_change_needs_approval(rules, cat, unit_price):
            price_issues.append(product.get("name") or pid)

    if price_issues:
        if not (sess and await consume_kind_approval(company_id, sess, "price_change")) and not (
            sess and await consume_kind_approval(company_id, sess, "discount")
        ):
            raise HTTPException(
                status_code=403,
                detail=f"Fiyat değiştirme / limit üstü iskonto için yönetici onayı gerekir: {', '.join(price_issues[:3])}",
            )
    if stock_short:
        if not (sess and await consume_kind_approval(company_id, sess, "out_of_stock")):
            if not rules.get("can_out_of_stock"):
                raise HTTPException(
                    status_code=403,
                    detail=f"Stoksuz satış için yönetici onayı gerekir: {', '.join(stock_short[:3])}",
                )

    cash_amount = float(req.get("cash_amount") if req.get("cash_amount") is not None else 0)
    card_amount = float(req.get("card_amount") if req.get("card_amount") is not None else 0)
    tendered = float(req.get("tendered_cash") if req.get("tendered_cash") is not None else 0)
    return {
        "company_id": company_id,
        "session": sess,
        "rules": rules,
        "payment_method": payment_method,
        "cash_amount": cash_amount,
        "card_amount": card_amount,
        "tendered_cash": tendered,
        "cashier_user_id": (sess or {}).get("cashier_user_id") or _uid(user),
        "cashier_name": (sess or {}).get("cashier_name") or _uname(user),
        "cashier_role": cashier_role,
        "shift_id": (sess or {}).get("shift_id"),
        "terminal_id": terminal_id,
    }


async def preflight_return(user: dict, req: dict) -> dict:
    company_id = tenant_access.resolve_company_id(user, req.get("company_id"))
    terminal_id = _terminal_of(req)
    sess = None
    if terminal_id:
        try:
            sess = await require_session(company_id, terminal_id)
        except HTTPException:
            sess = None
    rules = (sess or {}).get("rules") or await rules_for_user(user, company_id)
    if not rules.get("can_refund"):
        if not (sess and await consume_kind_approval(company_id, sess, "refund")):
            raise HTTPException(status_code=403, detail="İade için yönetici onayı gerekir.")
    return {
        "company_id": company_id,
        "session": sess,
        "cashier_user_id": (sess or {}).get("cashier_user_id") or _uid(user),
        "cashier_name": (sess or {}).get("cashier_name") or _uname(user),
    }


async def on_checkout_done(user: dict, invoice: dict, meta: dict):
    company_id = invoice.get("company_id")
    await _write_event(
        company_id,
        kind="sale",
        summary=f"Satış {invoice.get('invoice_number')} · {invoice.get('grand_total')} ₺ · {meta.get('payment_method')}",
        user=user,
        extra={
            "invoice_id": invoice.get("_id"),
            "invoice_number": invoice.get("invoice_number"),
            "amount": invoice.get("grand_total"),
            "payment_method": meta.get("payment_method"),
            "cashier_user_id": meta.get("cashier_user_id"),
            "cashier_name": meta.get("cashier_name"),
            "shift_id": meta.get("shift_id"),
        },
    )
    sess = meta.get("session")
    if sess:
        await _db.pos_sessions.update_one(
            {"_id": sess["_id"]},
            {"$set": {"cart": empty_cart(), "last_activity": _now(), "updated_at": _now()}},
        )
    if meta.get("shift_id"):
        inc = {}
        pay = str(meta.get("payment_method") or "")
        grand = float(invoice.get("grand_total") or 0)
        cash_amt = float(meta.get("cash_amount") or 0)
        card_amt = float(meta.get("card_amount") or 0)
        if pay == "mixed":
            inc["sales_cash"] = cash_amt
            inc["sales_card"] = card_amt
        elif pay == "card":
            inc["sales_card"] = grand
        elif pay == "credit":
            inc["sales_credit"] = grand
        else:
            inc["sales_cash"] = grand
        inc["sales_count"] = 1
        if inc:
            await _db.pos_shifts.update_one({"_id": meta["shift_id"]}, {"$inc": inc, "$set": {"updated_at": _now()}})


async def on_return_done(user: dict, original: dict, return_inv: dict, meta: dict):
    company_id = original.get("company_id")
    await _write_event(
        company_id,
        kind="refund",
        summary=f"İade {original.get('invoice_number')} → {return_inv.get('invoice_number')} · {original.get('grand_total')} ₺",
        user=user,
        extra={
            "invoice_id": original.get("_id"),
            "invoice_number": original.get("invoice_number"),
            "return_invoice_id": return_inv.get("_id"),
            "amount": original.get("grand_total"),
            "cashier_user_id": meta.get("cashier_user_id"),
            "cashier_name": meta.get("cashier_name"),
        },
    )
    if meta.get("shift_id") or (meta.get("session") or {}).get("shift_id"):
        sid = meta.get("shift_id") or (meta.get("session") or {}).get("shift_id")
        await _db.pos_shifts.update_one(
            {"_id": sid},
            {"$inc": {"refunds_amount": float(original.get("grand_total") or 0), "refunds_count": 1}, "$set": {"updated_at": _now()}},
        )


async def send_daily_summary(company_id: str, *, force: bool = False) -> dict:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = await _db.pos_events.find_one({
        "company_id": company_id, "kind": "daily_summary", "day": today,
    })
    if existing and not force:
        return {"status": "already", "day": today}
    start = f"{today}T00:00:00"
    events = await _db.pos_events.find({
        "company_id": company_id,
        "created_at": {"$gte": start},
        "kind": {"$in": ["cancel_sale", "cancel_cart", "refund"]},
    }).to_list(2000)
    cancels = [e for e in events if e.get("kind") in ("cancel_sale", "cancel_cart")]
    refunds = [e for e in events if e.get("kind") == "refund"]
    c_amt = round(sum(float(e.get("amount") or 0) for e in cancels), 2)
    r_amt = round(sum(float(e.get("amount") or 0) for e in refunds), 2)
    msg = f"Bugün {len(cancels)} iptal ({c_amt:,.2f} ₺), {len(refunds)} iade ({r_amt:,.2f} ₺)."
    await notify.insert_notification(_db, notify.notification_doc(
        company_id, "pos_daily_summary",
        "Günlük POS iptal / iade özeti",
        msg, link="/settings?tab=pos_rules",
        roles=("admin", "manager"),
        ref_type="pos_daily_summary",
        extra={"day": today, "cancels": len(cancels), "refunds": len(refunds)},
    ))
    await _write_event(company_id, kind="daily_summary", summary=msg, extra={"day": today, "cancels": len(cancels), "refunds": len(refunds)})
    return {"status": "sent", "day": today, "cancels": len(cancels), "refunds": len(refunds), "message": msg}


def mixed_change(grand: float, cash_amount: float, card_amount: float, tendered_cash: float) -> Tuple[float, float, float]:
    g = round(float(grand or 0), 2)
    cash = round(float(cash_amount or 0), 2)
    card = round(float(card_amount or 0), 2)
    tend = round(float(tendered_cash or 0), 2)
    if cash <= 0 and card <= 0:
        cash = g
    if abs(cash + card - g) > 0.05 and card == 0:
        card = round(max(0.0, g - cash), 2)
        cash = round(g - card, 2)
    change = round(max(0.0, tend - cash), 2) if tend > 0 else 0.0
    return cash, card, change


# ---------------- routes ----------------
@router.get("/pos/rules")
async def get_pos_rules(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    await rbac.ensure_roles(cid)
    roles = await _db.roles.find({"company_id": cid}).to_list(100)
    company = await _company(cid)
    out = []
    for r in roles:
        row = {"id": str(r.get("_id") or r.get("id")), "code": r.get("code"), "name": r.get("name"), "is_system": bool(r.get("is_system"))}
        row["pos_rules"] = normalize_pos_rules(r.get("pos_rules"), r.get("code") or "")
        out.append(row)
    return {
        "roles": out,
        "rule_meta": [
            {"key": "can_change_price", "label": "Fiyat değiştirme", "type": "bool", "help": RULE_HELP["can_change_price"]},
            {"key": "max_discount_pct", "label": "En fazla iskonto %", "type": "number", "help": RULE_HELP["max_discount_pct"]},
            {"key": "can_refund", "label": "İade", "type": "bool", "help": RULE_HELP["can_refund"]},
            {"key": "can_cancel", "label": "İptal (sepet / satış)", "type": "bool", "help": RULE_HELP["can_cancel"]},
            {"key": "can_credit_sale", "label": "Veresiye satış", "type": "bool", "help": RULE_HELP["can_credit_sale"]},
            {"key": "can_exit", "label": "Çıkış serbest", "type": "bool", "help": RULE_HELP["can_exit"]},
            {"key": "can_delete_line", "label": "Satır silme", "type": "bool", "help": RULE_HELP["can_delete_line"]},
            {"key": "can_out_of_stock", "label": "Stoksuz satış", "type": "bool", "help": RULE_HELP["can_out_of_stock"]},
            {"key": "can_open_drawer", "label": "Satışsız çekmece", "type": "bool", "help": RULE_HELP["can_open_drawer"]},
            {"key": "can_approve", "label": "Yönetici onayı verebilir", "type": "bool", "help": RULE_HELP["can_approve"]},
        ],
        "idle_timeout_sec": idle_timeout_sec(company),
        "my_rules": await rules_for_user(user, cid),
    }


@router.put("/pos/rules")
async def put_pos_rules(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    if not _can_manage_rules(user):
        raise HTTPException(status_code=403, detail="Hızlı Satış kurallarını yalnızca yönetici değiştirebilir.")
    upd_company: Dict[str, Any] = {}
    if "idle_timeout_sec" in req:
        upd_company["pos_idle_timeout_sec"] = idle_timeout_sec({"pos_idle_timeout_sec": req.get("idle_timeout_sec")})
    if upd_company:
        await _db.companies.update_one({"_id": cid}, {"$set": {**upd_company, "updated_at": _now()}})
    saved = []
    for item in req.get("roles") or []:
        rid = item.get("id") or item.get("_id")
        code = item.get("code")
        role = None
        if rid:
            role = await tenant_access.get_tenant_doc(_db, "roles", rid, user, not_found="Rol bulunamadı.")
        elif code:
            role = await _db.roles.find_one({"company_id": cid, "code": code})
        if not role:
            continue
        rules = normalize_pos_rules(item.get("pos_rules") or item, role.get("code") or "")
        await _db.roles.update_one({"_id": role["_id"]}, {"$set": {"pos_rules": rules, "updated_at": _now()}})
        saved.append({"id": str(role["_id"]), "code": role.get("code"), "pos_rules": rules})
    return {"status": "success", "roles": saved, "idle_timeout_sec": idle_timeout_sec(await _company(cid))}


@router.get("/pos/cashiers")
async def list_cashiers(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    await rbac.ensure_roles(cid)
    roles = {r["code"]: r for r in await _db.roles.find({"company_id": cid}).to_list(100)}
    users = await _db.users.find({
        "is_active": {"$ne": False},
        "is_super_admin": {"$ne": True},
        "$or": [{"active_company_id": cid}, {"company_ids": cid}],
    }).to_list(400)
    out = []
    for u in users:
        code = rbac.normalize_role_code(u.get("role"))
        perms = (roles.get(code) or {}).get("permissions") or {}
        if not rbac.level_allows(perms.get("/hizli-satis"), "edit") and code not in ("admin", "manager"):
            continue
        row = public_user(u)
        row["role"] = code
        row["role_name"] = (roles.get(code) or {}).get("name") or code
        row["pos_rules"] = normalize_pos_rules((roles.get(code) or {}).get("pos_rules"), code)
        out.append(row)
    return out


@router.post("/pos/cashiers/{user_id}/pin")
async def set_cashier_pin(user_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    target = await tenant_access.get_tenant_doc(_db, "users", user_id, user, not_found="Kullanıcı bulunamadı.")
    if not _can_manage_rules(user) and _uid(user) != str(user_id):
        raise HTTPException(status_code=403, detail="PIN yalnızca yönetici veya kasiyerin kendisi tanımlayabilir.")
    pin = normalize_pin(req.get("pin") or req.get("password"))
    others = await _db.users.find({
        "_id": {"$ne": target["_id"]},
        "cashier_pin_hash": {"$exists": True, "$nin": [None, ""]},
        "$or": [{"active_company_id": cid}, {"company_ids": cid}],
    }).to_list(400)
    privileged = False
    other_hit = False
    for o in others:
        if not verify_password(pin, o.get("cashier_pin_hash") or ""):
            continue
        if await _can_approve(o, cid):
            privileged = True
        else:
            other_hit = True
    if privileged or other_hit:
        # Çakışma 409 ve "başka kasiyerde kayıtlı" diye dönmez.
        # Kasiyer kendi PIN'ini yazarken onay yetkilisinin PIN'ini bu yanıttan ayırt edemez.
        if privileged and not _can_manage_rules(user):
            return {"status": "success", "has_cashier_pin": True, "message": "Kasiyer PIN kaydedildi."}
        raise HTTPException(status_code=400, detail=PIN_TAKEN_MESSAGE)
    await _db.users.update_one({"_id": target["_id"]}, {"$set": {"cashier_pin_hash": hash_password(pin), "updated_at": _now()}})
    return {"status": "success", "has_cashier_pin": True, "message": "Kasiyer PIN kaydedildi."}


@router.get("/pos/session")
async def get_session(company_id: Optional[str] = None, terminal_id: Optional[str] = None, user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, company_id)
    tid = (terminal_id or "").strip() or (request.headers.get("x-pos-terminal") if request else "") or ""
    company = await _company(cid)
    sess = await _session_by_terminal(cid, tid) if tid else None
    pending = await _db.pos_approvals.find({
        "company_id": cid, "status": "pending",
        **({"terminal_id": tid} if tid else {}),
    }).sort("created_at", -1).to_list(50)
    held = []
    if sess and sess.get("cashier_user_id"):
        held = await _db.pos_held_carts.find({
            "company_id": cid, "cashier_user_id": sess.get("cashier_user_id"),
        }).sort("held_at", -1).to_list(40)
    shift = None
    if sess and sess.get("shift_id"):
        shift = await _db.pos_shifts.find_one({"_id": sess["shift_id"]})
    pubs = public_session(sess, company=company) if sess else None
    if pubs and session_is_idle(sess, timeout_sec=idle_timeout_sec(company)) and not sess.get("locked"):
        await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"locked": True, "updated_at": _now()}})
        pubs["locked"] = True
        pubs["refresh_lock"] = True
    return {
        "session": pubs,
        "held_carts": [public_hold(h) for h in held],
        "pending_approvals": [public_approval(p) for p in pending],
        "shift": public_shift(shift),
        "idle_timeout_sec": idle_timeout_sec(company),
        "my_rules": await rules_for_user(user, cid),
        "can_approve": await _can_approve(user, cid),
    }


async def _open_cashier_session(req: Dict[str, Any], user: dict, request: Optional[Request] = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    pin = req.get("pin") or req.get("password")
    ident = await _guard_pin_attempts(cid, tid, request)
    specified = str(req.get("cashier_user_id") or req.get("user_id") or "").strip()
    try:
        cashier = await _find_user_by_pin(
            cid, pin,
            user_id=specified or None,
            include_approvers=bool(specified),
        )
    except HTTPException as exc:
        if exc.status_code != 429:
            await _fail_pin_attempt(ident)
        raise
    await _clear_pin_attempt(ident)
    if not tid:
        tid = str(uuid.uuid4())
    rules = await rules_for_user(cashier, cid)
    now = _now()
    existing = await _session_by_terminal(cid, tid)
    cart = empty_cart()
    if existing and existing.get("cashier_user_id") == str(cashier.get("_id") or cashier.get("id")):
        cart = cart_snapshot(existing.get("cart"))
    elif existing and (existing.get("cart") or {}).get("items"):
        await _db.pos_held_carts.insert_one({
            "_id": str(uuid.uuid4()),
            "company_id": cid,
            "cashier_user_id": existing.get("cashier_user_id"),
            "cashier_name": existing.get("cashier_name"),
            "label": f"Bekleyen · {existing.get('cashier_name') or 'kasiyer'}",
            "cart": cart_snapshot(existing.get("cart")),
            "held_at": now,
        })
    shift = await _db.pos_shifts.find_one({
        "company_id": cid, "cashier_user_id": str(cashier.get("_id")), "status": "open",
    })
    sess_id = (existing or {}).get("_id") or str(uuid.uuid4())
    doc = {
        "_id": sess_id,
        "company_id": cid,
        "terminal_id": tid,
        "station_user_id": _uid(user),
        "cashier_user_id": str(cashier.get("_id")),
        "cashier_name": cashier.get("name") or cashier.get("email"),
        "cashier_email": cashier.get("email"),
        "cashier_role": _role_code(cashier),
        "rules": rules,
        "cart": cart,
        "locked": False,
        "exit_granted": bool(rules.get("can_exit")),
        "shift_id": (shift or {}).get("_id"),
        "last_activity": now,
        "created_at": (existing or {}).get("created_at") or now,
        "updated_at": now,
        "ended_at": None,
    }
    if existing:
        await _db.pos_sessions.update_one({"_id": sess_id}, {"$set": {k: v for k, v in doc.items() if k != "_id"}})
    else:
        await _db.pos_sessions.insert_one(doc)
    await _write_event(cid, kind="cashier_login", summary=f"Kasiyer giriş: {doc['cashier_name']}", user=user, extra={"cashier_user_id": doc["cashier_user_id"]})
    company = await _company(cid)
    return {
        "status": "success",
        "terminal_id": tid,
        "session": public_session(doc, company=company),
        "need_shift_open": shift is None,
        "message": f"{doc['cashier_name']} giriş yaptı.",
    }


@router.post("/pos/session/lock")
async def session_lock(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid, allow_locked=True)
    await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"locked": True, "updated_at": _now()}})
    return {"status": "locked"}


@router.post("/pos/session/unlock")
async def session_unlock(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid, allow_locked=True)
    ident = await _guard_pin_attempts(cid, tid, request)
    try:
        cashier = await _find_user_by_pin(
            cid, req.get("pin") or req.get("password"),
            user_id=str(sess.get("cashier_user_id") or ""),
        )
        if str(cashier.get("_id") or "") != str(sess.get("cashier_user_id") or ""):
            raise HTTPException(status_code=401, detail=PIN_FAIL_MESSAGE)
    except HTTPException as exc:
        if exc.status_code != 429:
            await _fail_pin_attempt(ident)
        raise
    await _clear_pin_attempt(ident)
    now = _now()
    await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"locked": False, "last_activity": now, "updated_at": now}})
    sess["locked"] = False
    sess["last_activity"] = now
    return {"status": "unlocked", "session": public_session(sess, company=await _company(cid))}


@router.post("/pos/session/ping")
async def session_ping(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid, allow_locked=True)
    if sess.get("locked"):
        return {"status": "locked", "session": public_session(sess, company=await _company(cid))}
    now = _now()
    await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"last_activity": now, "updated_at": now}})
    sess["last_activity"] = now
    return {"status": "ok", "session": public_session(sess, company=await _company(cid))}


@router.post("/pos/session/login")
async def session_login(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    return await _open_cashier_session(req, user, request)


@router.post("/pos/session/switch")
async def session_switch(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    """Tek tıkla kasiyer değişimi: mevcut sepet kasiyere bağlanır, yeni PIN ile giriş."""
    return await _open_cashier_session(req, user, request)


@router.post("/pos/session/exit")
async def session_exit(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid, allow_locked=True)
    rules = sess.get("rules") or {}
    if exit_is_blocked(sess, rules):
        gated = await maybe_gate(
            "exit", company_id=cid, session=sess, user=user, request=request,
            payload={"supervisor_pin": req.get("pin") or req.get("supervisor_pin"), "approval_id": req.get("approval_id")},
            summary="Hızlı Satış ekranından çıkış",
        )
        if gated and gated.get("status") == "rejected":
            raise HTTPException(status_code=403, detail="Çıkış reddedildi.")
        if gated and gated.get("status") != "approved":
            return gated
    now = _now()
    await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {
        "exit_granted": True, "locked": True, "ended_at": now, "updated_at": now,
    }})
    await _write_event(cid, kind="exit", summary=f"Çıkış: {sess.get('cashier_name')}", user=user)
    return {"status": "exited", "message": "Hızlı Satış kilitlendi, çıkış verildi."}


@router.put("/pos/session/cart")
async def put_cart(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    """Sepeti senkronize et. Satır silme / boşaltma / fiyat değişimi onay kapısından geçer."""
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid)
    incoming = cart_snapshot({"items": req.get("items") or [], "customer_name": req.get("customer_name")})
    current = cart_snapshot(sess.get("cart"))
    old_ids = {str(x.get("id")): x for x in current["items"]}
    new_ids = {str(x.get("id")): x for x in incoming["items"]}
    removed = [old_ids[i] for i in old_ids if i not in new_ids]
    rules = sess.get("rules") or {}
    pin = req.get("supervisor_pin") or req.get("pin")
    approval_id = req.get("approval_id")

    if not incoming["items"] and current["items"]:
        gated = await maybe_gate(
            "cancel_cart", company_id=cid, session=sess, user=user, request=request,
            payload={"supervisor_pin": pin, "approval_id": approval_id},
            summary=f"Sepet iptali ({len(current['items'])} satır)",
        )
        if gated:
            if gated.get("status") == "approved":
                return {"status": "success", "cart": empty_cart(incoming.get("customer_name")), **gated}
            return gated
        await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"cart": incoming, "last_activity": _now()}})
        await _write_event(cid, kind="cancel_cart", summary="Sepet iptal edildi", user=user, extra={"cashier_user_id": sess.get("cashier_user_id")})
        return {"status": "success", "cart": incoming}

    if removed:
        gated = await maybe_gate(
            "delete_line", company_id=cid, session=sess, user=user, request=request,
            payload={"line_id": removed[0].get("id"), "supervisor_pin": pin, "approval_id": approval_id},
            summary=f"Satır silindi: {removed[0].get('name') or removed[0].get('id')}",
        )
        if gated:
            return gated

    for nid, nit in new_ids.items():
        old = old_ids.get(nid)
        if not old:
            continue
        if abs(float(nit.get("unit_price") or 0) - float(old.get("unit_price") or 0)) > 0.0001:
            product = await _db.products.find_one({"_id": nit.get("product_id")}) or {}
            cat = catalog_unit_price(product) or float(old.get("unit_price") or 0)
            extra = {"catalog_price": cat, "unit_price": float(nit.get("unit_price") or 0)}
            kind = "discount" if float(nit.get("unit_price") or 0) < cat else "price_change"
            gated = await maybe_gate(
                kind, company_id=cid, session=sess, user=user, request=request,
                payload={"line_id": nid, "unit_price": nit.get("unit_price"), "catalog_price": cat, "supervisor_pin": pin, "approval_id": approval_id},
                summary=f"Fiyat {old.get('unit_price')} → {nit.get('unit_price')} ({nit.get('name')})",
                extra=extra,
            )
            if gated:
                return gated

    await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"cart": incoming, "last_activity": _now(), "updated_at": _now()}})
    return {"status": "success", "cart": incoming}


@router.post("/pos/session/hold")
async def hold_cart(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid)
    cart = cart_snapshot(sess.get("cart"))
    if not cart["items"]:
        raise HTTPException(status_code=400, detail="Beklemeye alınacak ürün yok.")
    hid = str(uuid.uuid4())
    doc = {
        "_id": hid,
        "company_id": cid,
        "cashier_user_id": sess.get("cashier_user_id"),
        "cashier_name": sess.get("cashier_name"),
        "label": req.get("label") or f"Bekleyen · {sess.get('cashier_name') or 'kasiyer'}",
        "cart": cart,
        "held_at": _now(),
    }
    await _db.pos_held_carts.insert_one(doc)
    empty = empty_cart(cart.get("customer_name"))
    await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"cart": empty, "updated_at": _now()}})
    return {"status": "success", "hold": public_hold(doc), "cart": empty}


@router.post("/pos/session/resume")
async def resume_hold(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid)
    hold = await tenant_access.get_tenant_doc(_db, "pos_held_carts", req.get("hold_id"), user, not_found="Bekleyen sepet bulunamadı.")
    if str(hold.get("cashier_user_id")) != str(sess.get("cashier_user_id")):
        raise HTTPException(status_code=403, detail="Bu sepet başka kasiyere bağlı.")
    current = cart_snapshot(sess.get("cart"))
    if current["items"]:
        await _db.pos_held_carts.insert_one({
            "_id": str(uuid.uuid4()),
            "company_id": cid,
            "cashier_user_id": sess.get("cashier_user_id"),
            "cashier_name": sess.get("cashier_name"),
            "label": f"Bekleyen · {sess.get('cashier_name')}",
            "cart": current,
            "held_at": _now(),
        })
    await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"cart": cart_snapshot(hold.get("cart")), "updated_at": _now()}})
    await _db.pos_held_carts.delete_one({"_id": hold["_id"]})
    return {"status": "success", "cart": cart_snapshot(hold.get("cart"))}


@router.post("/pos/approvals")
async def create_approval(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid, allow_locked=True)
    kind = str(req.get("kind") or "").strip()
    if kind not in KIND_LABELS:
        raise HTTPException(status_code=400, detail="Geçersiz onay türü.")
    extra = req.get("extra") or {}
    return await maybe_gate(
        kind, company_id=cid, session=sess, user=user, request=request,
        payload={**(req.get("payload") or {}), "supervisor_pin": req.get("pin"), "approval_id": req.get("approval_id")},
        summary=req.get("summary") or KIND_LABELS[kind],
        extra=extra,
    ) or {"status": "allowed", "kind": kind}


@router.get("/pos/approvals")
async def list_approvals(company_id: Optional[str] = None, status: Optional[str] = "pending", user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    q: Dict[str, Any] = {"company_id": cid}
    if status:
        q["status"] = status
    rows = await _db.pos_approvals.find(q).sort("created_at", -1).to_list(100)
    can = await _can_approve(user, cid)
    out = []
    for r in rows:
        row = public_approval(r)
        row["can_approve"] = can
        out.append(row)
    return out


@router.get("/pos/approvals/{req_id}")
async def get_approval(req_id: str, user: dict = Depends(_user_dep)):
    doc = await tenant_access.get_tenant_doc(_db, "pos_approvals", req_id, user, not_found="Onay talebi bulunamadı.")
    row = public_approval(doc)
    row["can_approve"] = await _can_approve(user, doc["company_id"])
    return row


@router.post("/pos/approvals/{req_id}/approve")
async def approve_pos_request(req_id: str, request: Request, req: Optional[Dict[str, Any]] = None, user: dict = Depends(_user_dep)):
    await tenant_access.get_tenant_doc(_db, "pos_approvals", req_id, user, not_found="Onay talebi bulunamadı.")
    body = req or {}
    return await decide_approval(
        req_id, user, approve=True, pin=body.get("pin") or body.get("supervisor_pin"),
        request=request, terminal_id=_terminal_of(body, request),
    )


@router.post("/pos/approvals/{req_id}/reject")
async def reject_pos_request(req_id: str, request: Request, req: Optional[Dict[str, Any]] = None, user: dict = Depends(_user_dep)):
    await tenant_access.get_tenant_doc(_db, "pos_approvals", req_id, user, not_found="Onay talebi bulunamadı.")
    body = req or {}
    return await decide_approval(
        req_id, user, approve=False, pin=body.get("pin") or body.get("supervisor_pin"),
        request=request, terminal_id=_terminal_of(body, request),
    )


@router.post("/pos/drawer/open")
async def open_drawer(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid)
    gated = await maybe_gate(
        "open_drawer", company_id=cid, session=sess, user=user, request=request,
        payload={"supervisor_pin": req.get("pin"), "approval_id": req.get("approval_id")},
        summary="Satışsız çekmece açma",
    )
    if gated and gated.get("status") != "approved" and gated.get("status") != "allowed":
        if gated.get("status") == "pending_approval":
            return gated
        if gated.get("status") == "rejected":
            raise HTTPException(status_code=403, detail="Çekmece açma reddedildi.")
    await _write_event(cid, kind="open_drawer", summary="Çekmece açıldı", user=user, extra={"cashier_user_id": sess.get("cashier_user_id")})
    return {"status": "opened", "message": "Çekmece açıldı."}


@router.get("/pos/shifts")
async def list_shifts(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    rows = await _db.pos_shifts.find({"company_id": cid}).sort("opened_at", -1).to_list(60)
    return [public_shift(r) for r in rows]


@router.post("/pos/shifts/open")
async def open_shift(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid)
    existing = await _db.pos_shifts.find_one({
        "company_id": cid, "cashier_user_id": sess.get("cashier_user_id"), "status": "open",
    })
    if existing:
        await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"shift_id": existing["_id"]}})
        return {"status": "already_open", "shift": public_shift(existing)}
    opening = round(float(req.get("opening_cash") or 0), 2)
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": cid,
        "cashier_user_id": sess.get("cashier_user_id"),
        "cashier_name": sess.get("cashier_name"),
        "terminal_id": tid,
        "status": "open",
        "opening_cash": opening,
        "sales_cash": 0.0,
        "sales_card": 0.0,
        "sales_credit": 0.0,
        "sales_count": 0,
        "refunds_amount": 0.0,
        "refunds_count": 0,
        "opened_at": _now(),
        "created_at": _now(),
    }
    await _db.pos_shifts.insert_one(doc)
    await _db.pos_sessions.update_one({"_id": sess["_id"]}, {"$set": {"shift_id": doc["_id"], "updated_at": _now()}})
    await _write_event(cid, kind="shift_open", summary=f"Kasa açılış {opening:.2f} ₺ · {sess.get('cashier_name')}", user=user)
    return {"status": "success", "shift": public_shift(doc)}


@router.post("/pos/shifts/{shift_id}/close")
async def close_shift(shift_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    tenant_access.resolve_company_id(user, req.get("company_id") if req else None)
    shift = await tenant_access.get_tenant_doc(_db, "pos_shifts", shift_id, user, not_found="Vardiya bulunamadı.")
    if shift.get("status") != "open":
        raise HTTPException(status_code=409, detail="Vardiya zaten kapalı.")
    counted_cash = round(float(req.get("counted_cash") if req.get("counted_cash") is not None else 0), 2)
    counted_card = round(float(req.get("counted_card") if req.get("counted_card") is not None else 0), 2)
    expected_cash = round(float(shift.get("opening_cash") or 0) + float(shift.get("sales_cash") or 0) - float(shift.get("refunds_amount") or 0), 2)
    expected_card = round(float(shift.get("sales_card") or 0), 2)
    cash_diff = round(counted_cash - expected_cash, 2)
    card_diff = round(counted_card - expected_card, 2)
    now = _now()
    await _db.pos_shifts.update_one({"_id": shift_id}, {"$set": {
        "status": "closed",
        "closed_at": now,
        "counted_cash": counted_cash,
        "counted_card": counted_card,
        "expected_cash": expected_cash,
        "expected_card": expected_card,
        "cash_diff": cash_diff,
        "card_diff": card_diff,
        "notes": req.get("notes") or "",
        "updated_at": now,
    }})
    closed = await _db.pos_shifts.find_one({"_id": shift_id})
    await _write_event(
        shift["company_id"], kind="shift_close",
        summary=f"Kasa kapanış fark nakit {cash_diff:.2f} ₺ · kart {card_diff:.2f} ₺",
        user=user, extra={"shift_id": shift_id, "cash_diff": cash_diff, "card_diff": card_diff},
    )
    try:
        await send_daily_summary(shift["company_id"])
    except Exception:
        pass
    return {"status": "success", "shift": public_shift(closed), "difference": {"cash": cash_diff, "card": card_diff}}


@router.get("/pos/events")
async def list_events(company_id: Optional[str] = None, limit: int = 150, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    rows = await _db.pos_events.find({"company_id": cid}).sort("created_at", -1).to_list(min(int(limit or 150), 500))
    return [public_event(r) for r in rows]


@router.post("/pos/session/cancel-sale")
async def cancel_sale(req: Dict[str, Any], user: dict = Depends(_user_dep), request: Request = None):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    tid = _terminal_of(req, request)
    sess = await require_session(cid, tid)
    payload = {
        "company_id": cid,
        "invoice_id": req.get("invoice_id"),
        "invoice_number": req.get("invoice_number"),
        "supervisor_pin": req.get("pin"),
        "approval_id": req.get("approval_id"),
    }
    gated = await maybe_gate(
        "cancel_sale", company_id=cid, session=sess, user=user, request=request, payload=payload,
        summary=f"Satış iptali {req.get('invoice_number') or req.get('invoice_id') or ''}",
    )
    if gated and gated.get("status") == "pending_approval":
        return gated
    if gated and gated.get("status") == "rejected":
        raise HTTPException(status_code=403, detail="Satış iptali reddedildi.")
    if gated and gated.get("status") == "approved":
        return gated
    fn = (_checkout_hooks or {}).get("do_cancel_sale")
    if not fn:
        raise HTTPException(status_code=500, detail="Satış iptal motoru bağlı değil.")
    result = await fn(payload)
    await _write_event(cid, kind="cancel_sale", summary=payload.get("invoice_number") or "Satış iptal", user=user, extra={"invoice_id": payload.get("invoice_id")})
    if sess.get("shift_id"):
        await _db.pos_shifts.update_one({"_id": sess["shift_id"]}, {"$inc": {"cancels_count": 1}})
    return result
