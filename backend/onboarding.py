"""First-run ERP setup wizard progress (company, logo, e-invoice, contact, product, invoice)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

import tenant_access

router = APIRouter(prefix="/api")
_db = None
_current_user = None

STEP_DEFS = (
    {"key": "company", "label": "Firma bilgileri", "hint": "Unvan, VKN, vergi dairesi ve adres"},
    {"key": "logo", "label": "Logo", "hint": "Fatura ve evraklarda görünecek firma logosu"},
    {"key": "einvoice", "label": "e-Fatura bağlantısı", "hint": "Entegratör kullanıcı bilgileri"},
    {"key": "contact", "label": "İlk cari", "hint": "Müşteri veya tedarikçi kartı"},
    {"key": "product", "label": "İlk ürün", "hint": "Stok veya hizmet kartı"},
    {"key": "invoice", "label": "İlk fatura", "hint": "Satış faturası (taslak olabilir)"},
)
STEP_KEYS = tuple(s["key"] for s in STEP_DEFS)
ACTIONS = ("complete", "skip", "unskip", "dismiss", "reopen")


def init(db, current_user_dep):
    global _db, _current_user
    _db, _current_user = db, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_keys(raw) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw = [raw]
    out, seen = [], set()
    for item in raw:
        key = str(item or "").strip()
        if key not in STEP_KEYS or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def normalize_onboarding(raw: Optional[dict]) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    return {
        "completed_steps": _clean_keys(src.get("completed_steps")),
        "skipped_steps": _clean_keys(src.get("skipped_steps")),
        "dismissed_at": src.get("dismissed_at") or None,
        "completed_at": src.get("completed_at") or None,
    }


def company_info_done(company: Optional[dict]) -> bool:
    c = company or {}
    name = str(c.get("name") or "").strip()
    tax = "".join(ch for ch in str(c.get("tax_number") or "") if ch.isdigit())
    return bool(name) and len(tax) >= 10


def logo_done(company: Optional[dict]) -> bool:
    return bool(str((company or {}).get("logo_url") or "").strip())


def einvoice_done(settings: Optional[dict]) -> bool:
    s = settings or {}
    if str(s.get("status") or "") == "configured":
        return True
    if s.get("has_password"):
        return True
    tax = "".join(ch for ch in str(s.get("company_tax_id") or "") if ch.isdigit())
    alias = str(s.get("alias") or "").strip()
    return len(tax) in (10, 11) and bool(alias)


def detect_steps(
    *,
    company: Optional[dict],
    einvoice: Optional[dict],
    contact_count: int,
    product_count: int,
    invoice_count: int,
) -> Dict[str, bool]:
    return {
        "company": company_info_done(company),
        "logo": logo_done(company),
        "einvoice": einvoice_done(einvoice),
        "contact": int(contact_count or 0) > 0,
        "product": int(product_count or 0) > 0,
        "invoice": int(invoice_count or 0) > 0,
    }


def merge_status(stored: Optional[dict], detected: Dict[str, bool]) -> Dict[str, Any]:
    st = normalize_onboarding(stored)
    skipped = set(st["skipped_steps"])
    completed = set(st["completed_steps"])
    steps = []
    remaining = []
    for spec in STEP_DEFS:
        key = spec["key"]
        det = bool(detected.get(key))
        is_skipped = key in skipped and not det
        is_done = det or key in completed or key in skipped
        if not is_done:
            remaining.append(key)
        steps.append({
            **spec,
            "detected": det,
            "skipped": is_skipped,
            "done": is_done,
        })
    all_done = not remaining
    dismissed = bool(st["dismissed_at"])
    show_wizard = (not dismissed) and (not all_done)
    progress = 0 if not STEP_KEYS else int(round(100 * (len(STEP_KEYS) - len(remaining)) / len(STEP_KEYS)))
    return {
        "steps": steps,
        "remaining": remaining,
        "progress_percent": progress,
        "all_done": all_done,
        "dismissed": dismissed,
        "show_wizard": show_wizard,
        "completed_at": st["completed_at"] if all_done else None,
        "dismissed_at": st["dismissed_at"],
    }


def apply_action(stored: Optional[dict], *, action: str, step: Optional[str] = None) -> Dict[str, Any]:
    st = normalize_onboarding(stored)
    completed = set(st["completed_steps"])
    skipped = set(st["skipped_steps"])
    act = str(action or "").strip().lower()
    if act not in ACTIONS:
        raise ValueError("Geçersiz işlem.")
    if act in ("complete", "skip", "unskip"):
        key = str(step or "").strip()
        if key not in STEP_KEYS:
            raise ValueError("Geçerli bir adım seçin.")
        if act == "complete":
            completed.add(key)
            skipped.discard(key)
        elif act == "skip":
            skipped.add(key)
        else:
            skipped.discard(key)
            completed.discard(key)
    elif act == "dismiss":
        skipped.update(STEP_KEYS)
        st["dismissed_at"] = _now()
    elif act == "reopen":
        st["dismissed_at"] = None
        skipped.clear()
        st["completed_at"] = None
    st["completed_steps"] = [k for k in STEP_KEYS if k in completed]
    st["skipped_steps"] = [k for k in STEP_KEYS if k in skipped and k not in completed]
    if not [k for k in STEP_KEYS if k not in completed and k not in skipped]:
        st["completed_at"] = st["completed_at"] or _now()
    elif act == "reopen":
        st["completed_at"] = None
    return st


async def _user(request: Request) -> dict:
    if not _current_user:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    return await _current_user(request)


async def _company(user: dict, company_id: Optional[str]) -> dict:
    cid = tenant_access.resolve_company_id(user, company_id)
    doc = await _db.companies.find_one({"_id": cid})
    if not doc:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return doc


async def _build_status(company: dict) -> Dict[str, Any]:
    cid = company["_id"]
    einvoice = await _db.einvoice_settings.find_one({"company_id": cid}) or {}
    # _einvoice_view is optional; detect from raw fields too
    view = {
        "status": einvoice.get("status"),
        "has_password": bool(einvoice.get("password_enc")),
        "company_tax_id": einvoice.get("company_tax_id") or "",
        "alias": einvoice.get("alias") or "",
    }
    contact_count = await _db.contacts.count_documents({"company_id": cid})
    product_count = await _db.products.count_documents({"company_id": cid})
    invoice_count = await _db.invoices.count_documents({"company_id": cid, "status": {"$ne": "cancelled"}})
    detected = detect_steps(
        company=company,
        einvoice=view,
        contact_count=contact_count,
        product_count=product_count,
        invoice_count=invoice_count,
    )
    merged = merge_status(company.get("onboarding"), detected)
    merged["company_id"] = cid
    merged["einvoice_assigned"] = bool(einvoice.get("provider"))
    merged["einvoice_provider"] = einvoice.get("provider") or ""
    return merged


@router.get("/onboarding/status")
async def onboarding_status(
    request: Request,
    company_id: Optional[str] = Query(None),
    user: dict = Depends(_user),
):
    company = await _company(user, company_id)
    return await _build_status(company)


@router.put("/onboarding/progress")
async def onboarding_progress(
    request: Request,
    req: Dict[str, Any] = Body(...),
    user: dict = Depends(_user),
):
    company = await _company(user, req.get("company_id"))
    try:
        nxt = apply_action(company.get("onboarding"), action=str(req.get("action") or ""), step=req.get("step"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await _db.companies.update_one({"_id": company["_id"]}, {"$set": {"onboarding": nxt}})
    company["onboarding"] = nxt
    return await _build_status(company)
