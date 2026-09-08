"""Dış ticaret (ithalat / ihracat) dosyaları — Logo / Mikro tarzı gümrük dosyası."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api")
_db = None
_create_invoice = None

INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]
REGIMES_IMPORT = [
    ["4000", "4000 — Serbest dolaşıma giriş"],
    ["5100", "5100 — Dâhilde işleme"],
    ["7100", "7100 — Antrepo"],
    ["5300", "5300 — Geçici ithalat"],
]
REGIMES_EXPORT = [
    ["1000", "1000 — İhracat"],
    ["3151", "3151 — Hariçte işleme"],
    ["3171", "3171 — Transit"],
]
CERTIFICATES = ["", "ATR", "EUR.1", "Menşe Şahadetnamesi", "Form A", "A.TR + Fat. beyannamesi"]
CURRENCIES = ["TRY", "USD", "EUR", "GBP"]
FX_DEFAULTS = {"TRY": 1.0, "USD": 42.5, "EUR": 46.2, "GBP": 54.0}
STATUSES = [
    ["draft", "Taslak"],
    ["declared", "Beyanname verildi"],
    ["cleared", "Gümrük çıktı"],
    ["invoiced", "Faturalandı"],
    ["closed", "Kapandı"],
    ["cancelled", "İptal"],
]


def init(db, create_invoice_fn=None):
    global _db, _create_invoice
    _db, _create_invoice = db, create_invoice_fn


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(d):
    if d and "_id" in d:
        d["id"] = str(d.pop("_id"))
    return d


def _num(v, default=0.0):
    try:
        return float(v if v not in (None, "") else default)
    except (TypeError, ValueError):
        return default


def landed_cost(data: Dict[str, Any]) -> Dict[str, float]:
    fx = _num(data.get("fx_rate"), 1) or 1.0
    goods_fx = _num(data.get("amount_fx"))
    if not goods_fx:
        goods_fx = sum(_num(it.get("quantity")) * _num(it.get("unit_price_fx")) for it in (data.get("items") or []))
    goods_try = round(goods_fx * fx, 2)
    freight = _num(data.get("freight"))
    insurance = _num(data.get("insurance"))
    cif = round(goods_try + freight + insurance, 2)
    duty = round(cif * _num(data.get("customs_duty_rate")) / 100, 2)
    otv = round((cif + duty) * _num(data.get("otv_rate")) / 100, 2)
    kkdf = round(goods_try * _num(data.get("kkdf_rate")) / 100, 2)
    stamp = _num(data.get("stamp_tax"))
    vat_base = cif + duty + otv
    import_vat = round(vat_base * _num(data.get("import_vat_rate"), 20 if (data.get("kind") or "") == "import" else 0) / 100, 2)
    landed = round(cif + duty + otv + kkdf + stamp + import_vat, 2)
    return {
        "amount_fx": round(goods_fx, 2),
        "amount_try": goods_try,
        "cif": cif,
        "customs_duty": duty,
        "otv_amount": otv,
        "kkdf_amount": kkdf,
        "import_vat": import_vat,
        "landed_cost": landed,
    }


async def _next_file_number(company_id: str, kind: str) -> str:
    prefix = "ITH" if kind == "import" else "IHR"
    year = datetime.now(timezone.utc).strftime("%Y")
    n = await _db.trade_files.count_documents({"company_id": company_id, "kind": kind, "file_number": {"$regex": f"^{prefix}-{year}-"}}) + 1
    return f"{prefix}-{year}-{str(n).zfill(4)}"


def _doc_from_req(req: Dict[str, Any], existing: Optional[dict] = None) -> Dict[str, Any]:
    kind = (req.get("kind") or (existing or {}).get("kind") or "export").lower()
    if kind not in ("import", "export"):
        raise HTTPException(status_code=400, detail="kind import veya export olmalı.")
    items = req.get("items") if "items" in req else (existing or {}).get("items") or []
    clean_items: List[dict] = []
    for it in items:
        if not (it.get("name") or it.get("product_name")):
            continue
        qty = _num(it.get("quantity"), 1)
        price = _num(it.get("unit_price_fx") if it.get("unit_price_fx") is not None else it.get("unit_price"))
        clean_items.append({
            "product_id": it.get("product_id") or "",
            "name": it.get("name") or it.get("product_name"),
            "sku": it.get("sku") or "",
            "gtip": (it.get("gtip") or "").strip(),
            "origin_country": it.get("origin_country") or "",
            "quantity": qty,
            "unit": it.get("unit") or "Adet",
            "unit_price_fx": price,
            "net_weight": _num(it.get("net_weight")),
            "total_fx": round(qty * price, 2),
        })
    base = {
        "company_id": req.get("company_id") or (existing or {}).get("company_id") or "comp_nexus_main_01",
        "kind": kind,
        "status": req.get("status") or (existing or {}).get("status") or "draft",
        "contact_id": req.get("contact_id") or "",
        "contact_name": req.get("contact_name") or "",
        "country": (req.get("country") or "").strip(),
        "customs_office": req.get("customs_office") or "",
        "customs_broker": req.get("customs_broker") or "",
        "regime_code": req.get("regime_code") or ("4000" if kind == "import" else "1000"),
        "incoterm": req.get("incoterm") or ("CIF" if kind == "import" else "FOB"),
        "currency": (req.get("currency") or "USD").upper(),
        "fx_rate": _num(req.get("fx_rate"), FX_DEFAULTS.get((req.get("currency") or "USD").upper(), 1)),
        "bl_awb": req.get("bl_awb") or "",
        "container_no": req.get("container_no") or "",
        "declaration_no": req.get("declaration_no") or "",
        "declaration_date": req.get("declaration_date") or "",
        "dab_no": req.get("dab_no") or "",
        "certificate": req.get("certificate") or "",
        "freight": _num(req.get("freight")),
        "insurance": _num(req.get("insurance")),
        "customs_duty_rate": _num(req.get("customs_duty_rate")),
        "otv_rate": _num(req.get("otv_rate")),
        "kkdf_rate": _num(req.get("kkdf_rate")),
        "stamp_tax": _num(req.get("stamp_tax")),
        "import_vat_rate": _num(req.get("import_vat_rate"), 20 if kind == "import" else 0),
        "notes": req.get("notes") or "",
        "items": clean_items,
        "file_date": req.get("file_date") or (existing or {}).get("file_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }
    costs = landed_cost({**base, "amount_fx": req.get("amount_fx")})
    base.update(costs)
    return base


@router.get("/trade-files/meta")
async def trade_meta():
    return {
        "incoterms": INCOTERMS,
        "regimes_import": REGIMES_IMPORT,
        "regimes_export": REGIMES_EXPORT,
        "certificates": CERTIFICATES,
        "currencies": CURRENCIES,
        "fx_defaults": FX_DEFAULTS,
        "statuses": STATUSES,
    }


@router.get("/trade-files")
async def list_trade_files(company_id: Optional[str] = "comp_nexus_main_01", kind: Optional[str] = None):
    q: Dict[str, Any] = {"company_id": company_id}
    if kind in ("import", "export"):
        q["kind"] = kind
    rows = await _db.trade_files.find(q).sort("created_at", -1).to_list(500)
    return [_clean(r) for r in rows]


@router.post("/trade-files")
async def create_trade_file(req: Dict[str, Any]):
    doc = _doc_from_req(req)
    if not doc["contact_name"] and not doc["contact_id"]:
        raise HTTPException(status_code=400, detail="Cari / firma adı gerekli.")
    if not doc["items"]:
        raise HTTPException(status_code=400, detail="En az bir kalem ekleyin.")
    doc["_id"] = str(uuid.uuid4())
    doc["file_number"] = req.get("file_number") or await _next_file_number(doc["company_id"], doc["kind"])
    doc["created_at"] = _now()
    doc["updated_at"] = doc["created_at"]
    await _db.trade_files.insert_one(doc)
    return _clean(doc)


@router.get("/trade-files/{file_id}")
async def get_trade_file(file_id: str):
    d = await _db.trade_files.find_one({"_id": file_id})
    if not d:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı.")
    return _clean(d)


@router.put("/trade-files/{file_id}")
async def update_trade_file(file_id: str, req: Dict[str, Any]):
    cur = await _db.trade_files.find_one({"_id": file_id})
    if not cur:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı.")
    if cur.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="İptal dosya düzenlenemez.")
    merged = {**cur, **req, "items": req.get("items", cur.get("items"))}
    doc = _doc_from_req(merged, cur)
    doc["updated_at"] = _now()
    await _db.trade_files.update_one({"_id": file_id}, {"$set": doc})
    return _clean(await _db.trade_files.find_one({"_id": file_id}))


@router.delete("/trade-files/{file_id}")
async def delete_trade_file(file_id: str):
    import trash
    d = await _db.trade_files.find_one({"_id": file_id})
    if not d:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı.")
    if d.get("invoice_id"):
        raise HTTPException(status_code=400, detail="Faturalanmış dosya silinemez; iptal edin.")
    tid = await trash.soft_delete("trade_files", d, "trade_file", f"{d.get('file_number')} · {d.get('contact_name')}", note=d.get("kind"))
    return {"status": "success", "trash_id": tid, "message": "Dosya çöp kutusuna taşındı."}


@router.post("/trade-files/{file_id}/convert-to-invoice")
async def convert_trade_file(file_id: str, req: Optional[Dict[str, Any]] = None):
    req = req or {}
    d = await _db.trade_files.find_one({"_id": file_id})
    if not d:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı.")
    if d.get("invoice_id"):
        ex = await _db.invoices.find_one({"_id": d["invoice_id"]})
        if ex:
            return {"status": "exists", "invoice": _clean(ex), "message": f"Bu dosya zaten faturalandı: {ex.get('invoice_number')}"}
    if not d.get("contact_id"):
        raise HTTPException(status_code=400, detail="Fatura için önce cari bağlayın.")
    if not _create_invoice:
        raise HTTPException(status_code=500, detail="Fatura servisi hazır değil.")
    from models import Invoice, InvoiceItem
    kind = d.get("kind")
    fx = _num(d.get("fx_rate"), 1) or 1.0
    items = []
    for it in d.get("items") or []:
        unit_price = _num(it.get("unit_price_fx"))
        qty = _num(it.get("quantity"), 1)
        vat = 0 if kind == "export" else int(it.get("vat_rate") or d.get("import_vat_rate") or 20)
        items.append(InvoiceItem(
            product_id=it.get("product_id") or "",
            name=it.get("name") or "Kalem",
            quantity=qty,
            unit=it.get("unit") or "Adet",
            unit_price=unit_price,
            vat_rate=vat,
            total=round(qty * unit_price, 2),
            gtip=it.get("gtip") or None,
            origin_country=it.get("origin_country") or None,
        ))
    if not items:
        raise HTTPException(status_code=400, detail="Kalem yok.")
    contact = await _db.contacts.find_one({"_id": d["contact_id"]}) or {}
    inv = Invoice(
        company_id=d["company_id"],
        invoice_type="sales" if kind == "export" else "purchase",
        e_type=req.get("e_type") or ("e_export" if kind == "export" else "paper"),
        contact_id=d["contact_id"],
        contact_name=d.get("contact_name") or contact.get("name") or "",
        contact_tax_id=contact.get("tax_number_or_id") or "",
        items=items,
        currency=d.get("currency") or "USD",
        fx_rate=fx,
        trade_kind=kind,
        incoterm=d.get("incoterm"),
        country=d.get("country"),
        customs_office=d.get("customs_office"),
        trade_file_id=d["_id"],
        trade_file_number=d.get("file_number"),
        notes=f"Dış ticaret dosyası {d.get('file_number')} ({d.get('incoterm')} {d.get('country') or ''}). " + (d.get("notes") or ""),
        status="draft",
        source_channel="trade",
    )
    created = await _create_invoice(inv)
    await _db.invoices.update_one({"_id": created["id"]}, {"$set": {
        "trade_file_id": d["_id"], "trade_file_number": d.get("file_number"),
        "trade_kind": kind, "incoterm": d.get("incoterm"), "country": d.get("country"),
        "fx_rate": fx, "currency": d.get("currency") or "USD",
        "customs_office": d.get("customs_office"),
    }})
    await _db.trade_files.update_one({"_id": file_id}, {"$set": {
        "invoice_id": created["id"], "invoice_number": created["invoice_number"],
        "status": "invoiced", "updated_at": _now(),
    }})
    return {"status": "success", "invoice": created, "message": f"{d.get('file_number')} → {created['invoice_number']} faturası oluşturuldu."}
