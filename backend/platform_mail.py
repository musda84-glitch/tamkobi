"""Platform posta sunucusu: SMTP sunucuları, bilinen gönderen adresleri ve Send As yetkisi.

Exchange “Send As” / Google “Send mail as” / Odoo outgoing mail server modelinin
sistem paneli karşılığı. Müşteri şirketinin İletişim Merkezi hesabından bağımsızdır.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

import comm_service
import saas

router = APIRouter(prefix="/api")
_db = None

PURPOSES = {
    "transactional": "Sistem (hatırlatma, davet)",
    "billing": "Fatura / ödeme",
    "support": "Destek",
    "general": "Genel",
}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def init(db):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    d = dict(d)
    d["id"] = d.pop("_id")
    return d


def _norm_email(v: str) -> str:
    return (v or "").strip().lower()


def _public_server(row: dict) -> dict:
    out = _clean(row)
    out.pop("password_enc", None)
    out["has_password"] = bool(row.get("password_enc"))
    return out


def _public_box(row: dict) -> dict:
    out = _clean(row)
    out.pop("password_enc", None)
    out["has_password"] = bool(row.get("password_enc"))
    out["purposes"] = list(row.get("purposes") or [])
    out["allowed_user_ids"] = list(row.get("allowed_user_ids") or [])
    out["allow_all_admins"] = bool(row.get("allow_all_admins", True))
    return out


def mailbox_allows(box: dict, user: Optional[dict]) -> bool:
    if not box or not box.get("is_active", True):
        return False
    if box.get("allow_all_admins", True):
        return True
    if not user:
        return False
    uid = user.get("id") or user.get("_id")
    return uid in (box.get("allowed_user_ids") or [])


async def _admins() -> List[dict]:
    rows = await _db.users.find({"is_super_admin": True}, {"name": 1, "email": 1, "is_active": 1}).to_list(200)
    return [{"id": u["_id"], "name": u.get("name"), "email": u.get("email"), "is_active": u.get("is_active", True)} for u in rows]


async def _server(sid: str) -> dict:
    row = await _db.platform_mail_servers.find_one({"_id": sid})
    if not row:
        raise HTTPException(status_code=404, detail="Posta sunucusu bulunamadı.")
    return row


async def _box(bid: str) -> dict:
    row = await _db.platform_mailboxes.find_one({"_id": bid})
    if not row:
        raise HTTPException(status_code=404, detail="E-posta kutusu bulunamadı.")
    return row


async def _smtp_dict(box: dict, server: Optional[dict] = None) -> dict:
    server = server or (await _db.platform_mail_servers.find_one({"_id": box["server_id"]}) if box.get("server_id") else None)
    if not server:
        raise HTTPException(status_code=400, detail="Kutu bir posta sunucusuna bağlı değil.")
    password = None
    if box.get("password_enc"):
        password = comm_service.decrypt(box["password_enc"])
    elif server.get("password_enc"):
        password = comm_service.decrypt(server["password_enc"])
    if not password:
        raise HTTPException(status_code=400, detail="SMTP şifresi tanımlı değil (sunucu veya kutu).")
    return {
        "email": box["email"],
        "display_name": box.get("display_name") or box["email"],
        "smtp_host": server["smtp_host"],
        "smtp_port": int(server.get("smtp_port") or 587),
        "smtp_user": box.get("smtp_user") or server.get("smtp_user") or server.get("email") or box["email"],
        "password": password,
        "reply_to": box.get("reply_to") or "",
    }


async def resolve_smtp_account(purpose: Optional[str] = None) -> Optional[dict]:
    """Sistem işleri için aktif kutu. Yoksa None (eski şirket SMTP'sine düşülür)."""
    q: Dict[str, Any] = {"is_active": {"$ne": False}}
    boxes = await _db.platform_mailboxes.find(q).to_list(100)
    if not boxes:
        return None
    ranked = []
    for b in boxes:
        purposes = b.get("purposes") or []
        score = 0
        if b.get("is_default"):
            score += 4
        if purpose and purpose in purposes:
            score += 3
        if "transactional" in purposes:
            score += 1
        ranked.append((score, b.get("created_at") or "", b))
    ranked.sort(key=lambda x: (-x[0], x[1]))
    box = ranked[0][2]
    server = await _db.platform_mail_servers.find_one({"_id": box.get("server_id"), "is_active": {"$ne": False}})
    if not server:
        return None
    try:
        return await _smtp_dict(box, server)
    except HTTPException:
        return None


@router.get("/system/mail")
async def mail_overview(_: dict = Depends(saas.require_super_admin)):
    servers = [_public_server(s) for s in await _db.platform_mail_servers.find({}).sort("created_at", 1).to_list(100)]
    boxes = [_public_box(b) for b in await _db.platform_mailboxes.find({}).sort("created_at", 1).to_list(200)]
    admins = await _admins()
    names = {s["id"]: s.get("name") or s.get("smtp_host") for s in servers}
    for b in boxes:
        b["server_name"] = names.get(b.get("server_id")) or "—"
        if b["allow_all_admins"]:
            b["allowed_users"] = [{"id": a["id"], "name": a["name"], "email": a["email"]} for a in admins if a.get("is_active") is not False]
        else:
            allow = set(b["allowed_user_ids"])
            b["allowed_users"] = [a for a in admins if a["id"] in allow]
    ready = next((b["email"] for b in boxes if b.get("is_default") and b.get("is_active", True)), None) or next((b["email"] for b in boxes if b.get("is_active", True)), None)
    return {
        "servers": servers,
        "mailboxes": boxes,
        "admins": admins,
        "purposes": [{"id": k, "label": v} for k, v in PURPOSES.items()],
        "presets": [{"code": k, **v} for k, v in comm_service.MAIL_PRESETS.items()],
        "default_from": ready,
    }


@router.post("/system/mail/servers")
async def create_server(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    preset = comm_service.MAIL_PRESETS.get(req.get("provider") or "custom") or comm_service.MAIL_PRESETS["custom"]
    host = (req.get("smtp_host") or preset.get("smtp_host") or "").strip()
    if not host:
        raise HTTPException(status_code=400, detail="SMTP sunucu adresi zorunludur.")
    password = (req.get("password") or "").strip()
    if not password:
        raise HTTPException(status_code=400, detail="SMTP şifresi zorunludur.")
    doc = {
        "_id": f"pms_{uuid.uuid4().hex[:10]}",
        "name": (req.get("name") or host).strip(),
        "provider": req.get("provider") or "custom",
        "smtp_host": host,
        "smtp_port": int(req.get("smtp_port") or preset.get("smtp_port") or 587),
        "smtp_user": (req.get("smtp_user") or req.get("email") or "").strip(),
        "password_enc": comm_service.encrypt(password),
        "is_active": bool(req.get("is_active", True)),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await _db.platform_mail_servers.insert_one(doc)
    return _public_server(doc)


@router.put("/system/mail/servers/{server_id}")
async def update_server(server_id: str, req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    cur = await _server(server_id)
    upd: Dict[str, Any] = {"updated_at": _now()}
    for k in ("name", "provider", "smtp_host", "smtp_user"):
        if k in req and req[k] is not None:
            upd[k] = str(req[k]).strip()
    if "smtp_port" in req:
        upd["smtp_port"] = int(req["smtp_port"] or 587)
    if "is_active" in req:
        upd["is_active"] = bool(req["is_active"])
    pwd = (req.get("password") or "").strip()
    if pwd:
        upd["password_enc"] = comm_service.encrypt(pwd)
    await _db.platform_mail_servers.update_one({"_id": server_id}, {"$set": upd})
    return _public_server({**cur, **upd})


@router.delete("/system/mail/servers/{server_id}")
async def delete_server(server_id: str, _: dict = Depends(saas.require_super_admin)):
    await _server(server_id)
    n = await _db.platform_mailboxes.count_documents({"server_id": server_id})
    if n:
        raise HTTPException(status_code=400, detail="Önce bu sunucuya bağlı e-posta kutularını silin.")
    await _db.platform_mail_servers.delete_one({"_id": server_id})
    return {"ok": True}


@router.post("/system/mail/servers/{server_id}/test")
async def test_server(server_id: str, _: dict = Depends(saas.require_super_admin)):
    srv = await _server(server_id)
    if not srv.get("password_enc"):
        raise HTTPException(status_code=400, detail="SMTP şifresi yok.")
    acc = {
        "email": srv.get("smtp_user") or "test@local",
        "smtp_user": srv.get("smtp_user") or "",
        "smtp_host": srv["smtp_host"],
        "smtp_port": int(srv.get("smtp_port") or 587),
        "password": comm_service.decrypt(srv["password_enc"]),
    }
    if not acc["smtp_user"]:
        raise HTTPException(status_code=400, detail="SMTP kullanıcı adı (giriş e-postası) zorunludur.")
    try:
        res = await comm_service.smtp_login_test(acc)
    except Exception as e:  # noqa: BLE001
        res = {"ok": False, "message": str(getattr(e, "detail", e))[:200]}
    await _db.platform_mail_servers.update_one({"_id": server_id}, {"$set": {"last_test": {**res, "at": _now()}, "updated_at": _now()}})
    return res


@router.post("/system/mail/mailboxes")
async def create_mailbox(req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    email = _norm_email(req.get("email") or "")
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Geçerli bir e-posta adresi girin.")
    if await _db.platform_mailboxes.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu adres zaten tanımlı.")
    server_id = req.get("server_id")
    if not server_id:
        raise HTTPException(status_code=400, detail="Posta sunucusu seçin.")
    await _server(server_id)
    purposes = [p for p in (req.get("purposes") or []) if p in PURPOSES] or ["general"]
    allow_all = bool(req.get("allow_all_admins", True))
    allowed = [] if allow_all else list(req.get("allowed_user_ids") or [])
    if not allow_all:
        allowed = await _valid_admin_ids(allowed)
    is_default = bool(req.get("is_default"))
    doc = {
        "_id": f"pmb_{uuid.uuid4().hex[:10]}",
        "email": email,
        "display_name": (req.get("display_name") or email).strip(),
        "server_id": server_id,
        "smtp_user": (req.get("smtp_user") or "").strip(),
        "reply_to": _norm_email(req.get("reply_to") or "") or None,
        "purposes": purposes,
        "allow_all_admins": allow_all,
        "allowed_user_ids": allowed,
        "is_default": is_default,
        "is_active": bool(req.get("is_active", True)),
        "created_at": _now(),
        "updated_at": _now(),
        "created_by": admin.get("email"),
    }
    pwd = (req.get("password") or "").strip()
    if pwd:
        doc["password_enc"] = comm_service.encrypt(pwd)
    if is_default:
        await _db.platform_mailboxes.update_many({}, {"$set": {"is_default": False}})
    await _db.platform_mailboxes.insert_one(doc)
    return _public_box(doc)


@router.put("/system/mail/mailboxes/{box_id}")
async def update_mailbox(box_id: str, req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    cur = await _box(box_id)
    upd: Dict[str, Any] = {"updated_at": _now()}
    if "email" in req:
        email = _norm_email(req.get("email") or "")
        if not EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Geçerli bir e-posta adresi girin.")
        other = await _db.platform_mailboxes.find_one({"email": email, "_id": {"$ne": box_id}})
        if other:
            raise HTTPException(status_code=400, detail="Bu adres başka bir kutuda kayıtlı.")
        upd["email"] = email
    for k in ("display_name", "smtp_user"):
        if k in req and req[k] is not None:
            upd[k] = str(req[k]).strip()
    if "reply_to" in req:
        upd["reply_to"] = _norm_email(req.get("reply_to") or "") or None
    if "server_id" in req:
        await _server(req["server_id"])
        upd["server_id"] = req["server_id"]
    if "purposes" in req:
        upd["purposes"] = [p for p in (req.get("purposes") or []) if p in PURPOSES] or ["general"]
    if "allow_all_admins" in req:
        upd["allow_all_admins"] = bool(req["allow_all_admins"])
        if upd["allow_all_admins"]:
            upd["allowed_user_ids"] = []
    if "allowed_user_ids" in req and not upd.get("allow_all_admins", cur.get("allow_all_admins", True)):
        upd["allowed_user_ids"] = await _valid_admin_ids(list(req.get("allowed_user_ids") or []))
        upd["allow_all_admins"] = False
    if "is_active" in req:
        upd["is_active"] = bool(req["is_active"])
    pwd = (req.get("password") or "").strip()
    if pwd:
        upd["password_enc"] = comm_service.encrypt(pwd)
    if req.get("is_default"):
        await _db.platform_mailboxes.update_many({"_id": {"$ne": box_id}}, {"$set": {"is_default": False}})
        upd["is_default"] = True
    elif "is_default" in req:
        upd["is_default"] = False
    await _db.platform_mailboxes.update_one({"_id": box_id}, {"$set": upd})
    return _public_box({**cur, **upd})


@router.delete("/system/mail/mailboxes/{box_id}")
async def delete_mailbox(box_id: str, _: dict = Depends(saas.require_super_admin)):
    await _box(box_id)
    await _db.platform_mailboxes.delete_one({"_id": box_id})
    return {"ok": True}


@router.get("/system/mail/my-mailboxes")
async def my_mailboxes(user: dict = Depends(saas.require_super_admin)):
    boxes = await _db.platform_mailboxes.find({"is_active": {"$ne": False}}).to_list(200)
    mine = [_public_box(b) for b in boxes if mailbox_allows(b, user)]
    return {"mailboxes": mine}


@router.post("/system/mail/send-test")
async def send_test(req: Dict[str, Any], user: dict = Depends(saas.require_super_admin)):
    box = await _box(req.get("mailbox_id") or "")
    if not mailbox_allows(box, user):
        raise HTTPException(status_code=403, detail="Bu kutuyu kullanma yetkiniz yok.")
    to = _norm_email(req.get("to") or user.get("email") or "")
    if not EMAIL_RE.match(to):
        raise HTTPException(status_code=400, detail="Alıcı e-posta geçersiz.")
    acc = await _smtp_dict(box)
    subject = req.get("subject") or "TamKobi posta sunucusu test"
    body = req.get("body") or "Bu ileti platform Posta Sunucusu ekranından gönderilen bir testtir."
    try:
        await comm_service.smtp_send(acc, [to], subject, body, html=f"<p>{body}</p>")
        log = {"status": "sent"}
    except Exception as e:  # noqa: BLE001
        log = {"status": "failed", "detail": str(getattr(e, "detail", e))[:200]}
    await _db.platform_mail_logs.insert_one({
        "_id": f"pml_{uuid.uuid4().hex[:10]}",
        "mailbox_id": box["_id"],
        "from_email": acc["email"],
        "to": [to],
        "subject": subject,
        "status": log["status"],
        "error": log.get("detail"),
        "user_id": user.get("id") or user.get("_id"),
        "created_at": _now(),
    })
    if log["status"] != "sent":
        raise HTTPException(status_code=400, detail=log.get("detail") or "Gönderilemedi.")
    return {"ok": True, "from": acc["email"], "to": to}


async def _valid_admin_ids(ids: List[str]) -> List[str]:
    if not ids:
        return []
    found = await _db.users.find({"_id": {"$in": ids}, "is_super_admin": True}, {"_id": 1}).to_list(200)
    return [u["_id"] for u in found]
