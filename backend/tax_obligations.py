"""Mali müşavir: bordro / mizan / tahakkuk yükleme ve ödenecek vergi-SGK kayıtları."""
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

import expenses
import partner_pay
from tax_obligation_extract import (
    SOURCE_KINDS,
    extract_tax_file,
    normalize_import_lines,
)

router = APIRouter(prefix="/api")
_db = None
_PERIOD_RE = re.compile(r"^20\d{2}-(0[1-9]|1[0-2])$")


def init(db):
    global _db
    _db = db


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(d):
    if not d:
        return d
    out = dict(d)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    return out


async def _ensure_expense(ob: dict) -> str:
    """Yükümlülüğe bağlı masraf yoksa oluşturur; expense_id döner."""
    eid = ob.get("expense_id")
    if eid:
        existing = await _db.expenses.find_one({"_id": eid})
        if existing:
            return eid
    exp = await expenses.create_tax_payable_expense(ob)
    eid = exp["id"]
    await _db.tax_obligations.update_one({"_id": ob["_id"]}, {"$set": {"expense_id": eid}})
    ob["expense_id"] = eid
    return eid


async def _delete_linked_expense(ob: dict):
    eid = ob.get("expense_id")
    if not eid:
        exp = await _db.expenses.find_one({"tax_obligation_id": ob["_id"]})
        eid = exp["_id"] if exp else None
    if not eid:
        return
    exp = await _db.expenses.find_one({"_id": eid})
    if not exp:
        return
    if exp.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Ödenmiş masraf bağlı; önce ödemeyi geri alın.")
    await _db.expenses.delete_one({"_id": eid})


async def _reverse_legacy_bank(ob: dict):
    """Eski (masrafsız) vergi ödemesi kasa hareketini geri alır."""
    bt = await _db.bank_transactions.find_one({"tax_obligation_id": ob["_id"]})
    if bt:
        await _db.bank_accounts.update_one({"_id": bt["account_id"]}, {"$inc": {"current_balance": bt["amount"]}})
        await _db.bank_transactions.delete_one({"_id": bt["_id"]})
    await partner_pay.reverse_one(_db, {"tax_obligation_id": ob["_id"]})


def month_summary(rows: list) -> dict:
    unpaid = [r for r in rows if r.get("payment_status") != "paid"]
    paid = [r for r in rows if r.get("payment_status") == "paid"]
    return {
        "count": len(rows),
        "unpaid_count": len(unpaid),
        "unpaid_total": round(sum(float(r.get("amount") or 0) for r in unpaid), 2),
        "paid_total": round(sum(float(r.get("amount") or 0) for r in paid), 2),
    }


def payroll_from_documents(docs: list) -> Optional[dict]:
    bordros = [d for d in docs if d.get("source_kind") == "bordro"]
    if not bordros:
        return None
    return {
        "count": sum(int((d.get("summary") or {}).get("count") or 0) for d in bordros) or len(bordros),
        "gross": round(sum(float((d.get("summary") or {}).get("gross") or 0) for d in bordros), 2),
        "net": round(sum(float((d.get("summary") or {}).get("net") or 0) for d in bordros), 2),
        "employer_cost": round(sum(float((d.get("summary") or {}).get("employer_cost") or 0) for d in bordros), 2),
        "source": "upload",
    }


def coerce_period(*vals) -> Optional[str]:
    for v in vals:
        s = str(v or "").strip()[:7]
        if _PERIOD_RE.match(s):
            return s
    return None


def visible_obligations(rows: list, month: Optional[str]) -> list:
    """Seçili ay + tüm ödenmemiş satırlar (bordro genelde önceki aydır)."""
    if not month:
        return rows
    out = []
    for r in rows:
        if r.get("payment_status") != "paid":
            out.append(r)
            continue
        if r.get("period") == month or str(r.get("due_date") or "").startswith(month):
            out.append(r)
    return out


async def persist_extracted_document(company_id: str, draft: dict, filename: str, month: Optional[str] = None) -> dict:
    """AI okuduğu anda belgeyi listede tutar (onay bekleyen taslak)."""
    period = coerce_period(draft.get("period"), month)
    if period:
        draft["period"] = period
        for ob in draft.get("obligations") or []:
            if isinstance(ob, dict) and not coerce_period(ob.get("period")):
                ob["period"] = period
    doc_id = str(draft.get("document_id") or uuid.uuid4())
    payload = {
        "company_id": company_id,
        "source_kind": draft.get("source_kind") if draft.get("source_kind") in SOURCE_KINDS else "tahakkuk",
        "period": period,
        "title": draft.get("title") or "",
        "filename": filename or draft.get("filename") or "",
        "document_no": draft.get("document_no") or "",
        "summary": draft.get("summary") or {},
        "status": "draft",
        "updated_at": _now(),
    }
    draft["document_id"] = doc_id
    draft["filename"] = payload["filename"]
    payload["draft"] = dict(draft)
    existing = await _db.tax_documents.find_one({"_id": doc_id})
    if existing:
        await _db.tax_documents.update_one({"_id": doc_id}, {"$set": payload})
    else:
        await _db.tax_documents.insert_one({"_id": doc_id, "created_at": _now(), **payload})
    found = await _db.tax_documents.find_one({"_id": doc_id})
    return _clean(dict(found) if found else {"_id": doc_id, **payload})


def enrich_documents(docs: list, obligations: list) -> list:
    """Yüklenen belgelere satır sayısı / ödenmemiş özeti ekler."""
    by_doc: Dict[str, list] = {}
    for r in obligations:
        did = r.get("document_id")
        if did:
            by_doc.setdefault(did, []).append(r)
    out = []
    for d in docs:
        linked = by_doc.get(d.get("id") or d.get("_id"), [])
        unpaid = [r for r in linked if r.get("payment_status") != "paid"]
        row = dict(d)
        row["obligation_count"] = len(linked)
        row["unpaid_count"] = len(unpaid)
        row["unpaid_total"] = round(sum(float(r.get("amount") or 0) for r in unpaid), 2)
        row["total"] = round(sum(float(r.get("amount") or 0) for r in linked), 2)
        out.append(row)
    return out


@router.post("/tax-obligations/extract")
async def extract_tax_doc(
    file: UploadFile = File(...),
    company_id: str = Query("comp_nexus_main_01"),
    source_kind: str = Query(""),
    month: str = Query(""),
):
    name = file.filename or "belge.pdf"
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya en fazla 10 MB olabilir.")
    try:
        out = await extract_tax_file(data, name, file.content_type or "", source_kind)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)[:220]) from e
    except Exception as e:
        err = str(e)
        hint = ""
        if "401" in err or "403" in err or "anahtar" in err.lower() or "api key" in err.lower():
            hint = " Geçersiz veya süresi dolmuş API anahtarı. Platform → AI Entegrasyonu'ndan yeni anahtar kaydedip Bağlantıyı Test Et yapın."
        raise HTTPException(status_code=400, detail=f"Belge okunamadı: {err[:160]}.{hint}") from e
    draft = out.get("draft") or {}
    if not draft.get("obligations"):
        raise HTTPException(status_code=400, detail="Belgeden ödenecek tutar okunamadı. Bordro, mizan veya tahakkuk PDF'i yükleyin.")
    saved = await persist_extracted_document(company_id, draft, name, month)
    return {
        "draft": draft,
        "document": saved,
        "source": out.get("source"),
        "filename": name,
        "company_id": company_id,
    }


@router.post("/tax-obligations/import")
async def import_tax_doc(req: Dict[str, Any]):
    company_id = req.get("company_id") or "comp_nexus_main_01"
    draft = req.get("draft") or {}
    source_kind = draft.get("source_kind") if draft.get("source_kind") in SOURCE_KINDS else "tahakkuk"
    selected = req.get("selected")
    lines = normalize_import_lines(draft, selected)
    if not lines:
        raise HTTPException(status_code=400, detail="İçe aktarılacak ödenecek satır yok.")
    period = coerce_period(draft.get("period"), req.get("month"), lines[0].get("period"))
    existing_id = str(draft.get("document_id") or "").strip()
    existing = await _db.tax_documents.find_one({"_id": existing_id}) if existing_id else None
    doc = existing or {
        "_id": existing_id or str(uuid.uuid4()),
        "company_id": company_id,
        "created_at": _now(),
    }
    doc.update({
        "company_id": company_id,
        "source_kind": source_kind,
        "period": period,
        "title": draft.get("title") or doc.get("title") or "",
        "filename": draft.get("filename") or req.get("filename") or doc.get("filename") or "",
        "document_no": draft.get("document_no") or doc.get("document_no") or "",
        "summary": draft.get("summary") or doc.get("summary") or {},
        "status": "imported",
        "draft": None,
        "updated_at": _now(),
    })
    if existing:
        await _db.tax_documents.update_one({"_id": doc["_id"]}, {"$set": {k: v for k, v in doc.items() if k != "_id"}})
    else:
        await _db.tax_documents.insert_one(doc)
    created = []
    for line in lines:
        ob = {
            "_id": str(uuid.uuid4()),
            "company_id": company_id,
            "document_id": doc["_id"],
            "source_kind": source_kind,
            "kind": line["kind"],
            "title": line["title"],
            "amount": line["amount"],
            "period": line.get("period") or period,
            "due_date": line.get("due_date"),
            "account_code": line.get("account_code") or "",
            "filename": doc["filename"],
            "document_no": doc.get("document_no") or "",
            "payment_status": "unpaid",
            "account_id": None,
            "partner_id": None,
            "account_name": None,
            "paid_date": None,
            "expense_id": None,
            "created_at": _now(),
        }
        await _db.tax_obligations.insert_one(ob)
        exp = await expenses.create_tax_payable_expense(ob)
        await _db.tax_obligations.update_one({"_id": ob["_id"]}, {"$set": {"expense_id": exp["id"]}})
        ob["expense_id"] = exp["id"]
        created.append(_clean(dict(ob)))
    return {
        "document": _clean(dict(doc)),
        "obligations": created,
        "message": f"{len(created)} satır Masraflar → {expenses.TAX_CATEGORY} altına düştü. Ödemeyi buradan veya Masraflar'dan yapabilirsiniz.",
    }


@router.get("/tax-obligations")
async def list_tax_obligations(
    company_id: str = "comp_nexus_main_01",
    month: Optional[str] = None,
    status: Optional[str] = None,
    source_kind: Optional[str] = None,
):
    query: Dict[str, Any] = {"company_id": company_id}
    if status and status != "all":
        query["payment_status"] = status
    if source_kind and source_kind != "all":
        query["source_kind"] = source_kind
    all_rows = [_clean(x) for x in await _db.tax_obligations.find(query).sort("due_date", 1).to_list(2000)]
    rows = visible_obligations(all_rows, month)
    docs_raw = [_clean(x) for x in await _db.tax_documents.find({"company_id": company_id}).sort("created_at", -1).to_list(200)]
    docs = enrich_documents(docs_raw, all_rows)
    return {
        "obligations": rows,
        "documents": docs,
        "summary": month_summary(rows),
        "payroll": payroll_from_documents(docs),
    }


@router.post("/tax-obligations/{oid}/pay")
async def pay_tax_obligation(oid: str, req: Dict[str, Any]):
    """Ödemeyi Masraflar (Vergi / Harç / SGK) üzerinden kasa/bankaya işler."""
    ob = await _db.tax_obligations.find_one({"_id": oid})
    if not ob:
        raise HTTPException(status_code=404, detail="Yükümlülük bulunamadı.")
    if ob.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Bu yükümlülük zaten ödendi.")
    if not req.get("account_id") and not req.get("partner_id"):
        raise HTTPException(status_code=400, detail="Kasa/Banka veya ortak hesabı seçin.")
    pay_date = req.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    partner_id = req.get("partner_id") or None
    account_id = None if partner_id else req.get("account_id")
    eid = await _ensure_expense(ob)
    paid_exp = await expenses.pay_expense(eid, {"account_id": account_id, "partner_id": partner_id, "date": pay_date})
    await _db.tax_obligations.update_one(
        {"_id": oid},
        {"$set": {
            "payment_status": "paid",
            "account_id": paid_exp.get("account_id"),
            "partner_id": paid_exp.get("partner_id"),
            "account_name": paid_exp.get("account_name"),
            "paid_date": pay_date,
            "expense_id": eid,
            "expense_number": paid_exp.get("expense_number"),
        }},
    )
    return _clean(await _db.tax_obligations.find_one({"_id": oid}))


@router.post("/tax-obligations/{oid}/unpay")
async def unpay_tax_obligation(oid: str):
    ob = await _db.tax_obligations.find_one({"_id": oid})
    if not ob or ob.get("payment_status") != "paid":
        raise HTTPException(status_code=400, detail="Ödenmiş yükümlülük bulunamadı.")
    if ob.get("expense_id"):
        await expenses.unpay_expense(ob["expense_id"])
    else:
        await _reverse_legacy_bank(ob)
    await _db.tax_obligations.update_one(
        {"_id": oid},
        {"$set": {
            "payment_status": "unpaid",
            "account_id": None,
            "partner_id": None,
            "account_name": None,
            "paid_date": None,
        }},
    )
    return _clean(await _db.tax_obligations.find_one({"_id": oid}))


@router.delete("/tax-obligations/{oid}")
async def delete_tax_obligation(oid: str):
    ob = await _db.tax_obligations.find_one({"_id": oid})
    if not ob:
        raise HTTPException(status_code=404, detail="Yükümlülük bulunamadı.")
    if ob.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Ödenmiş kayıt silinemez. Önce ödemeyi geri alın.")
    await _delete_linked_expense(ob)
    await _db.tax_obligations.delete_one({"_id": oid})
    return {"ok": True}


@router.delete("/tax-documents/{doc_id}")
async def delete_tax_document(doc_id: str):
    """Yüklenen bordro/mizan/tahakkuk belgesini ve ödenmemiş satırlarını siler."""
    doc = await _db.tax_documents.find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Belge bulunamadı.")
    obs = await _db.tax_obligations.find({"document_id": doc_id}).to_list(500)
    if any(o.get("payment_status") == "paid" for o in obs):
        raise HTTPException(status_code=400, detail="Ödenmiş satırı olan belge silinemez. Önce ödemeleri geri alın.")
    for o in obs:
        await _delete_linked_expense(o)
        await _db.tax_obligations.delete_one({"_id": o["_id"]})
    await _db.tax_documents.delete_one({"_id": doc_id})
    return {"ok": True, "deleted_obligations": len(obs), "filename": doc.get("filename") or ""}
