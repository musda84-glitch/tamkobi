"""Gelen e-Belgeler: UBL-TR XML (e-Fatura / e-İrsaliye) veya PDF (AI) yükle → tedarikçi eşle / yeni tedarikçi → satır-stok kartı eşleştir → onayla (alış faturası / gelen irsaliye + stok girişi) ya da reddet."""
import hashlib
import io
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

import saas

router = APIRouter(prefix="/api")
_db = None
_deps: Dict[str, Any] = {}
# Belgeyi UBL yapan kök etiketler. Entegratör bunların dışında bir şey döndürdüğünde
# (SOAP zarfı, hata sayfası, imza dosyası) fatura diye kaydetmek yerine reddediyoruz.
UBL_ROOTS = {"Invoice": "invoice", "DespatchAdvice": "dispatch"}
MAX_XML_BYTES = 4 * 1024 * 1024


def init(db, deps):
    global _db
    _db = db
    _deps.update(deps)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _t(el, path, default=""):
    n = el.find(path) if el is not None else None
    return (n.text or "").strip() if n is not None and n.text else default


def _f(el, path, default=0.0):
    try:
        return float(_t(el, path, "") or default)
    except ValueError:
        return default


def ubl_root(data: bytes) -> ET.Element:
    """UBL kökünü ad alanlarından arındırılmış olarak döndürür.

    Etiketleri `cbc:`/`cac:` önekiyle aramak, belge bu önekleri kullandığı sürece
    çalışıyordu; ad alanı bildirmeyen ya da farklı önek kullanan entegratör
    çıktılarında ise her alan boş dönüyor ve tamamen boş bir fatura kaydediliyordu.
    Önce ad alanlarını siliyor, sonra yerel adla arıyoruz.
    """
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        raise HTTPException(status_code=400, detail="XML okunamadı; UBL-TR e-Fatura/e-İrsaliye XML dosyası yükleyin.")
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def parse_ubl(data: bytes) -> Dict[str, Any]:
    root = ubl_root(data)
    kind = UBL_ROOTS.get(root.tag)
    if not kind:
        raise HTTPException(status_code=400, detail=f"Bu XML bir UBL-TR e-Fatura/e-İrsaliye değil (kök etiket: {root.tag[:40]}).")
    sup = root.find("AccountingSupplierParty/Party") if kind == "invoice" else root.find("DespatchSupplierParty/Party")
    party_id = [i for i in (sup.findall("PartyIdentification/ID") if sup is not None else []) if i.attrib.get("schemeID") in ("VKN", "TCKN") and (i.text or "").strip()]
    supplier = {"name": _t(sup, "PartyName/Name") or (_t(sup, "Person/FirstName") + " " + _t(sup, "Person/FamilyName")).strip(), "tax_id": party_id[0].text.strip() if party_id else "", "tax_office": _t(sup, "PartyTaxScheme/TaxScheme/Name"),
                "address": " ".join(x for x in (_t(sup, "PostalAddress/StreetName"), _t(sup, "PostalAddress/BuildingNumber"), _t(sup, "PostalAddress/CitySubdivisionName")) if x), "city": _t(sup, "PostalAddress/CityName"),
                "email": _t(sup, "Contact/ElectronicMail"), "phone": _t(sup, "Contact/Telephone")}
    lines = []
    for ln in root.findall("InvoiceLine" if kind == "invoice" else "DespatchLine"):
        qty_el = ln.find("InvoicedQuantity" if kind == "invoice" else "DeliveredQuantity")
        try:
            qty = float((qty_el.text or "1").strip()) if qty_el is not None and qty_el.text else 1.0
        except ValueError:
            qty = 1.0
        item = ln.find("Item")
        price = _f(ln, "Price/PriceAmount")
        total = _f(ln, "LineExtensionAmount") or round(qty * price, 2)
        vat = _f(ln, "TaxTotal/TaxSubtotal/Percent", 20.0) if kind == "invoice" else 20.0
        lines.append({"name": _t(item, "Name") or "Kalem", "sku": _t(item, "SellersItemIdentification/ID"), "barcode": next((i.text.strip() for i in (item.findall("AdditionalItemIdentification/ID") if item is not None else []) if i.text), "") or _t(item, "StandardItemIdentification/ID"),
                      "quantity": qty, "unit": (qty_el.attrib.get("unitCode", "C62") if qty_el is not None else "C62"), "unit_price": price or (round(total / qty, 4) if qty else 0), "total": total, "vat_rate": vat, "product_id": None})
    totals = root.find("LegalMonetaryTotal")
    parsed = {"kind": kind, "number": _t(root, "ID"), "uuid": _t(root, "UUID"), "issue_date": _t(root, "IssueDate"), "profile": _t(root, "ProfileID"), "type_code": _t(root, "InvoiceTypeCode") or _t(root, "DespatchAdviceTypeCode"), "supplier": supplier, "lines": lines,
              "subtotal": _f(totals, "LineExtensionAmount") or sum(l["total"] for l in lines), "vat_total": _f(root, "TaxTotal/TaxAmount"), "grand_total": _f(totals, "PayableAmount") or _f(totals, "TaxInclusiveAmount"), "notes": " | ".join(n.text.strip() for n in root.findall("Note") if n.text)[:500]}
    if not (parsed["number"] or parsed["uuid"] or lines):
        raise HTTPException(status_code=400, detail="UBL belgesinde fatura numarası, ETTN ve kalem yok; okunabilir bir e-belge değil.")
    return parsed


def _iso_date(value: str) -> str:
    """n11 tarihini YYYY-AA-GG'ye çevirir (2026-09-08T00:00:00, 08.09.2026, 08/09/2026)."""
    v = (value or "").strip()
    if not v:
        return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}", v):
        return v[:10]
    m = re.match(r"^(\d{2})[./](\d{2})[./](\d{4})", v)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else v[:10]


META_FIELDS = ("party_name", "sender_tax_id", "invoice_id", "uuid", "issue_date", "profile", "payable")


def meta_summary(meta: Optional[Dict[str, Any]]) -> Optional[Dict[str, str]]:
    """Belgeyle birlikte saklanacak liste bilgisi: yalnızca apply_meta'nın okuduğu alanlar.

    Entegratörün liste satırı ham XML'i de taşıyor; satırı olduğu gibi saklamak hem
    gelen kutusu listesini şişirir hem de ham belgeyi ayrı koleksiyonda tutma
    kararını boşa çıkarırdı.
    """
    if not meta:
        return None
    kept = {k: str(meta[k]) for k in META_FIELDS if meta.get(k) not in (None, "")}
    return kept or None


def apply_meta(parsed: Dict[str, Any], meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Entegratörün liste yanıtındaki bilgileri UBL'de eksik kalan alanlara doldurur.

    n11 gelen kutusu listesi tedarikçi adını, VKN'sini, tutarı ve tarihi zaten
    veriyor; UBL bunları taşımadığında listeyi çöpe atmak yerine kullanıyoruz.
    """
    if not meta:
        return parsed
    sup = parsed["supplier"]
    sup["name"] = sup.get("name") or (meta.get("party_name") or "").strip()
    sup["tax_id"] = sup.get("tax_id") or (meta.get("sender_tax_id") or "").strip()
    parsed["number"] = parsed.get("number") or (meta.get("invoice_id") or "").strip()
    parsed["uuid"] = parsed.get("uuid") or (meta.get("uuid") or "").strip()
    parsed["issue_date"] = parsed.get("issue_date") or _iso_date(meta.get("issue_date") or "")
    parsed["profile"] = parsed.get("profile") or (meta.get("profile") or "").strip()
    if not parsed.get("grand_total"):
        try:
            parsed["grand_total"] = float(str(meta.get("payable") or "0").replace(",", "."))
        except ValueError:
            pass
    return parsed


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
    key = dedupe_key(parsed, data if source == "ubl_xml" else None)
    if await _existing(company_id, parsed, key):
        raise HTTPException(status_code=400, detail="Bu e-belge daha önce alınmış.")
    return _clean(await _store(company_id, parsed, key, source, file.filename, data if source == "ubl_xml" else None))


def dedupe_key(parsed: dict, data: Optional[bytes]) -> str:
    """Aynı belgenin tekrar kaydedilmesini engelleyen anahtar.

    ETTN yoksa eskiden hiç kontrol yapılmıyordu; her senkron aynı faturayı yeniden
    ekliyor, gelen kutusu aynı belgenin kopyalarıyla doluyordu. ETTN yoksa fatura
    numarası + tedarikçi VKN'si + tarih, o da yoksa belgenin özeti anahtar oluyor.
    """
    if parsed.get("uuid"):
        return "uuid:" + parsed["uuid"].strip().lower()
    number = (parsed.get("number") or "").strip().lower()
    if number:
        return "id:" + "|".join([number, ((parsed.get("supplier") or {}).get("tax_id") or "").strip(), (parsed.get("issue_date") or "")[:10]])
    # Numara yoksa geriye kalan alanlar tek başına kimlik değil: aynı tedarikçiden
    # ya da aynı günden gelen iki ayrı belge birbirinin kopyası sayılır ve ikincisi
    # sessizce yutulurdu. Kimlik yoksa belgenin kendi içeriği anahtar olur.
    if data:
        return "sha:" + hashlib.sha256(data).hexdigest()
    return "one:" + str(uuid.uuid4())


async def _existing(company_id: str, parsed: dict, key: str):
    hit = await _db.incoming_edocs.find_one({"company_id": company_id, "dedupe_key": key})
    if hit or not parsed.get("uuid"):
        return hit
    # dedupe_key alanı eklenmeden önce kaydedilmiş belgeler.
    return await _db.incoming_edocs.find_one({"company_id": company_id, "uuid": parsed["uuid"]})


async def _store(company_id: str, parsed: dict, key: str, source: str, filename: str, raw: Optional[bytes], meta: Optional[dict] = None):
    doc = {"_id": str(uuid.uuid4()), "company_id": company_id, "source": source, "filename": filename, "status": "pending",
           # Liste bilgisi saklanıyor: ham XML'den yeniden okuma, UBL'de hiç
           # olmayan tedarikçi / tutar / tarih bilgisini aksi halde silerdi.
           "received_at": _now(), "dedupe_key": key, "source_meta": meta_summary(meta), **parsed}
    await _enrich(doc, company_id)
    await _db.incoming_edocs.insert_one(doc)
    if raw and len(raw) <= MAX_XML_BYTES:
        # Ham XML ayrı koleksiyonda: gelen kutusu listesi 500 belgeyi çekerken taşımasın,
        # ama belge yanlış okunduğunda yeniden çözümleyebilelim / indirebilelim.
        await _db.incoming_edoc_xml.insert_one({"_id": doc["_id"], "company_id": company_id, "xml": raw.decode("utf-8", "replace"), "created_at": _now()})
    return doc


async def ingest_ubl_bytes(company_id: str, data: bytes, filename: str = "incoming.xml", source: str = "ubl_xml", meta: Optional[dict] = None):
    parsed = apply_meta(parse_ubl(data), meta)
    key = dedupe_key(parsed, data)
    if await _existing(company_id, parsed, key):
        return None
    return _clean(await _store(company_id, parsed, key, source, filename, data, meta))


def _clean(d: dict) -> dict:
    # source_meta yalnızca yeniden okuma için tutulan iç alan; API yanıtına girmez.
    d = dict(d); d["id"] = d.pop("_id"); d.pop("source_meta", None); return d


@router.get("/edocs/inbox")
async def list_inbox(company_id: str = "comp_nexus_main_01", status: Optional[str] = None):
    q: Dict[str, Any] = {"company_id": company_id}
    if status:
        q["status"] = status
    docs = [_clean(d) for d in await _db.incoming_edocs.find(q).sort("received_at", -1).to_list(500)]
    counts = {s: await _db.incoming_edocs.count_documents({"company_id": company_id, "status": s}) for s in ("pending", "approved", "rejected")}
    return {"items": docs, "counts": counts, "blank": sum(1 for d in docs if is_blank(d))}


def is_blank(d: dict) -> bool:
    """Okunamamış belge: ne tedarikçi, ne kalem, ne tutar. Onaylanacak bir şey yok."""
    return (d.get("status") == "pending" and not d.get("lines") and not (d.get("supplier") or {}).get("name")
            and not (d.get("supplier") or {}).get("tax_id") and not float(d.get("grand_total") or 0))


def _session_token(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        tok = auth[7:].strip()
        if tok:
            return tok
    cookie = (request.cookies.get("access_token") or "").strip()
    return cookie or None


async def require_inbox_company(request: Request, company_id: Optional[str] = None) -> str:
    """Ham XML / yeniden okuma / temizlik oturumsuz açılamaz.

    `get_current_user` token yoksa demo yöneticiye düşer; bu uçlar o yola
    girmeden önce çerezin veya Bearer'ın dolu olmasını ister. Şirket de
    sorgudan olduğu gibi kabul edilmez: üye olunmayan (ve süper admin
    olunmayan) bir `company_id` 403 olur, varsayılan hardcoded şirket yoktur.
    """
    if not _session_token(request):
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    get_user = _deps.get("current_user")
    if not get_user:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    user = await get_user(request)
    allowed = [c for c in (user.get("company_ids") or []) if c]
    cid = (company_id or "").strip() or (user.get("active_company_id") or "")
    if user.get("is_super_admin"):
        if not cid:
            raise HTTPException(status_code=400, detail="Şirket belirtilmedi.")
        return cid
    if not cid or cid not in allowed:
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")
    return cid


async def get_edoc_xml(doc_id: str, company_id: str):
    # Şirkete göre süzülüyor: ham UBL tedarikçi VKN'si, adresi ve kalem fiyatlarını
    # taşıyor, belge kimliği tahmin edilerek başka şirketin faturası okunmamalı.
    x = await _db.incoming_edoc_xml.find_one({"_id": doc_id, "company_id": company_id})
    if not x:
        raise HTTPException(status_code=404, detail="Bu belgenin ham XML'i saklanmamış (entegratörden yeniden çekin).")
    return {"id": doc_id, "xml": x.get("xml") or ""}


@router.get("/edocs/inbox/{doc_id}/xml")
async def get_edoc_xml_route(doc_id: str, request: Request, company_id: Optional[str] = None):
    return await get_edoc_xml(doc_id, await require_inbox_company(request, company_id))


async def reparse_inbox(company_id: str):
    """Saklanan ham XML'den okunamamış belgeleri yeniden okur (okuyucu düzeldiğinde eski kayıtları kurtarır).

    Yalnızca boş kalmış kayıtlara dokunur. Okunmuş bir belgeyi yeniden okumak,
    elle eşlenen satırların ve elle bağlanan carinin üzerine taze çözümlemenin
    boş değerlerini yazar; kullanıcının yaptığı iş kaybolur.
    """
    fixed, failed = 0, 0
    for d in await _db.incoming_edocs.find({"company_id": company_id, "status": "pending"}).to_list(500):
        if not is_blank(d):
            continue
        x = await _db.incoming_edoc_xml.find_one({"_id": d["_id"]})
        if not x or not x.get("xml"):
            continue
        try:
            parsed = apply_meta(parse_ubl(x["xml"].encode("utf-8")), d.get("source_meta"))
        except HTTPException:
            failed += 1
            continue
        doc = {**d, **parsed, "dedupe_key": dedupe_key(parsed, x["xml"].encode("utf-8"))}
        await _enrich(doc, company_id)
        # Elle bağlanmış cari, otomatik eşleşme bulunamadığında korunur.
        doc["contact_id"] = doc["contact_id"] or d.get("contact_id")
        doc["contact_name"] = doc["contact_name"] or d.get("contact_name")
        await _db.incoming_edocs.update_one({"_id": d["_id"]}, {"$set": {k: doc[k] for k in ("kind", "number", "uuid", "issue_date", "profile", "type_code", "supplier", "lines", "subtotal", "vat_total", "grand_total", "notes", "dedupe_key", "contact_id", "contact_name", "matched_lines")}})
        fixed += 1
    return {"status": "success", "fixed": fixed, "failed": failed,
            "message": f"{fixed} belge ham XML'den yeniden okundu." + (f" {failed} belge yine okunamadı." if failed else "")}


@router.post("/edocs/inbox/reparse")
async def reparse_inbox_route(request: Request, company_id: Optional[str] = None):
    return await reparse_inbox(await require_inbox_company(request, company_id))


async def cleanup_inbox(company_id: str):
    """Tedarikçisi, kalemi ve tutarı olmayan bekleyen kayıtları siler; entegratörden yeniden çekilebilirler."""
    ids = [d["_id"] for d in await _db.incoming_edocs.find({"company_id": company_id, "status": "pending"}).to_list(2000) if is_blank(d)]
    for i in ids:
        await _db.incoming_edocs.delete_one({"_id": i})
        await _db.incoming_edoc_xml.delete_one({"_id": i})
    return {"status": "success", "deleted": len(ids),
            "message": f"{len(ids)} boş kayıt silindi. Faturaları entegratörden yeniden çekebilirsiniz." if ids else "Silinecek boş kayıt yok."}


@router.post("/edocs/inbox/cleanup")
async def cleanup_inbox_route(request: Request, company_id: Optional[str] = None):
    return await cleanup_inbox(await require_inbox_company(request, company_id))


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
         "balance": 0.0, "credit_limit": 0.0, "category": "Tedarikçi", "is_e_invoice_user": d.get("source") in ("ubl_xml", "n11faturam"), "payment_term_days": 0, "late_fee_rate": 0.0, "b2b_enabled": False, "b2b_discount": 0.0, "source": "edoc_inbox", "created_at": _now()}
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
    ubl_like = d.get("source") in ("ubl_xml", "n11faturam")
    inv = {"_id": str(uuid.uuid4()), "company_id": d["company_id"], "invoice_number": d.get("number") or f"GELEN-{uuid.uuid4().hex[:6].upper()}", "invoice_type": "dispatch" if d["kind"] == "dispatch" else "purchase", "e_type": "e_dispatch" if d["kind"] == "dispatch" else ("e_invoice" if ubl_like else "paper"),
           "direction": "incoming", "contact_id": d["contact_id"], "contact_name": d["contact_name"], "contact_tax_id": d["supplier"].get("tax_id"), "issue_date": d.get("issue_date") or _now()[:10], "due_date": d.get("issue_date") or _now()[:10], "items": items, "subtotal": round(sub, 2), "vat_total": round(vat, 2), "discount_total": 0.0,
           "grand_total": round(gt, 2), "currency": "TRY", "status": "approved", "effects_applied": True,
           "gib_status": "Gelen E-Fatura (Yanıt Bekleniyor)" if ubl_like and d.get("kind") != "dispatch" else ("received" if ubl_like else None),
           "gib_uuid": d.get("uuid"), "payment_status": "unpaid" if d["kind"] == "invoice" else None, "paid_amount": 0.0, "notes": d.get("notes") or "", "source": "edoc_inbox", "edoc_id": doc_id, "created_at": _now()}
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
    await _db.incoming_edoc_xml.delete_one({"_id": doc_id})
    return {"status": "success"}
