"""Gelen e-Belgeler: UBL-TR XML (e-Fatura / e-İrsaliye) veya PDF (AI) yükle → tedarikçi eşle / yeni tedarikçi → satır-stok kartı eşleştir → onayla (alış faturası / gelen irsaliye + stok girişi) ya da reddet."""
import io
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

import saas

router = APIRouter(prefix="/api")
_db = None
_deps: Dict[str, Any] = {}
NS = {"cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2", "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"}


def init(db, deps):
    global _db
    _db = db
    _deps.update(deps)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _t(el, path, default=""):
    n = el.find(path, NS) if el is not None else None
    return (n.text or "").strip() if n is not None and n.text else default


def _f(el, path, default=0.0):
    try:
        return float(_t(el, path, "") or default)
    except ValueError:
        return default


def parse_ubl(data: bytes) -> Dict[str, Any]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        raise HTTPException(status_code=400, detail="XML okunamadı; UBL-TR e-Fatura/e-İrsaliye XML dosyası yükleyin.")
    tag = root.tag.split("}")[-1]
    kind = "dispatch" if tag == "DespatchAdvice" else "invoice"
    sup = root.find("cac:AccountingSupplierParty/cac:Party", NS) if kind == "invoice" else root.find("cac:DespatchSupplierParty/cac:Party", NS)
    party_id = [i for i in (sup.findall("cac:PartyIdentification/cbc:ID", NS) if sup is not None else []) if i.attrib.get("schemeID") in ("VKN", "TCKN")]
    supplier = {"name": _t(sup, "cac:PartyName/cbc:Name") or (_t(sup, "cac:Person/cbc:FirstName") + " " + _t(sup, "cac:Person/cbc:FamilyName")).strip(), "tax_id": party_id[0].text.strip() if party_id else "", "tax_office": _t(sup, "cac:PartyTaxScheme/cac:TaxScheme/cbc:Name"),
                "address": " ".join(x for x in (_t(sup, "cac:PostalAddress/cbc:StreetName"), _t(sup, "cac:PostalAddress/cbc:BuildingNumber"), _t(sup, "cac:PostalAddress/cbc:CitySubdivisionName")) if x), "city": _t(sup, "cac:PostalAddress/cbc:CityName"),
                "email": _t(sup, "cac:Contact/cbc:ElectronicMail"), "phone": _t(sup, "cac:Contact/cbc:Telephone")}
    lines = []
    for ln in root.findall("cac:InvoiceLine" if kind == "invoice" else "cac:DespatchLine", NS):
        qty_el = ln.find("cbc:InvoicedQuantity" if kind == "invoice" else "cbc:DeliveredQuantity", NS)
        qty = float((qty_el.text or "1").strip()) if qty_el is not None and qty_el.text else 1.0
        item = ln.find("cac:Item", NS)
        price = _f(ln, "cac:Price/cbc:PriceAmount")
        total = _f(ln, "cbc:LineExtensionAmount") or round(qty * price, 2)
        vat = _f(ln, "cac:TaxTotal/cac:TaxSubtotal/cbc:Percent", 20.0) if kind == "invoice" else 20.0
        lines.append({"name": _t(item, "cbc:Name") or "Kalem", "sku": _t(item, "cac:SellersItemIdentification/cbc:ID"), "barcode": next((i.text.strip() for i in (item.findall("cac:AdditionalItemIdentification/cbc:ID", NS) if item is not None else []) if i.text), "") or _t(item, "cac:StandardItemIdentification/cbc:ID"),
                      "quantity": qty, "unit": (qty_el.attrib.get("unitCode", "C62") if qty_el is not None else "C62"), "unit_price": price or (round(total / qty, 4) if qty else 0), "total": total, "vat_rate": vat, "product_id": None})
    totals = root.find("cac:LegalMonetaryTotal", NS)
    return {"kind": kind, "number": _t(root, "cbc:ID"), "uuid": _t(root, "cbc:UUID"), "issue_date": _t(root, "cbc:IssueDate"), "profile": _t(root, "cbc:ProfileID"), "type_code": _t(root, "cbc:InvoiceTypeCode") or _t(root, "cbc:DespatchAdviceTypeCode"), "supplier": supplier, "lines": lines,
            "subtotal": _f(totals, "cbc:LineExtensionAmount") or sum(l["total"] for l in lines), "vat_total": _f(root, "cac:TaxTotal/cbc:TaxAmount"), "grand_total": _f(totals, "cbc:PayableAmount") or _f(totals, "cbc:TaxInclusiveAmount"), "notes": " | ".join(n.text.strip() for n in root.findall("cbc:Note", NS) if n.text)[:500]}


async def _enrich(doc: dict, company_id: str):
    sup = doc["supplier"]
    c = None
    if sup.get("tax_id"):
        c = await _db.contacts.find_one({"company_id": company_id, "tax_number_or_id": sup["tax_id"]})
    if not c and sup.get("name"):
        c = await _db.contacts.find_one({"company_id": company_id, "name": {"$regex": f"^{re.escape(sup['name'][:60])}", "$options": "i"}})
    doc["contact_id"], doc["contact_name"] = (c["_id"], c["name"]) if c else (None, None)
    products = await _db.products.find({"company_id": company_id}, {"name": 1, "sku": 1, "barcode": 1, "marketplace_aliases": 1, "supplier_codes": 1}).to_list(20000)
    idx = {}
    for p in products:
        for k in [p.get("barcode"), p.get("sku"), *(p.get("marketplace_aliases") or []), *(p.get("supplier_codes") or [])]:
            if k:
                idx[str(k).strip().lower()] = p
    names = {p["name"].strip().lower(): p for p in products if p.get("name")}
    for ln in doc["lines"]:
        if ln.get("product_id"):
            continue
        p = idx.get(str(ln.get("barcode") or "").lower()) or idx.get(str(ln.get("sku") or "").lower()) or names.get(str(ln.get("name") or "").lower())
        ln["product_id"], ln["product_name"], ln["auto_matched"] = (p["_id"], p["name"], True) if p else (None, None, False)
    doc["matched_lines"] = sum(1 for l in doc["lines"] if l.get("product_id"))
    return doc


@router.post("/edocs/inbox/upload")
async def upload_edoc(file: UploadFile = File(...), company_id: str = Form("comp_nexus_main_01")):
    data = await file.read()
    name = (file.filename or "").lower()
    if name.endswith(".xml") or data[:5] == b"<?xml" or b"<Invoice" in data[:400] or b"<DespatchAdvice" in data[:400]:
        parsed = parse_ubl(data); source = "ubl_xml"
    elif name.endswith(".pdf"):
        text = await _deps["pdf_text"](file, data)
        ai = await _deps["ai_invoice"](text)
        parsed = {"kind": "invoice", "number": ai.get("invoice_number") or "", "issue_date": ai.get("issue_date") or "", "supplier": {"name": ai.get("supplier_name") or "", "tax_id": ai.get("supplier_tax_id") or "", "tax_office": ai.get("supplier_tax_office") or "", "address": ai.get("supplier_address") or ""},
                  "lines": [{"name": i.get("name"), "sku": i.get("sku") or "", "barcode": i.get("barcode") or "", "quantity": float(i.get("quantity") or 1), "unit": i.get("unit") or "Adet", "unit_price": float(i.get("unit_price") or 0), "total": float(i.get("total") or 0), "vat_rate": float(i.get("vat_rate") or 20), "product_id": None} for i in ai.get("items") or []],
                  "subtotal": float(ai.get("subtotal") or 0), "vat_total": float(ai.get("vat_total") or 0), "grand_total": float(ai.get("grand_total") or 0), "notes": ai.get("notes") or ""}; source = "ai_pdf"
    else:
        raise HTTPException(status_code=400, detail="UBL XML (.xml) veya PDF yükleyin.")
    if parsed.get("uuid") and await _db.incoming_edocs.find_one({"company_id": company_id, "uuid": parsed["uuid"]}):
        raise HTTPException(status_code=400, detail="Bu e-belge (aynı UUID) daha önce alınmış.")
    doc = {"_id": str(uuid.uuid4()), "company_id": company_id, "source": source, "filename": file.filename, "status": "pending", "received_at": _now(), **parsed}
    await _enrich(doc, company_id)
    await _db.incoming_edocs.insert_one(doc)
    return _clean(doc)


def _clean(d: dict) -> dict:
    d = dict(d); d["id"] = d.pop("_id"); return d


@router.get("/edocs/inbox")
async def list_inbox(company_id: str = "comp_nexus_main_01", status: Optional[str] = None):
    q: Dict[str, Any] = {"company_id": company_id}
    if status:
        q["status"] = status
    docs = [_clean(d) for d in await _db.incoming_edocs.find(q).sort("received_at", -1).to_list(500)]
    counts = {s: await _db.incoming_edocs.count_documents({"company_id": company_id, "status": s}) for s in ("pending", "approved", "rejected")}
    return {"items": docs, "counts": counts}


@router.put("/edocs/inbox/{doc_id}/lines")
async def set_lines(doc_id: str, req: Dict[str, Any]):
    d = await _db.incoming_edocs.find_one({"_id": doc_id})
    if not d or d["status"] != "pending":
        raise HTTPException(status_code=400, detail="Belge bulunamadı ya da işlenmiş.")
    for m in req.get("lines") or []:
        i = int(m.get("idx", -1))
        if 0 <= i < len(d["lines"]):
            p = await _db.products.find_one({"_id": m.get("product_id")}) if m.get("product_id") else None
            d["lines"][i].update({"product_id": p["_id"] if p else None, "product_name": p["name"] if p else None, "auto_matched": False})
            if p and d["lines"][i].get("sku") and d["lines"][i]["sku"] not in (p.get("supplier_codes") or []):
                await _db.products.update_one({"_id": p["_id"]}, {"$addToSet": {"supplier_codes": d["lines"][i]["sku"]}})
    d["matched_lines"] = sum(1 for l in d["lines"] if l.get("product_id"))
    await _db.incoming_edocs.update_one({"_id": doc_id}, {"$set": {"lines": d["lines"], "matched_lines": d["matched_lines"]}})
    return _clean(d)


@router.post("/edocs/inbox/{doc_id}/create-product")
async def create_product_from_line(doc_id: str, req: Dict[str, Any]):
    d = await _db.incoming_edocs.find_one({"_id": doc_id})
    i = int(req.get("idx", -1))
    if not d or not (0 <= i < len(d["lines"])):
        raise HTTPException(status_code=404, detail="Satır bulunamadı.")
    ln = d["lines"][i]
    p = await _deps["create_product"]({"company_id": d["company_id"], "product_name": ln["name"], "barcode": ln.get("barcode"), "sku": ln.get("sku"), "purchase_price": ln.get("unit_price"), "sale_price": round(float(ln.get("unit_price") or 0) * float(req.get("markup") or 1.4), 2), "vat_rate": int(ln.get("vat_rate") or 20), "category": req.get("category") or "Tedarik", "channel": "edoc"})
    return await set_lines(doc_id, {"lines": [{"idx": i, "product_id": p["product"]["id"]}]})


@router.post("/edocs/inbox/{doc_id}/create-supplier")
async def create_supplier(doc_id: str, req: Dict[str, Any]):
    d = await _db.incoming_edocs.find_one({"_id": doc_id})
    if not d:
        raise HTTPException(status_code=404, detail="Belge bulunamadı.")
    s = {**d["supplier"], **{k: v for k, v in (req or {}).items() if k in ("name", "tax_id", "tax_office", "address", "city", "email", "phone")}}
    if not s.get("name"):
        raise HTTPException(status_code=400, detail="Tedarikçi adı gerekli.")
    await saas.check_contact_limit(d["company_id"])
    c = {"_id": f"cnt_{uuid.uuid4().hex[:8]}", "company_id": d["company_id"], "type": "supplier", "name": s["name"], "tax_number_or_id": s.get("tax_id") or "", "tax_office": s.get("tax_office") or None, "address": s.get("address") or None, "city": s.get("city") or None, "email": s.get("email") or None, "phone": s.get("phone") or None,
         "balance": 0.0, "credit_limit": 0.0, "category": "Tedarikçi", "is_e_invoice_user": d.get("source") == "ubl_xml", "payment_term_days": 0, "late_fee_rate": 0.0, "b2b_enabled": False, "b2b_discount": 0.0, "source": "edoc_inbox", "created_at": _now()}
    await _db.contacts.insert_one(c)
    await _db.incoming_edocs.update_one({"_id": doc_id}, {"$set": {"contact_id": c["_id"], "contact_name": c["name"]}})
    return {"status": "success", "contact_id": c["_id"], "message": f"Tedarikçi oluşturuldu: {c['name']}"}


@router.put("/edocs/inbox/{doc_id}/supplier")
async def link_supplier(doc_id: str, req: Dict[str, Any]):
    c = await _db.contacts.find_one({"_id": req.get("contact_id")})
    if not c:
        raise HTTPException(status_code=404, detail="Cari bulunamadı.")
    await _db.incoming_edocs.update_one({"_id": doc_id}, {"$set": {"contact_id": c["_id"], "contact_name": c["name"]}})
    return {"status": "success", "contact_name": c["name"]}


@router.post("/edocs/inbox/{doc_id}/approve")
async def approve_edoc(doc_id: str, req: Dict[str, Any]):
    d = await _db.incoming_edocs.find_one({"_id": doc_id})
    if not d or d["status"] != "pending":
        raise HTTPException(status_code=400, detail="Belge bulunamadı ya da zaten işlenmiş.")
    if not d.get("contact_id"):
        raise HTTPException(status_code=400, detail="Önce tedarikçiyi eşleştirin veya 'Yeni Tedarikçi Ekle' ile oluşturun.")
    unmatched = [l["name"] for l in d["lines"] if not l.get("product_id")]
    if unmatched and not req.get("allow_unmatched"):
        raise HTTPException(status_code=400, detail=f"{len(unmatched)} satır stok kartıyla eşleşmedi: {', '.join(unmatched[:3])}… Eşleştirin, stok kartı açın ya da 'eşleşmeyenleri hizmet kalemi olarak al' seçin.")
    items, stock_moves = [], 0
    for l in d["lines"]:
        items.append({"product_id": l.get("product_id") or "", "name": l["name"], "quantity": l["quantity"], "unit": "Adet" if l.get("unit") in ("C62", None, "") else l["unit"], "unit_price": l["unit_price"], "vat_rate": l.get("vat_rate", 20), "discount_rate": 0, "total": l["total"], "vat_amount": round(l["total"] * float(l.get("vat_rate", 20)) / 100, 2)})
        if l.get("product_id") and req.get("update_stock", True):
            await _db.products.update_one({"_id": l["product_id"]}, {"$inc": {"stock_quantity": float(l["quantity"])}, **({"$set": {"purchase_price": float(l["unit_price"])}} if req.get("update_cost", True) and l.get("unit_price") else {})})
            stock_moves += 1
    sub = float(d.get("subtotal") or sum(i["total"] for i in items)); vat = float(d.get("vat_total") or sum(i["vat_amount"] for i in items)); gt = float(d.get("grand_total") or (sub + vat))
    inv = {"_id": str(uuid.uuid4()), "company_id": d["company_id"], "invoice_number": d.get("number") or f"GELEN-{uuid.uuid4().hex[:6].upper()}", "invoice_type": "dispatch" if d["kind"] == "dispatch" else "purchase", "e_type": "e_dispatch" if d["kind"] == "dispatch" else ("e_invoice" if d.get("source") == "ubl_xml" else "paper"),
           "direction": "incoming", "contact_id": d["contact_id"], "contact_name": d["contact_name"], "contact_tax_id": d["supplier"].get("tax_id"), "issue_date": d.get("issue_date") or _now()[:10], "due_date": d.get("issue_date") or _now()[:10], "items": items, "subtotal": round(sub, 2), "vat_total": round(vat, 2), "discount_total": 0.0,
           "grand_total": round(gt, 2), "currency": "TRY", "status": "approved", "gib_status": "received" if d.get("source") == "ubl_xml" else None, "gib_uuid": d.get("uuid"), "payment_status": "unpaid" if d["kind"] == "invoice" else None, "paid_amount": 0.0, "notes": d.get("notes") or "", "source": "edoc_inbox", "edoc_id": doc_id, "created_at": _now()}
    await _db.invoices.insert_one(inv)
    if d["kind"] == "invoice":
        await _db.contacts.update_one({"_id": d["contact_id"]}, {"$inc": {"balance": -round(gt, 2)}})
    await _db.incoming_edocs.update_one({"_id": doc_id}, {"$set": {"status": "approved", "approved_at": _now(), "invoice_id": inv["_id"], "stock_moves": stock_moves}})
    return {"status": "success", "invoice_id": inv["_id"], "message": f"{'Gelen irsaliye' if d['kind'] == 'dispatch' else 'Alış faturası'} onaylandı: {inv['invoice_number']} · {stock_moves} kalemde stok girişi yapıldı."}


@router.post("/edocs/inbox/{doc_id}/reject")
async def reject_edoc(doc_id: str, req: Dict[str, Any]):
    r = await _db.incoming_edocs.update_one({"_id": doc_id, "status": "pending"}, {"$set": {"status": "rejected", "rejected_at": _now(), "reject_reason": (req.get("reason") or "").strip()[:300]}})
    if not r.matched_count:
        raise HTTPException(status_code=400, detail="Belge bulunamadı ya da zaten işlenmiş.")
    return {"status": "success", "message": "Belge reddedildi. (GİB üzerinden ret yanıtı için e-fatura entegratörü bağlantısı gerekir; ticari fatura ret süresi 8 gündür.)"}


@router.delete("/edocs/inbox/{doc_id}")
async def delete_edoc(doc_id: str):
    r = await _db.incoming_edocs.delete_one({"_id": doc_id, "status": {"$ne": "approved"}})
    if not r.deleted_count:
        raise HTTPException(status_code=400, detail="Onaylanmış belge silinemez.")
    return {"status": "success"}
