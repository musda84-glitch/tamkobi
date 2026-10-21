"""Giden e-Fatura / e-Arşiv UBL-TR XML üretimi (imzasız arşiv kopyası). Gelen parse edocs.parse_ubl ile sınırlıdır."""
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from zoneinfo import ZoneInfo

_TR_TZ = ZoneInfo("Europe/Istanbul")


def default_issue_time() -> str:
    """GİB IssueTime — boşsa Europe/Istanbul saati (UTC değil)."""
    return datetime.now(_TR_TZ).strftime("%H:%M:%S")


_DRAFT_NOTE_MARK = re.compile(r"\s*\(taslak\)", re.IGNORECASE)


def strip_issued_invoice_note(notes: Any) -> str:
    """Sipariş taslağının otomatik notundaki '(taslak)' kesilen faturaya taşınmaz."""
    text = str(notes or "").strip()
    if not text or "oluşturuldu" not in text or not re.search(r"\(taslak\)", text, re.IGNORECASE):
        return text
    return _DRAFT_NOTE_MARK.sub("", text).strip()

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

import tenant_access
from line_totals import general_discount_tax_bases

router = APIRouter(prefix="/api")
_db = None
_current_user = None

INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
DESPATCH_NS = "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
EXT = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
EDOC_TYPES = ("e_invoice", "e_archive")
ET.register_namespace("despatch", DESPATCH_NS)
RETURN_INVOICE_TYPES = frozenset({"return", "sales_return", "purchase_return", "iade"})
UNIT_CODES = {
    "Adet": "C62", "adet": "C62", "C62": "C62", "NIU": "NIU",
    "Kg": "KGM", "kg": "KGM", "Kilogram": "KGM",
    "Lt": "LTR", "Litre": "LTR", "L": "LTR",
    "M": "MTR", "m": "MTR", "Metre": "MTR",
    "Paket": "PK", "Koli": "CT", "Saat": "HUR",
}

ET.register_namespace("", INVOICE_NS)
ET.register_namespace("cbc", CBC)
ET.register_namespace("cac", CAC)
ET.register_namespace("ext", EXT)


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="UBL auth bağlanmadı.")
    return await _current_user(request)


def is_outgoing_edoc(inv: Dict[str, Any]) -> bool:
    et = inv.get("e_type")
    if et not in EDOC_TYPES:
        return False
    itype = str(inv.get("invoice_type") or "").lower()
    if itype in ("sales", "sale") or itype in RETURN_INVOICE_TYPES:
        return True
    # Gelen alış dışındaki satış belgeleri
    if inv.get("direction") == "incoming" or inv.get("source") == "edoc_inbox":
        return False
    return itype not in ("purchase", "dispatch", "expense_slip", "proforma")


def _norm_invoice_type(value: Any) -> str:
    """Türkçe İ/ı dahil invoice_type karşılaştırması için ASCII-ish küçük harf."""
    s = str(value or "").strip().lower()
    return (
        s.replace("ı", "i")
        .replace("İ", "i")
        .replace("i̇", "i")  # İ.lower() → i + combining dot
        .replace("ş", "s")
        .replace("ğ", "g")
        .replace("ü", "u")
        .replace("ö", "o")
        .replace("ç", "c")
    )


def is_return_invoice(inv: Dict[str, Any]) -> bool:
    return _norm_invoice_type(inv.get("invoice_type")) in RETURN_INVOICE_TYPES


def has_withholding(inv: Dict[str, Any]) -> bool:
    """TamKobi tevkifat seçimi (withholding_rate / withholding_code) dolu mu?"""
    try:
        rate = float(inv.get("withholding_rate") or 0)
    except (TypeError, ValueError):
        rate = 0.0
    code = str(inv.get("withholding_code") or "").strip()
    try:
        amount = float(inv.get("withholding_amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    return rate > 0 or bool(code) or amount > 0


def withholding_parts(inv: Dict[str, Any], vat_total: Optional[float] = None) -> Optional[Tuple[str, float, float, float]]:
    """Tevkifat için (code, percent_0_100, taxable=vat, amount).

    withholding_rate 0.5 → Percent 50 (5/10). TaxableAmount = KDV tutarı.
    """
    if not has_withholding(inv):
        return None
    code = str(inv.get("withholding_code") or "").strip() or "603"
    try:
        rate = float(inv.get("withholding_rate") or 0)
    except (TypeError, ValueError):
        rate = 0.0
    if vat_total is None:
        try:
            vat_total = float(inv.get("vat_total") or 0)
        except (TypeError, ValueError):
            vat_total = 0.0
    vat_total = float(vat_total or 0)
    try:
        amount = float(inv.get("withholding_amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    if amount <= 0 and rate > 0 and vat_total > 0:
        amount = round(vat_total * rate, 2)
    percent = round(rate * 100.0, 2) if rate <= 1 else round(rate, 2)
    if percent <= 0 and vat_total > 0 and amount > 0:
        percent = round(amount / vat_total * 100.0, 2)
    return code, percent, vat_total, amount


# Sık kullanılan GİB vergi muafiyet / istisna kodları (TaxExemptionReasonCode)
TAX_EXEMPTION_REASONS: Dict[str, str] = {
    "301": "11/1-a Mal ihracatı",
    "302": "11/1-a Hizmet ihracatı",
    "308": "13/ı Külçe altın, kıymetli maden",
    "309": "13/e Konut teslimi",
    "318": "17/1 Kültür ve eğitim amacı taşıyan işlemler",
    "337": "17/4-g Serbest bölgelerdeki işlemler",
    "350": "Diğer istisnalar",
    "351": "İstisna olmayan diğer",
}


def invoice_has_zero_vat(inv: Dict[str, Any]) -> bool:
    try:
        if float(inv.get("vat_total") or 0) == 0:
            items = list(inv.get("items") or [])
            if items and all(float(it.get("vat_rate") or 0) == 0 for it in items):
                return True
    except (TypeError, ValueError):
        pass
    for it in inv.get("items") or []:
        try:
            if float(it.get("vat_rate") or 0) == 0:
                return True
        except (TypeError, ValueError):
            continue
    return False


def resolve_tax_exemption(
    inv: Dict[str, Any],
    item: Optional[Dict[str, Any]] = None,
) -> Optional[Tuple[str, str]]:
    """KDV %0 için (TaxExemptionReasonCode, TaxExemptionReason)."""
    code = ""
    if item:
        code = str(item.get("vat_exemption_code") or item.get("tax_exemption_code") or "").strip()
    if not code:
        code = str(
            inv.get("tax_exemption_code")
            or inv.get("vat_exemption_code")
            or inv.get("exemption_reason_code")
            or ""
        ).strip()
    if not code:
        return None
    # 301 / "301 – …" kabul et
    code = code.split("–")[0].split("-")[0].strip()
    code = "".join(ch for ch in code if ch.isdigit()) or code
    reason = str(
        (item or {}).get("vat_exemption_reason")
        or inv.get("tax_exemption_reason")
        or inv.get("vat_exemption_reason")
        or ""
    ).strip()
    if not reason:
        reason = TAX_EXEMPTION_REASONS.get(code) or f"Vergi muafiyet kodu {code}"
    return code, reason


def gib_invoice_type_code(inv: Dict[str, Any]) -> str:
    """GİB InvoiceTypeCode — İşNet/n11 UBL ve yapılandırılmış gönderim için.

    Açık invoice_type_code / gib_invoice_type varsa onu kullanır; yoksa
    TamKobi invoice_type (return…) → IADE, tevkifat → TEVKIFAT,
    KDV%0 + muafiyet → ISTISNA, aksi SATIS.
    """
    allowed = (
        "SATIS",
        "IADE",
        "TEVKIFAT",
        "TEVKIFATIADE",
        "ISTISNA",
        "OZELMATRAH",
        "IHRACKAYITLI",
    )
    raw = str(inv.get("invoice_type_code") or inv.get("gib_invoice_type") or "").strip()
    explicit = _norm_invoice_type(raw).upper()
    if explicit in allowed:
        return explicit
    returning = is_return_invoice(inv)
    withholding = has_withholding(inv)
    zero_vat = invoice_has_zero_vat(inv)
    # Tevkifat: KDV %0 (yalnızca istisna) faturalarda TEVKIFAT tipi kullanılmaz
    if returning and withholding and not zero_vat:
        return "TEVKIFATIADE"
    if returning:
        return "IADE"
    if withholding and not zero_vat:
        return "TEVKIFAT"
    if resolve_tax_exemption(inv) and zero_vat:
        return "ISTISNA"
    return "SATIS"


def withholding_tax_total_xml(
    inv: Dict[str, Any],
    currency: str,
    *,
    vat_total: Optional[float] = None,
    amount_override: Optional[float] = None,
) -> str:
    """cac:WithholdingTaxTotal UBL parçası (İşNet Send*Xml / n11 UBL)."""
    parts = withholding_parts(inv, vat_total)
    if not parts:
        return ""
    code, percent, taxable, amount = parts
    if amount_override is not None:
        amount = float(amount_override)
    if amount <= 0 and taxable <= 0:
        return ""
    from xml.sax.saxutils import escape as _xml_esc

    def _m(v: float) -> str:
        return f"{float(v):.2f}"

    return (
        f"<cac:WithholdingTaxTotal>"
        f"<cbc:TaxAmount currencyID=\"{_xml_esc(currency)}\">{_m(amount)}</cbc:TaxAmount>"
        f"<cac:TaxSubtotal>"
        f"<cbc:TaxableAmount currencyID=\"{_xml_esc(currency)}\">{_m(taxable)}</cbc:TaxableAmount>"
        f"<cbc:TaxAmount currencyID=\"{_xml_esc(currency)}\">{_m(amount)}</cbc:TaxAmount>"
        f"<cbc:Percent>{percent:g}</cbc:Percent>"
        f"<cac:TaxCategory>"
        f"<cac:TaxScheme>"
        f"<cbc:Name>KDV TEVKİFATI</cbc:Name>"
        f"<cbc:TaxTypeCode>{_xml_esc(code)}</cbc:TaxTypeCode>"
        f"</cac:TaxScheme>"
        f"</cac:TaxCategory>"
        f"</cac:TaxSubtotal>"
        f"</cac:WithholdingTaxTotal>"
    )


def return_billing_ref(inv: Dict[str, Any]) -> Optional[Tuple[str, str, str, str]]:
    """İade faturası için (original_id, issue_date, doc_type_code, doc_type)."""
    return _return_billing_ref(inv)


def _normalize_iade_doc_type_code(raw: Any) -> str:
    """GİB Schematron: DocumentTypeCode İADE (veya IADE) olmalı."""
    s = _norm_invoice_type(raw).upper().replace("İ", "I")
    if s in ("IADE", "RETURN", "IADEFATURA"):
        return "İADE"
    if s:
        # Kullanıcı özel kod verdiyse Türkçe İADE'ye zorla (Schematron)
        return "İADE"
    return "İADE"


def _return_billing_ref(inv: Dict[str, Any]) -> Optional[Tuple[str, str, str, str]]:
    """İade faturası için (original_id, issue_date, doc_type_code, doc_type)."""
    oid = (
        inv.get("original_invoice_number")
        or inv.get("return_of_invoice_number")
        or inv.get("billing_reference_id")
        or inv.get("referenced_invoice_number")
        or ""
    )
    oid = str(oid).strip()
    odate = (
        inv.get("original_issue_date")
        or inv.get("return_of_issue_date")
        or inv.get("billing_reference_date")
        or ""
    )
    odate = _date(odate) if odate else ""
    dtype = str(inv.get("billing_reference_type") or inv.get("original_document_type") or "").strip()
    dcode = _normalize_iade_doc_type_code(inv.get("billing_reference_type_code") or "İADE")
    if not oid:
        notes = str(inv.get("notes") or "")
        # «GHJ… numaralı» / «POS iade ← U05…» / genel fatura no
        for pat in (
            r"([A-Z]{2,3}\d{10,16})\s*numaral[ıi]",
            r"[←<]\s*([A-Z]{2,3}\d{10,16})",
            r"\b([A-Z]{2,3}\d{13,16})\b",
        ):
            m = re.search(pat, notes, re.I)
            if m:
                oid = m.group(1).upper()
                break
        m2 = re.search(r"(\d{2}[./]\d{2}[./]\d{4})\s*tarihli", notes)
        if m2 and not odate:
            raw = m2.group(1).replace(".", "-").replace("/", "-")
            parts = raw.split("-")
            if len(parts) == 3 and len(parts[2]) == 4:
                odate = f"{parts[2]}-{parts[1]}-{parts[0]}"
    if not oid:
        return None
    return oid, odate or _date(inv.get("issue_date")), dcode, dtype


def invoice_filename(inv: Dict[str, Any], ext: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", str(inv.get("invoice_number") or "fatura")).strip("._") or "fatura"
    return f"{name}.{ext}"


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def _cbc(parent, tag: str, text: Optional[str] = None, **attrib):
    el = ET.SubElement(parent, _q(CBC, tag), {k: str(v) for k, v in attrib.items() if v is not None})
    if text is not None:
        el.text = str(text)
    return el


def _cac(parent, tag: str):
    return ET.SubElement(parent, _q(CAC, tag))


def _iban_alnum(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isalnum()).upper()


def _add_payment_means(root, seller: Dict[str, Any], inv: Dict[str, Any], currency: str) -> None:
    """Şirket / fatura IBAN varsa PayeeFinancialAccount (tasarım IBAN bloğu)."""
    iban = _iban_alnum(inv.get("iban") or seller.get("iban"))
    if len(iban) < 15:
        return
    name = str(seller.get("bank_name") or inv.get("bank_name") or "").strip()
    pm = _cac(root, "PaymentMeans")
    _cbc(pm, "PaymentMeansCode", "42")
    acc = _cac(pm, "PayeeFinancialAccount")
    _cbc(acc, "ID", iban)
    if name:
        _cbc(acc, "Name", name[:120])
    _cbc(acc, "CurrencyCode", (currency or "TRY")[:3])


def _tax_category_kdv(
    parent,
    *,
    rate: float,
    inv: Dict[str, Any],
    item: Optional[Dict[str, Any]] = None,
):
    """TaxCategory + KDV TaxScheme; KDV%0 ise TaxExemptionReasonCode zorunlu."""
    cat = _cac(parent, "TaxCategory")
    if float(rate or 0) == 0:
        ex = resolve_tax_exemption(inv, item)
        if ex:
            code, reason = ex
            _cbc(cat, "TaxExemptionReasonCode", code)
            _cbc(cat, "TaxExemptionReason", reason[:200])
    sch = _cac(cat, "TaxScheme")
    _cbc(sch, "Name", "KDV")
    _cbc(sch, "TaxTypeCode", "0015")
    return cat


def _write_item_identifications(item_el, it: Dict[str, Any]) -> None:
    """UBL-TR Item: Name sonrası SellersItemIdentification, sonra AdditionalItemIdentification.

    Barkod metin ID olarak yazılır; görsel / StandardItemIdentification eklenmez.
    """
    sku = str(it.get("sku") or "").strip()
    if sku:
        sid = _cac(item_el, "SellersItemIdentification")
        _cbc(sid, "ID", sku[:50])
    barcode = str(it.get("barcode") or it.get("gtin") or "").strip()
    if barcode:
        aid = _cac(item_el, "AdditionalItemIdentification")
        _cbc(aid, "ID", barcode[:50])


def _amt(n: Any) -> str:
    try:
        return f"{float(n or 0):.2f}"
    except (TypeError, ValueError):
        return "0.00"


def _allowance_reason(inv: Dict[str, Any]) -> str:
    """ShopPHP havale indirimi ayrı sebep; diğer belge iskontoları genel iskonto."""
    channel = str(inv.get("source_channel") or inv.get("channel") or "").lower()
    notes = str(inv.get("notes") or "").lower()
    if channel == "shopphp" or "havale" in notes:
        return "Havale indirimi"
    return "Genel iskonto"


def _multiplier_factor(amount: float, base: float) -> str:
    if base <= 0:
        return "0"
    text = f"{(amount / base):.6f}".rstrip("0").rstrip(".")
    return text or "0"


def _add_document_allowance(root, inv: Dict[str, Any], amount: float, base: float, currency: str):
    """UBL-TR: PaymentMeans sonrası, TaxTotal öncesi belge iskontosu."""
    ac = _cac(root, "AllowanceCharge")
    _cbc(ac, "ChargeIndicator", "false")
    _cbc(ac, "AllowanceChargeReason", _allowance_reason(inv))
    _cbc(ac, "MultiplierFactorNumeric", _multiplier_factor(amount, base))
    _cbc(ac, "Amount", _amt(amount), currencyID=currency)
    _cbc(ac, "BaseAmount", _amt(base), currencyID=currency)
    return ac


def _snap_tax_lines(lines: list, key: str, target: Optional[float]) -> None:
    if target is None or not lines:
        return
    current = round(sum(float(line.get(key) or 0) for line in lines), 2)
    gap = round(float(target) - current, 2)
    if abs(gap) < 0.001:
        return
    lines[-1][key] = round(float(lines[-1].get(key) or 0) + gap, 2)


def _stored_money(inv: Dict[str, Any], key: str) -> Optional[float]:
    raw = inv.get(key)
    if raw in (None, ""):
        return None
    try:
        return round(float(raw), 2)
    except (TypeError, ValueError):
        return None


def _tax_after_document_discount(inv: Dict[str, Any], items: list, discount: float) -> Optional[Dict[str, Any]]:
    """İskonto varsa oran ve satır matrahı/KDV'si iskonto sonrası.

    İskontosuz belgede None döner; çağıran mevcut satır hesabını kullanır.
    """
    if discount <= 0.004 or not items:
        return None
    bases = general_discount_tax_bases(items, inv.get("general_discount_rate") or 0, discount)
    lines = bases.get("lines") or []
    if not lines:
        return None
    _snap_tax_lines(lines, "vat", _stored_money(inv, "vat_total"))
    _snap_tax_lines(lines, "taxable", _stored_money(inv, "subtotal"))
    by_rate: Dict[float, Dict[str, float]] = {}
    for line in lines:
        rate = float(line.get("rate") or 0)
        bucket = by_rate.setdefault(rate, {"rate": rate, "taxable": 0.0, "vat": 0.0})
        bucket["taxable"] = round(bucket["taxable"] + float(line["taxable"]), 2)
        bucket["vat"] = round(bucket["vat"] + float(line["vat"]), 2)
    return {
        "lines": lines,
        "by_rate": [by_rate[rate] for rate in sorted(by_rate, reverse=True)],
        "line_extension": float(bases.get("line_extension") or 0),
    }


def despatch_document_refs(inv: Dict[str, Any], fallback_date: str = "") -> list:
    """Her irsaliye için (numara, IssueDate). Çoklu birleştirmede sıra korunur."""
    numbers = [str(n).strip() for n in (inv.get("dispatch_numbers") or []) if str(n or "").strip()]
    dates = list(inv.get("dispatch_dates") or [])
    if numbers:
        out = []
        for i, num in enumerate(numbers):
            raw = dates[i] if i < len(dates) and dates[i] else (inv.get("dispatch_date") or fallback_date)
            out.append((num, _date(raw or fallback_date)))
        return out
    disp_no = str(inv.get("dispatch_number") or "").strip()
    if not disp_no:
        return []
    return [(disp_no, _date(inv.get("dispatch_date") or inv.get("issue_date") or fallback_date))]


def _date(s: Any) -> str:
    raw = str(s or "")[:10]
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        return raw
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _tax_id(raw: Any) -> Tuple[str, str]:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 11:
        return "TCKN", digits
    return "VKN", digits


def _fill_address(addr, party: Dict[str, Any], *, send_ready: bool = False):
    """UBL Address (DeliveryAddress / DespatchAddress / PostalAddress)."""
    street = (party.get("address") or party.get("street") or "").strip()
    if send_ready and not street:
        street = "-"
    if street:
        _cbc(addr, "StreetName", street[:200])
    district = str(party.get("district") or party.get("tax_office") or party.get("city") or "").strip()
    if send_ready and (not district or district in ("-", ".")):
        district = str(party.get("city") or "Merkez").strip() or "Merkez"
    if district:
        _cbc(addr, "CitySubdivisionName", district[:60])
    city = str(party.get("city") or "").strip()
    if send_ready and not city:
        city = "İstanbul"
    if city:
        _cbc(addr, "CityName", city[:60])
    country = _cac(addr, "Country")
    _cbc(country, "Name", "Türkiye")
    return addr


def _party(parent_tag, party: Dict[str, Any], parent, *, send_ready: bool = False):
    """UBL Party. send_ready: İşNet .NET parse için kimlik/adres/vergi dairesi boş bırakılmaz."""
    wrap = _cac(parent, parent_tag)
    p = _cac(wrap, "Party")
    scheme, tid = _tax_id(party.get("tax_id") or party.get("tax_number") or party.get("tax_number_or_id"))
    if send_ready and len(tid) not in (10, 11):
        # e-Arşiv nihai tüketici / eksik cari VKN — İşNet PartyIdentification null NRE
        tid, scheme = "11111111111", "TCKN"
    if tid or send_ready:
        ident = _cac(p, "PartyIdentification")
        _cbc(ident, "ID", tid or "11111111111", schemeID=scheme or "TCKN")
    name = (party.get("name") or "").strip()
    if send_ready and not name:
        name = "Nihai Tüketici" if scheme == "TCKN" else "Alıcı"
    if name:
        pn = _cac(p, "PartyName")
        _cbc(pn, "Name", name[:200])
    addr = _cac(p, "PostalAddress")
    street = (party.get("address") or party.get("street") or "").strip()
    if send_ready and not street:
        street = "-"
    if street:
        _cbc(addr, "StreetName", street[:200])
    district = (
        party.get("district") or party.get("tax_office") or party.get("city") or ""
    )
    district = str(district).strip()
    if send_ready and (not district or district in ("-", ".")):
        district = str(party.get("city") or "Merkez").strip() or "Merkez"
    if district:
        _cbc(addr, "CitySubdivisionName", district[:60])
    city = str(party.get("city") or "").strip()
    if send_ready and not city:
        city = "İstanbul"
    if city:
        _cbc(addr, "CityName", city[:60])
    country = _cac(addr, "Country")
    _cbc(country, "Name", "Türkiye")
    office = (party.get("tax_office") or "").strip()
    # İşNet örnekleri her zaman PartyTaxScheme içerir
    if office or send_ready:
        pts = _cac(p, "PartyTaxScheme")
        ts = _cac(pts, "TaxScheme")
        _cbc(ts, "Name", (office or "Vergi Dairesi")[:80])
    email = (party.get("email") or "").strip()
    phone = (party.get("phone") or "").strip()
    # Boş Contact (çocuk yok) .NET'te NRE; yalnızca dolu alanlar
    if email or phone:
        contact = _cac(p, "Contact")
        if phone:
            _cbc(contact, "Telephone", phone[:30])
        if email:
            _cbc(contact, "ElectronicMail", email[:120])
    if send_ready and scheme == "TCKN" and name:
        parts = name.split(None, 1)
        person = _cac(p, "Person")
        _cbc(person, "FirstName", (parts[0] if parts else "Ad")[:60])
        _cbc(person, "FamilyName", (parts[1] if len(parts) > 1 else "Soyad")[:60])
    return p


def _stable_uuid(inv: Dict[str, Any]) -> str:
    existing = (inv.get("gib_uuid") or "").strip()
    if existing:
        return existing
    raw = str(inv.get("_id") or inv.get("id") or uuid.uuid4())
    try:
        return str(uuid.UUID(raw))
    except ValueError:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tamkobi-invoice:{raw}"))


def _qr_rate_key(rate: float) -> str:
    """GİB karekod oran anahtarı: 20.0 → '20', 8.0 → '8'."""
    try:
        n = float(rate or 0)
    except (TypeError, ValueError):
        n = 0.0
    if n.is_integer():
        return str(int(n))
    return f"{n:g}"


def _line_tax_subtotals_by_rate(inv: Dict[str, Any]) -> Dict[str, Tuple[float, float]]:
    """Satır TaxSubtotal karşılığı: oran → (matrah, hesaplanan KDV)."""
    buckets: Dict[str, Tuple[float, float]] = {}
    for it in inv.get("items") or []:
        try:
            rate = float(it.get("vat_rate") or 0)
        except (TypeError, ValueError):
            rate = 0.0
        try:
            net = float(it.get("total") or 0)
        except (TypeError, ValueError):
            net = 0.0
        try:
            vat = float(it.get("vat_amount") or 0)
        except (TypeError, ValueError):
            vat = 0.0
        if vat <= 0 and rate:
            vat = round(net * rate / 100.0, 2)
        key = _qr_rate_key(rate)
        prev_m, prev_k = buckets.get(key, (0.0, 0.0))
        buckets[key] = (round(prev_m + net, 2), round(prev_k + vat, 2))
    return buckets


def gib_qr_fields(
    inv: Dict[str, Any],
    seller: Dict[str, Any],
    buyer: Dict[str, Any],
    *,
    profile: str,
    currency: str,
    subtotal: float,
    vat_total: float,
    grand: float,
    issue_date: str,
    tip: str = "",
) -> Dict[str, str]:
    """GİB karekod alanları: satıcı VKN, alıcı VKN, ETTN, tarih, tutarlar.

    İşNet karekod görselini XSLT şablonundaki qrCodeImageString yer tutucusuna basar.
    Oran bazlı: her KDV oranı için kdvmatrah(<oran>) ve hesaplanankdv(<oran>)
    satır TaxSubtotal tutarlarından toplanır.
    """
    seller_tax = "".join(ch for ch in str(seller.get("tax_number") or seller.get("tax_id") or "") if ch.isdigit())
    buyer_tax = "".join(
        ch for ch in str(
            buyer.get("tax_number_or_id") or buyer.get("tax_number") or inv.get("contact_tax_id") or ""
        ) if ch.isdigit()
    )
    inclusive = round(float(subtotal or 0) + float(vat_total or 0), 2)
    fields = {
        "vkntckn": seller_tax,
        "avkntckn": buyer_tax,
        "senaryo": profile or "",
        "tip": tip or str(inv.get("invoice_type_code") or ""),
        "tarih": issue_date,
        "no": str(inv.get("invoice_number") or ""),
        "ettn": _stable_uuid(inv),
        "parabirimi": currency or "TRY",
        "malhizmettoplam": f"{float(subtotal or 0):.2f}",
        "hesaplanankdv": f"{float(vat_total or 0):.2f}",
        "vergidahil": f"{inclusive:.2f}",
        "odenecek": f"{float(grand or 0):.2f}",
    }
    for rate_key, (matrah, kdv) in sorted(
        _line_tax_subtotals_by_rate(inv).items(), key=lambda kv: -float(kv[0])
    ):
        fields[f"kdvmatrah({rate_key})"] = f"{matrah:.2f}"
        fields[f"hesaplanankdv({rate_key})"] = f"{kdv:.2f}"
    return fields


_VISUAL_DOC_TYPES = frozenset({"QRCODE", "KAREKOD", "LOGO", "IMZA"})


def _fold_doc_token(value: Any) -> str:
    text = str(value or "").strip().upper().replace("İ", "I")
    return re.sub(r"\s+", "", text)


def _visual_ubl_error(found: str) -> str:
    return (
        "Belge gönderilemedi. İşNet, belge içerisinde yer alan logo, imza, QR kod veya barkod "
        "benzeri görsel içeriklerin XSLT şablonu üzerinden iletilmesini ister. "
        f"UBL ekine gömülü görsel kabul edilmez ({found}). "
        "İzin verilen tek gömülü ek XSLT'dir (application/xml, .xslt). "
        "Karekod için qrCodeImageString, logo için firmaLogoImageString, "
        "imza için firmaImzaImageString yer tutucusu kullanılır."
    )


def assert_send_ready_has_no_visuals(root) -> None:
    """send_ready UBL: görsel AdditionalDocumentReference yok; gömülü ek yalnızca XSLT."""
    for adr in root.findall(f".//{_q(CAC, 'AdditionalDocumentReference')}"):
        for label, raw in (
            ("DocumentType", adr.findtext(_q(CBC, "DocumentType"))),
            ("DocumentTypeCode", adr.findtext(_q(CBC, "DocumentTypeCode"))),
            ("ID", adr.findtext(_q(CBC, "ID"))),
        ):
            token = _fold_doc_token(raw)
            if token in _VISUAL_DOC_TYPES:
                raise ValueError(_visual_ubl_error(f"{label}={token}"))
        for blob in adr.findall(f".//{_q(CBC, 'EmbeddedDocumentBinaryObject')}"):
            mime = (blob.get("mimeCode") or "").strip().lower()
            filename = (blob.get("filename") or "").strip()
            if mime.startswith("image/"):
                raise ValueError(_visual_ubl_error(
                    f"mimeCode={mime}, dosya={filename or 'adsız'}"
                ))
            if mime != "application/xml" or not filename.lower().endswith(".xslt"):
                raise ValueError(_visual_ubl_error(
                    f"mimeCode={mime or '—'}, dosya={filename or 'adsız'}"
                ))
            kinds = {
                _fold_doc_token(adr.findtext(_q(CBC, "DocumentType"))),
                _fold_doc_token(adr.findtext(_q(CBC, "DocumentTypeCode"))),
            }
            kinds.discard("")
            if "XSLT" not in kinds:
                raise ValueError(_visual_ubl_error(
                    f"DocumentType={next(iter(kinds), '—')}, dosya={filename}"
                ))


def attach_xslt_stylesheet(root, xslt: str, issue_date: str, filename: str = "efatura.xslt") -> None:
    """GİB: AdditionalDocumentReference / DocumentType=XSLT (düz Base64, gzip yok)."""
    text = str(xslt or "").strip()
    if "<xsl:stylesheet" not in text and "<xsl:transform" not in text:
        return
    import einvoice_designs
    payload = einvoice_designs.plain_xslt_b64(text)
    adr = _cac(root, "AdditionalDocumentReference")
    _cbc(adr, "ID", str(uuid.uuid4()))
    _cbc(adr, "IssueDate", issue_date)
    _cbc(adr, "DocumentType", "XSLT")
    att = _cac(adr, "Attachment")
    _cbc(
        att,
        "EmbeddedDocumentBinaryObject",
        payload,
        mimeCode="application/xml",
        encodingCode="Base64",
        characterSetCode="UTF-8",
        filename=filename,
    )


def build_invoice_ubl(
    inv: Dict[str, Any],
    seller: Dict[str, Any],
    buyer: Dict[str, Any],
    *,
    send_ready: bool = False,
    xslt: Optional[str] = None,
) -> bytes:
    """UBL-TR Invoice XML. parse_ubl ile okunabilir.

    İşNet test başarılı örnekleriyle uyum: SATIS/TICARIFATURA, IADE/TEMELFATURA + BillingReference,
    TEVKIFAT + WithholdingTaxTotal.

    send_ready=True: İşNet Send*Xml için UBLExtensions + Signature (+ e-Arşiv GONDERIMSEKLI).
    """
    e_type = inv.get("e_type") or "e_archive"
    profile = inv.get("_profile_override") or inv.get("gib_scenario")
    if profile not in ("TEMELFATURA", "TICARIFATURA", "EARSIVFATURA", "IHRACAT"):
        profile = "TICARIFATURA" if e_type == "e_invoice" else "EARSIVFATURA"
    type_code = gib_invoice_type_code(inv)
    returning = type_code in ("IADE", "TEVKIFATIADE") or is_return_invoice(inv)
    # GİB Schematron: IADE / TEVKIFATIADE → TICARIFATURA yasak (TEMELFATURA vb.)
    _IADE_PROFILES = frozenset({
        "TEMELFATURA", "EARSIVFATURA", "ILAC_TIBBICIHAZ", "YATIRIMTESVIK", "IDIS", "KAMU",
    })
    if returning and type_code in ("IADE", "TEVKIFATIADE"):
        if profile == "TICARIFATURA" or profile not in _IADE_PROFILES:
            if e_type == "e_archive" or profile == "EARSIVFATURA":
                profile = "EARSIVFATURA"
            else:
                profile = "TEMELFATURA"
    items = list(inv.get("items") or [])
    if send_ready and invoice_has_zero_vat(inv) and not resolve_tax_exemption(inv):
        # Satırda kod varsa fatura düzeyinde yoksa yine kabul (satırdan alınır)
        line_ok = any(
            resolve_tax_exemption(inv, it)
            for it in items
            if float(it.get("vat_rate") or 0) == 0
        )
        if not line_ok:
            raise ValueError(
                "KDV %0 satırlarda vergi muafiyet sebebi (TaxExemptionReasonCode) zorunlu. "
                "E-fatura onayında muafiyet kodunu seçin."
            )
    currency = (inv.get("currency") or "TRY").upper()
    subtotal = float(inv.get("subtotal") or 0)
    vat_total = float(inv.get("vat_total") or 0)
    withhold_amt = float(inv.get("withholding_amount") or 0)
    if withhold_amt <= 0 and has_withholding(inv):
        wp = withholding_parts(inv, vat_total)
        withhold_amt = float(wp[3]) if wp else 0.0
    grand = float(inv.get("grand_total") or 0)
    if not grand:
        grand = round(subtotal + vat_total - withhold_amt, 2)
    discount = float(inv.get("discount_total") or inv.get("general_discount_amount") or 0)
    issue_date = _date(inv.get("issue_date"))

    root = ET.Element(_q(INVOICE_NS, "Invoice"))
    if send_ready:
        exts = ET.SubElement(root, _q(EXT, "UBLExtensions"))
        ext_one = ET.SubElement(exts, _q(EXT, "UBLExtension"))
        ET.SubElement(ext_one, _q(EXT, "ExtensionContent"))
    _cbc(root, "UBLVersionID", "2.1")
    _cbc(root, "CustomizationID", "TR1.2")
    _cbc(root, "ProfileID", profile)
    _cbc(root, "ID", inv.get("invoice_number") or "")
    _cbc(root, "CopyIndicator", "false")
    _cbc(root, "UUID", _stable_uuid(inv))
    _cbc(root, "IssueDate", issue_date)
    issue_time = (inv.get("issue_time") or "").strip()
    if not issue_time:
        issue_time = default_issue_time()
    _cbc(root, "IssueTime", issue_time[:8] if len(issue_time) >= 8 else issue_time)
    _cbc(root, "InvoiceTypeCode", type_code)
    notes = strip_issued_invoice_note(inv.get("notes"))
    if notes:
        _cbc(root, "Note", notes[:500])
    if inv.get("gib_tracking_id"):
        _cbc(root, "Note", f"ETTN/Takip: {inv['gib_tracking_id']}")
    _cbc(root, "DocumentCurrencyCode", currency)
    _cbc(root, "LineCountNumeric", str(len(items) or 1))

    # UBL sıra: BillingReference → DespatchDocumentReference → AdditionalDocumentReference → Signature
    # İade: orijinal satış faturasına BillingReference (GİB Schematron zorunlu)
    if returning:
        bref = _return_billing_ref(inv)
        if not bref and send_ready:
            raise ValueError(
                "İade e-faturası için orijinal fatura no (BillingReference) zorunlu. "
                "Notlara «… numaralı faturaya istinaden» yazın veya original_invoice_number girin."
            )
        if bref:
            oid, odate, dcode, dtype = bref
            br = _cac(root, "BillingReference")
            idr = _cac(br, "InvoiceDocumentReference")
            _cbc(idr, "ID", oid)
            _cbc(idr, "IssueDate", odate or issue_date)
            _cbc(idr, "DocumentTypeCode", dcode or "İADE")
            if dtype:
                _cbc(idr, "DocumentType", dtype[:120])

    for disp_id, disp_date in despatch_document_refs(inv, issue_date):
        dref = _cac(root, "DespatchDocumentReference")
        _cbc(dref, "ID", disp_id)
        _cbc(dref, "IssueDate", disp_date)

    if send_ready and (e_type == "e_archive" or profile == "EARSIVFATURA"):
        buyer_email = str(buyer.get("email") or inv.get("contact_email") or "").strip()
        send_type = str(inv.get("earchive_send_type") or inv.get("sending_type") or "").strip().upper()
        if send_type not in ("ELEKTRONIK", "KAGIT"):
            send_type = "ELEKTRONIK" if buyer_email else "KAGIT"
        if send_type == "ELEKTRONIK" and not buyer_email:
            send_type = "KAGIT"
        internet = str(inv.get("internet_sale") or "HAYIR").strip().upper()
        if internet not in ("EVET", "HAYIR"):
            internet = "HAYIR"
        for doc_type, desc in (("GONDERIMSEKLI", send_type), ("INTERNETSATISI", internet)):
            adr = _cac(root, "AdditionalDocumentReference")
            _cbc(adr, "ID", str(uuid.uuid4()))
            _cbc(adr, "IssueDate", issue_date)
            _cbc(adr, "DocumentType", doc_type)
            _cbc(adr, "DocumentDescription", desc)

    disp_no = str(inv.get("dispatch_number") or "").strip()
    if disp_no:
        adr = _cac(root, "AdditionalDocumentReference")
        _cbc(adr, "ID", disp_no)
        _cbc(adr, "IssueDate", _date(inv.get("dispatch_date") or inv.get("issue_date")))
        _cbc(adr, "DocumentTypeCode", "IRSALIYE")
        _cbc(adr, "DocumentType", "İrsaliye")

    if xslt:
        attach_xslt_stylesheet(
            root,
            xslt,
            issue_date,
            filename="earsiv.xslt" if (e_type == "e_archive" or profile == "EARSIVFATURA") else "efatura.xslt",
        )

    seller_party = {
        "name": seller.get("name"),
        "tax_id": seller.get("tax_number") or seller.get("tax_id"),
        "tax_office": seller.get("tax_office"),
        "address": seller.get("address"),
        "city": seller.get("city"),
        "phone": seller.get("phone"),
        "email": seller.get("email"),
        "district": seller.get("district"),
    }
    buyer_party = {
        "name": buyer.get("name") or inv.get("contact_name"),
        "tax_id": buyer.get("tax_number_or_id") or buyer.get("tax_number") or inv.get("contact_tax_id"),
        "tax_office": buyer.get("tax_office"),
        "address": buyer.get("address"),
        "city": buyer.get("city"),
        "phone": buyer.get("phone"),
        "email": buyer.get("email"),
    }
    if send_ready:
        # İşNet Send*Xml: dolu Signature (ExtensionContent entegratörde imzalanır)
        seller_tax = "".join(ch for ch in str(seller_party.get("tax_id") or "") if ch.isdigit())
        seller_scheme = "VKN" if len(seller_tax) == 10 else "TCKN"
        if len(seller_tax) not in (10, 11):
            seller_tax, seller_scheme = (seller_tax.zfill(10)[:10] or "0000000000"), "VKN"
        sig = _cac(root, "Signature")
        _cbc(sig, "ID", seller_tax, schemeID="VKN_TCKN")
        sparty = _cac(sig, "SignatoryParty")
        sid = _cac(sparty, "PartyIdentification")
        _cbc(sid, "ID", seller_tax, schemeID=seller_scheme)
        addr = _cac(sparty, "PostalAddress")
        _cbc(addr, "StreetName", str(seller.get("address") or "-") or "-")
        district = (
            seller.get("district") or seller.get("tax_office") or seller.get("city") or "Merkez"
        )
        district = str(district).strip() or "Merkez"
        if district in ("-", "."):
            district = str(seller.get("city") or "Merkez")
        _cbc(addr, "CitySubdivisionName", district)
        _cbc(addr, "CityName", str(seller.get("city") or "İstanbul"))
        country = _cac(addr, "Country")
        _cbc(country, "Name", "Türkiye")
        dsa = _cac(sig, "DigitalSignatureAttachment")
        eref = _cac(dsa, "ExternalReference")
        _cbc(eref, "URI", "#Signature")

    _party("AccountingSupplierParty", seller_party, root, send_ready=send_ready)
    _party("AccountingCustomerParty", buyer_party, root, send_ready=send_ready)
    _add_payment_means(root, seller, inv, currency)
    discounted_tax = _tax_after_document_discount(inv, items, discount)
    if discounted_tax:
        allowance_base = float(discounted_tax.get("line_extension") or 0)
        if allowance_base <= 0:
            allowance_base = round(subtotal + discount, 2)
        _add_document_allowance(root, inv, discount, allowance_base, currency)

    tax_total = _cac(root, "TaxTotal")
    _cbc(tax_total, "TaxAmount", _amt(vat_total), currencyID=currency)
    if discounted_tax:
        grouped = list(discounted_tax.get("by_rate") or [])
        if not grouped:
            grouped = [{"rate": 0.0, "taxable": subtotal, "vat": vat_total}]
        for row in grouped:
            rate = float(row.get("rate") or 0)
            sub = _cac(tax_total, "TaxSubtotal")
            _cbc(sub, "TaxableAmount", _amt(row.get("taxable")), currencyID=currency)
            _cbc(sub, "TaxAmount", _amt(row.get("vat")), currencyID=currency)
            _cbc(sub, "Percent", f"{rate:g}")
            _tax_category_kdv(sub, rate=rate, inv=inv)
    else:
        by_rate: Dict[float, float] = {}
        taxable_by_rate: Dict[float, float] = {}
        for it in items:
            rate = float(it.get("vat_rate") or 0)
            net = float(it.get("total") or 0)
            by_rate[rate] = by_rate.get(rate, 0) + net * rate / 100
            taxable_by_rate[rate] = taxable_by_rate.get(rate, 0) + net
        if not by_rate and vat_total:
            by_rate[20.0] = vat_total
            taxable_by_rate[20.0] = subtotal
        # İşNet .NET: TaxTotal.TaxSubtotal null → "Object reference not set..."
        if not by_rate:
            by_rate[0.0] = 0.0
            taxable_by_rate[0.0] = subtotal
        for rate, amount in sorted(by_rate.items(), key=lambda x: -x[0]):
            sub = _cac(tax_total, "TaxSubtotal")
            taxable = taxable_by_rate.get(rate, 0) or subtotal
            _cbc(sub, "TaxableAmount", _amt(taxable), currencyID=currency)
            _cbc(sub, "TaxAmount", _amt(amount), currencyID=currency)
            _cbc(sub, "Percent", f"{rate:g}")
            _tax_category_kdv(sub, rate=rate, inv=inv)

    # Tevkifat: WithholdingTaxTotal (TaxTypeCode = 601…615; 9015 değil)
    wp = withholding_parts(inv, vat_total)
    if wp:
        code, percent, taxable, amount = wp
        # Sıfır tevkifat tutarıyla boş blok İşNet'te NRE üretebilir
        if amount > 0 or taxable > 0:
            wtt = _cac(root, "WithholdingTaxTotal")
            _cbc(wtt, "TaxAmount", _amt(amount), currencyID=currency)
            wsub = _cac(wtt, "TaxSubtotal")
            _cbc(wsub, "TaxableAmount", _amt(taxable), currencyID=currency)
            _cbc(wsub, "TaxAmount", _amt(amount), currencyID=currency)
            _cbc(wsub, "Percent", f"{percent:g}")
            wcat = _cac(wsub, "TaxCategory")
            wsch = _cac(wcat, "TaxScheme")
            _cbc(wsch, "Name", "KDV TEVKİFATI")
            _cbc(wsch, "TaxTypeCode", code)

    totals = _cac(root, "LegalMonetaryTotal")
    if discounted_tax and items:
        legal_line_ext = round(sum(float(it.get("total") or 0) for it in items), 2)
    else:
        legal_line_ext = subtotal + discount if discount else subtotal
    _cbc(totals, "LineExtensionAmount", _amt(legal_line_ext), currencyID=currency)
    _cbc(totals, "TaxExclusiveAmount", _amt(subtotal), currencyID=currency)
    _cbc(totals, "TaxInclusiveAmount", _amt(subtotal + vat_total), currencyID=currency)
    # İşNet örnekleri AllowanceTotalAmount'u her zaman gönderir (0.00 dahil)
    _cbc(totals, "AllowanceTotalAmount", _amt(discount), currencyID=currency)
    _cbc(totals, "PayableAmount", _amt(grand), currencyID=currency)

    if not items:
        items = [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": subtotal, "vat_rate": 20, "total": subtotal}]
    wh_rate = float(inv.get("withholding_rate") or 0)
    wh_code = str(inv.get("withholding_code") or "").strip()
    for i, it in enumerate(items, 1):
        line = _cac(root, "InvoiceLine")
        _cbc(line, "ID", str(i))
        qty = float(it.get("quantity") or 1) or 1
        unit = UNIT_CODES.get(str(it.get("unit") or "Adet"), "C62")
        _cbc(line, "InvoicedQuantity", _amt(qty), unitCode=unit)
        net = float(it.get("total") or 0)
        _cbc(line, "LineExtensionAmount", _amt(net), currencyID=currency)
        rate = float(it.get("vat_rate") or 0)
        if discounted_tax and i - 1 < len(discounted_tax["lines"]):
            taxed = discounted_tax["lines"][i - 1]
            line_taxable = float(taxed.get("taxable") or 0)
            line_vat = float(taxed.get("vat") or 0)
        else:
            line_taxable = net
            line_vat = round(net * rate / 100.0, 2)
        lt = _cac(line, "TaxTotal")
        _cbc(lt, "TaxAmount", _amt(line_vat), currencyID=currency)
        ls = _cac(lt, "TaxSubtotal")
        # İşNet resmi örnek / n11: satır TaxSubtotal'da tutar + TaxCategory zorunlu
        _cbc(ls, "TaxableAmount", _amt(line_taxable), currencyID=currency)
        _cbc(ls, "TaxAmount", _amt(line_vat), currencyID=currency)
        _cbc(ls, "CalculationSequenceNumeric", "1")
        _cbc(ls, "Percent", f"{rate:g}")
        _tax_category_kdv(ls, rate=rate, inv=inv, item=it)
        if wh_code and wh_rate > 0 and line_vat > 0:
            line_wh = round(line_vat * wh_rate, 2)
            lwt = _cac(line, "WithholdingTaxTotal")
            _cbc(lwt, "TaxAmount", _amt(line_wh), currencyID=currency)
            lws = _cac(lwt, "TaxSubtotal")
            _cbc(lws, "TaxableAmount", _amt(line_vat), currencyID=currency)
            _cbc(lws, "TaxAmount", _amt(line_wh), currencyID=currency)
            _cbc(lws, "Percent", f"{(wh_rate * 100):g}")
            lwcat = _cac(lws, "TaxCategory")
            lwsch = _cac(lwcat, "TaxScheme")
            _cbc(lwsch, "Name", "KDV TEVKİFATI")
            _cbc(lwsch, "TaxTypeCode", wh_code)
        item_el = _cac(line, "Item")
        _cbc(item_el, "Name", str(it.get("name") or "Kalem")[:200])
        _write_item_identifications(item_el, it)
        price = _cac(line, "Price")
        unit_price = float(it.get("unit_price") or 0)
        _cbc(price, "PriceAmount", _amt(unit_price), currencyID=currency)

    if send_ready:
        assert_send_ready_has_no_visuals(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _buyer_from(inv: Dict[str, Any], contact: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    c = contact or {}
    from buyer_tax import buyer_tax_choice
    return {
        "name": c.get("name") or inv.get("contact_name") or "",
        "tax_number_or_id": buyer_tax_choice(inv, c)["tax"],
        "tax_office": c.get("tax_office") or "",
        "address": c.get("address") or inv.get("shipping_address") or "",
        "city": c.get("city") or inv.get("city") or "",
        "district": c.get("district") or inv.get("district") or "",
        "phone": c.get("phone") or inv.get("customer_phone") or "",
        "email": c.get("email") or "",
    }


def _despatch_transport(inv: Dict[str, Any]) -> Dict[str, str]:
    """Plaka / sürücü / taşıyıcı — belge alanı veya despatch_defaults."""
    from despatch_shipment import transport_from

    return transport_from(inv)


def build_despatch_ubl(
    inv: Dict[str, Any],
    seller: Dict[str, Any],
    buyer: Dict[str, Any],
    *,
    send_ready: bool = False,
    xslt: Optional[str] = None,
) -> bytes:
    """UBL-TR DespatchAdvice (TEMELIRSALIYE / SEVK) — İşNet SendDespatchAdviceXml."""
    items = list(inv.get("items") or [])
    if not items:
        items = [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": 0, "total": 0}]
    issue_date = _date(inv.get("issue_date"))
    issue_time = (inv.get("issue_time") or "").strip()
    if not issue_time:
        issue_time = default_issue_time()
    transport = _despatch_transport(inv)
    if send_ready:
        from despatch_shipment import shipment_error_message

        message = shipment_error_message(inv, seller)
        if message:
            raise ValueError(message)

    root = ET.Element(_q(DESPATCH_NS, "DespatchAdvice"))
    if send_ready:
        exts = ET.SubElement(root, _q(EXT, "UBLExtensions"))
        ext_one = ET.SubElement(exts, _q(EXT, "UBLExtension"))
        ET.SubElement(ext_one, _q(EXT, "ExtensionContent"))
    _cbc(root, "UBLVersionID", "2.1")
    _cbc(root, "CustomizationID", "TR1.2")
    _cbc(root, "ProfileID", "TEMELIRSALIYE")
    _cbc(root, "ID", inv.get("invoice_number") or inv.get("dispatch_number") or "")
    _cbc(root, "CopyIndicator", "false")
    _cbc(root, "UUID", _stable_uuid(inv))
    _cbc(root, "IssueDate", issue_date)
    _cbc(root, "IssueTime", issue_time[:8] if len(issue_time) >= 8 else issue_time)
    _cbc(root, "DespatchAdviceTypeCode", "SEVK")
    notes = (inv.get("notes") or "").strip()
    if notes:
        _cbc(root, "Note", notes[:500])
    if transport["plate"]:
        _cbc(root, "Note", f"Plaka: {transport['plate']}")
    if transport.get("tracking"):
        _cbc(root, "Note", f"Kargo takip no: {transport['tracking'][:80]}")
    _cbc(root, "LineCountNumeric", str(len(items)))

    inv_ref = str(
        inv.get("invoice_ref_number")
        or inv.get("converted_invoice_number")
        or ""
    ).strip()
    if inv_ref:
        adr = _cac(root, "AdditionalDocumentReference")
        _cbc(adr, "ID", inv_ref)
        _cbc(adr, "IssueDate", _date(inv.get("invoice_ref_date") or inv.get("issue_date")))
        _cbc(adr, "DocumentTypeCode", "FATURA")
        _cbc(adr, "DocumentType", "Fatura")

    if xslt:
        attach_xslt_stylesheet(root, xslt, issue_date, filename="eirsaliye.xslt")

    seller_party = {
        "name": seller.get("name"),
        "tax_id": seller.get("tax_number") or seller.get("tax_id"),
        "tax_office": seller.get("tax_office"),
        "address": seller.get("address"),
        "city": seller.get("city"),
        "phone": seller.get("phone"),
        "email": seller.get("email"),
        "district": seller.get("district"),
    }
    buyer_party = {
        "name": buyer.get("name") or inv.get("contact_name"),
        "tax_id": buyer.get("tax_number_or_id") or buyer.get("tax_number") or inv.get("contact_tax_id"),
        "tax_office": buyer.get("tax_office"),
        "address": buyer.get("address") or inv.get("shipping_address"),
        "city": buyer.get("city") or inv.get("city"),
        "phone": buyer.get("phone") or inv.get("customer_phone"),
        "email": buyer.get("email"),
    }

    if send_ready:
        seller_tax = "".join(ch for ch in str(seller_party.get("tax_id") or "") if ch.isdigit())
        seller_scheme = "VKN" if len(seller_tax) == 10 else "TCKN"
        if len(seller_tax) not in (10, 11):
            seller_tax, seller_scheme = (seller_tax.zfill(10)[:10] or "0000000000"), "VKN"
        sig = _cac(root, "Signature")
        _cbc(sig, "ID", seller_tax, schemeID="VKN_TCKN")
        sparty = _cac(sig, "SignatoryParty")
        sid = _cac(sparty, "PartyIdentification")
        _cbc(sid, "ID", seller_tax, schemeID=seller_scheme)
        addr = _cac(sparty, "PostalAddress")
        _cbc(addr, "StreetName", str(seller.get("address") or "-") or "-")
        district = str(seller.get("district") or seller.get("tax_office") or seller.get("city") or "Merkez").strip() or "Merkez"
        _cbc(addr, "CitySubdivisionName", district)
        _cbc(addr, "CityName", str(seller.get("city") or "İstanbul"))
        country = _cac(addr, "Country")
        _cbc(country, "Name", "Türkiye")
        dsa = _cac(sig, "DigitalSignatureAttachment")
        eref = _cac(dsa, "ExternalReference")
        _cbc(eref, "URI", "#Signature")

    _party("DespatchSupplierParty", seller_party, root, send_ready=send_ready)
    _party("DeliveryCustomerParty", buyer_party, root, send_ready=send_ready)

    shipment = _cac(root, "Shipment")
    _cbc(shipment, "ID", "1")
    # ShipmentStage yalnızca plaka veya şoför varken. Boş stage (yalnız TransportModeCode) üretilmez.
    has_stage = bool(
        transport["plate"] or transport["driver_tckn"] or transport["driver_first"] or transport["driver_last"]
    )
    if has_stage:
        stage = _cac(shipment, "ShipmentStage")
        _cbc(stage, "TransportModeCode", "3")  # 3 = karayolu (GİB kod listesi)
        if transport["plate"]:
            means = _cac(stage, "TransportMeans")
            road = _cac(means, "RoadTransport")
            _cbc(road, "LicensePlateID", transport["plate"], schemeID="PLAKA")
        if transport["trailer"]:
            _cbc(stage, "Instructions", f"Dorse: {transport['trailer']}")
        if transport["driver_first"] or transport["driver_last"] or transport["driver_tckn"]:
            driver = _cac(stage, "DriverPerson")
            _cbc(driver, "FirstName", (transport["driver_first"] or "Sürücü")[:60])
            _cbc(driver, "FamilyName", (transport["driver_last"] or "-")[:60])
            _cbc(driver, "Title", "Şoför")
            if transport["driver_tckn"]:
                _cbc(driver, "NationalityID", transport["driver_tckn"], schemeID="TCKN")

    delivery = _cac(shipment, "Delivery")
    _fill_address(_cac(delivery, "DeliveryAddress"), buyer_party, send_ready=True)
    carrier_vkn = transport["carrier_vkn"]
    carrier_name = transport["carrier_name"]
    use_seller_as_carrier = False
    if not (carrier_vkn or carrier_name) and transport["mode"] == "own":
        scheme, tid = _tax_id(seller_party.get("tax_id"))
        from despatch_shipment import seller_tax_usable
        if seller_tax_usable(tid):
            carrier_vkn = tid
            carrier_name = str(seller_party.get("name") or "").strip()
            use_seller_as_carrier = True
        elif send_ready:
            raise ValueError("Taşıyıcı bilgisi eksik. Satıcının 0000000000 VKN'si ile sahte taşıyıcı yazılmaz.")
    if carrier_vkn or carrier_name:
        carrier_party = _cac(delivery, "CarrierParty")
        if carrier_vkn:
            cident = _cac(carrier_party, "PartyIdentification")
            scheme = "VKN" if len(carrier_vkn) == 10 else "TCKN"
            _cbc(cident, "ID", carrier_vkn, schemeID=scheme)
        if carrier_name:
            cpn = _cac(carrier_party, "PartyName")
            _cbc(cpn, "Name", carrier_name[:200])
        elif use_seller_as_carrier:
            cpn = _cac(carrier_party, "PartyName")
            _cbc(cpn, "Name", str(seller_party.get("name") or "Taşıyıcı")[:200])
        _fill_address(_cac(carrier_party, "PostalAddress"), seller_party, send_ready=True)
    elif send_ready:
        raise ValueError("Taşıyıcı bilgisi eksik. Satıcının 0000000000 VKN'si ile sahte taşıyıcı yazılmaz.")
    despatch = _cac(delivery, "Despatch")
    _cbc(despatch, "ActualDespatchDate", issue_date)
    _cbc(despatch, "ActualDespatchTime", issue_time[:8] if len(issue_time) >= 8 else issue_time)
    _fill_address(_cac(despatch, "DespatchAddress"), seller_party, send_ready=True)

    for i, it in enumerate(items, 1):
        line = _cac(root, "DespatchLine")
        _cbc(line, "ID", str(i))
        qty = float(it.get("quantity") or 1) or 1
        unit = UNIT_CODES.get(str(it.get("unit") or "Adet"), "C62")
        _cbc(line, "DeliveredQuantity", _amt(qty), unitCode=unit)
        _cbc(line, "OutstandingQuantity", "0", unitCode=unit)
        order_line = _cac(line, "OrderLineReference")
        _cbc(order_line, "LineID", str(i))
        item_el = _cac(line, "Item")
        _cbc(item_el, "Name", str(it.get("name") or it.get("product_name") or "Kalem")[:200])
        _write_item_identifications(item_el, it)
        # Birim fiyat bilgilendirme (irsaliyede KDV yok)
        unit_price = float(it.get("unit_price") or 0)
        if unit_price > 0:
            shipment_line = _cac(line, "Shipment")
            _cbc(shipment_line, "ID", str(i))
            goods = _cac(shipment_line, "GoodsItem")
            _cbc(goods, "ValueAmount", _amt(unit_price * qty), currencyID=(inv.get("currency") or "TRY").upper())

    if send_ready:
        assert_send_ready_has_no_visuals(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


async def invoice_xml_payload(inv: dict) -> Response:
    """e-Fatura / e-Arşiv XML gövdesi. Entegratör UBL, olmazsa yerel UBL."""
    if not is_outgoing_edoc(inv):
        raise HTTPException(status_code=400, detail="Yalnızca e-Fatura / e-Arşiv belgelerinin XML'i indirilebilir.")
    filename = invoice_filename(inv, "xml")
    invoice_id = str(inv.get("_id") or inv.get("id") or "")
    # GİB'e iletilmiş: resmi entegratör UBL (İşNet DownloadXml); hata olursa yerel UBL.
    try:
        import e_invoice

        remote = await e_invoice.fetch_integrator_xml(
            invoice_id, company_id=str(inv.get("company_id") or ""),
        )
        if remote:
            return Response(
                remote,
                media_type="application/xml",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "X-Document-Source": "integrator",
                },
            )
    except HTTPException:
        pass
    except Exception:
        pass
    seller = await _db.companies.find_one({"_id": inv["company_id"]}) or {}
    contact = await _db.contacts.find_one({"_id": inv.get("contact_id")}) if inv.get("contact_id") else None
    xml = build_invoice_ubl(inv, seller, _buyer_from(inv, contact))
    return Response(xml, media_type="application/xml", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/invoices/{invoice_id}/xml")
async def invoice_xml(invoice_id: str, user: dict = Depends(_user_dep)):
    inv = await tenant_access.get_tenant_doc(_db, "invoices", invoice_id, user, not_found="Fatura bulunamadı.")
    return await invoice_xml_payload(inv)
