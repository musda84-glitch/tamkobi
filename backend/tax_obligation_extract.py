"""Bordro, mizan ve tahakkuk belgelerinden ödenecek vergi/SGK satırları çıkar."""
from __future__ import annotations

import io
import logging
import re
from typing import Any, Optional

from expense_extract import parse_tr_amount, parse_tr_date

logger = logging.getLogger(__name__)

SOURCE_KINDS = ("bordro", "mizan", "tahakkuk")

OBLIGATION_KINDS = {
    "sgk": "SGK primi",
    "issizlik": "İşsizlik sigortası",
    "gelir_vergisi": "Gelir vergisi (muhtasar)",
    "damga": "Damga vergisi",
    "kdv": "KDV",
    "muhtasar": "Muhtasar",
    "kurumlar": "Kurumlar vergisi",
    "personel": "Personel net maaş",
    "vergi": "Ödenecek vergi",
    "diger": "Diğer yükümlülük",
}

MONTHS_TR = {
    "ocak": "01", "subat": "02", "mart": "03", "nisan": "04", "mayis": "05", "haziran": "06",
    "temmuz": "07", "agustos": "08", "eylul": "09", "ekim": "10", "kasim": "11", "aralik": "12",
}

MIZAN_ACCOUNTS = {
    "335": "personel",
    "360": "vergi",
    "361": "sgk",
    "368": "vergi",
    "369": "vergi",
    "391": "kdv",
}

_AMOUNT = r"([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)"


def fold_tr(text: str) -> str:
    table = str.maketrans({
        "I": "i", "İ": "i", "ı": "i",
        "Ş": "s", "ş": "s",
        "Ğ": "g", "ğ": "g",
        "Ü": "u", "ü": "u",
        "Ö": "o", "ö": "o",
        "Ç": "c", "ç": "c",
    })
    return str(text or "").translate(table).lower()


def obligation_title(kind: str) -> str:
    return OBLIGATION_KINDS.get(kind, OBLIGATION_KINDS["diger"])


def guess_source_kind(filename: str = "", text: str = "") -> str:
    blob = fold_tr(f"{filename} {text[:2500]}")
    if any(k in blob for k in ("bordro", "maas", "puantaj", "brut ucret", "isveren maliyeti")):
        return "bordro"
    if any(k in blob for k in ("mizan", "kebir", "deneme balans", "trial balance")):
        return "mizan"
    if any(k in blob for k in ("tahakkuk", "tahakuk", "muhtasar", "vergi turu", "son odeme tarihi")):
        return "tahakkuk"
    if any(k in blob for k in ("kdv", "sgk", "damga vergisi", "gelir vergisi")):
        return "tahakkuk"
    return "tahakkuk"


def parse_period(text: str, filename: str = "") -> Optional[str]:
    blob = f"{filename} {text}"
    iso = re.search(r"(20\d{2})[-/.](0[1-9]|1[0-2])", blob)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}"
    dmy = re.search(r"(0[1-9]|1[0-2])[-/.](20\d{2})", blob)
    if dmy:
        return f"{dmy.group(2)}-{dmy.group(1)}"
    folded = fold_tr(blob)
    for name, mm in MONTHS_TR.items():
        m = re.search(rf"\b{name}\s+(20\d{{2}})\b", folded)
        if m:
            return f"{m.group(1)}-{mm}"
        m = re.search(rf"\b(20\d{{2}})\s+{name}\b", folded)
        if m:
            return f"{m.group(1)}-{mm}"
    return None


def due_date_for(kind: str, period: Optional[str]) -> Optional[str]:
    if not period or not re.match(r"20\d{2}-(0[1-9]|1[0-2])$", period):
        return None
    y, m = int(period[:4]), int(period[5:7])
    m += 1
    if m > 12:
        m, y = 1, y + 1
    day = 28 if kind == "kdv" else 26
    return f"{y:04d}-{m:02d}-{day:02d}"


def _amount_after(folded_line: str, *needles: str) -> float:
    for needle in needles:
        if needle not in folded_line:
            continue
        idx = folded_line.find(needle)
        tail = folded_line[idx + len(needle):]
        m = re.search(_AMOUNT, tail)
        if m:
            n = parse_tr_amount(m.group(1))
            if n > 0:
                return n
    return 0.0


def _scan_labeled(text: str, labels: tuple[tuple[str, ...], ...]) -> dict[str, float]:
    out: dict[str, float] = {}
    for raw in str(text or "").splitlines():
        line = fold_tr(raw)
        if not line.strip():
            continue
        for key, needles in labels:
            if out.get(key):
                continue
            n = _amount_after(line, *needles)
            if n:
                out[key] = n
    return out


def parse_bordro(text: str, filename: str = "") -> dict:
    labels = (
        ("gross", ("brut ucret", "brut maas", "toplam brut", "brut toplam", "brut")),
        ("net", ("net ucret", "net odene", "net maas", "ele gecen", "net toplam", "net")),
        ("employer_cost", ("isveren maliyeti", "toplam maliyet", "toplam isveren")),
        ("sgk_employee", ("sgk isci", "isci sgk", "sgk prim isci", "sgk kesinti")),
        ("sgk_employer", ("sgk isveren", "isveren sgk", "isveren payi sgk")),
        ("unemp_employee", ("issizlik isci", "isci issizlik")),
        ("unemp_employer", ("issizlik isveren", "isveren issizlik")),
        ("income_tax", ("gelir vergisi", "gv kesinti", "muhtasar")),
        ("stamp", ("damga vergisi", "damga v.")),
        ("count", ("personel sayisi", "calisan sayisi", "bordro adedi", "kisi sayisi")),
    )
    found = _scan_labeled(text, labels)
    sgk = round(
        found.get("sgk_employee", 0) + found.get("sgk_employer", 0)
        + found.get("unemp_employee", 0) + found.get("unemp_employer", 0),
        2,
    )
    period = parse_period(text, filename)
    obligations = []
    if sgk > 0:
        obligations.append(_ob("sgk", sgk, period))
    if found.get("income_tax"):
        obligations.append(_ob("gelir_vergisi", found["income_tax"], period))
    if found.get("stamp"):
        obligations.append(_ob("damga", found["stamp"], period))
    if found.get("net"):
        obligations.append(_ob("personel", found["net"], period))
    return {
        "source_kind": "bordro",
        "period": period,
        "title": _bordro_title(period, filename),
        "summary": {
            "gross": found.get("gross", 0.0),
            "net": found.get("net", 0.0),
            "employer_cost": found.get("employer_cost", 0.0) or round(
                found.get("gross", 0) + found.get("sgk_employer", 0) + found.get("unemp_employer", 0), 2
            ),
            "count": int(found["count"]) if found.get("count") else 0,
        },
        "obligations": obligations,
        "confidence": 0.85 if obligations else 0.2,
    }


def _bordro_title(period: Optional[str], filename: str) -> str:
    if period:
        return f"Bordro {period}"
    name = (filename or "").rsplit("/", 1)[-1]
    return name or "Bordro"


def parse_tahakkuk(text: str, filename: str = "") -> dict:
    period = parse_period(text, filename)
    folded = fold_tr(text)
    kind = "vergi"
    if "kdv" in folded or "katma deger" in folded:
        kind = "kdv"
    elif "kurumlar" in folded:
        kind = "kurumlar"
    elif "muhtasar" in folded:
        kind = "muhtasar"
    elif "damga" in folded:
        kind = "damga"
    elif "sgk" in folded or "sosyal guvenlik" in folded:
        kind = "sgk"
    elif "gelir vergisi" in folded:
        kind = "gelir_vergisi"
    amount = 0.0
    for raw in str(text or "").splitlines():
        line = fold_tr(raw)
        n = _amount_after(
            line,
            "odenecek tutar", "odenecek vergi", "tahakkuk tutari", "tahakkuk eden",
            "genel toplam", "toplam tahakkuk", "odenecek",
        )
        if n > amount:
            amount = n
    if amount <= 0:
        amounts = [parse_tr_amount(m.group(1)) for m in re.finditer(_AMOUNT, folded)]
        amount = max(amounts) if amounts else 0.0
    due = parse_tr_date(text) or due_date_for(kind, period)
    due_m = re.search(r"son\s*odeme\s*tarihi\s*[:.]?\s*([0-9./-]{8,10})", folded)
    if due_m:
        due = parse_tr_date(due_m.group(1)) or due
    doc_no = ""
    no_m = re.search(r"(tahakkuk\s*no|belge\s*no)\s*[:.]?\s*([A-Z0-9\-/]{3,24})", fold_tr(text), re.I)
    if no_m:
        doc_no = no_m.group(2).upper()
    obligations = [_ob(kind, amount, period, due)] if amount > 0 else []
    title = f"{obligation_title(kind)} tahakkuku"
    if period:
        title = f"{title} {period}"
    return {
        "source_kind": "tahakkuk",
        "period": period,
        "title": title,
        "document_no": doc_no,
        "summary": {},
        "obligations": obligations,
        "confidence": 0.8 if obligations else 0.2,
    }


def parse_mizan(text: str, filename: str = "") -> dict:
    period = parse_period(text, filename)
    obligations = []
    line_re = re.compile(
        rf"^\s*(\d{{3}}(?:\.\d{{1,3}})*)\s+(.+?)\s+{_AMOUNT}\s+{_AMOUNT}(?:\s+{_AMOUNT})?(?:\s+([ab]))?\s*$",
        re.I,
    )
    for raw in str(text or "").splitlines():
        m = line_re.match(raw.replace("\t", " ").strip())
        if not m:
            continue
        code = m.group(1)
        root = code.split(".")[0]
        kind = MIZAN_ACCOUNTS.get(root)
        if not kind:
            name_f = fold_tr(m.group(2))
            if "sgk" in name_f or "sosyal guvenlik" in name_f:
                kind = "sgk"
            elif "kdv" in name_f:
                kind = "kdv"
            elif "personel" in name_f or "maas" in name_f:
                kind = "personel"
            elif "vergi" in name_f:
                kind = "vergi"
            else:
                continue
        debit = parse_tr_amount(m.group(3))
        credit = parse_tr_amount(m.group(4))
        bal = parse_tr_amount(m.group(5)) if m.group(5) else round(abs(credit - debit), 2)
        side = (m.group(6) or "").lower()
        payable = bal if side == "a" or credit >= debit else 0.0
        if side == "b":
            payable = 0.0
        if payable <= 0 and credit > debit:
            payable = round(credit - debit, 2)
        if payable <= 0:
            continue
        title = f"{code} {(m.group(2) or '').strip()[:60]}"
        ob = _ob(kind, payable, period)
        ob["title"] = title
        ob["account_code"] = code
        obligations.append(ob)
    return {
        "source_kind": "mizan",
        "period": period,
        "title": f"Mizan {period}" if period else "Mizan",
        "summary": {},
        "obligations": obligations,
        "confidence": 0.8 if obligations else 0.2,
    }


def _ob(kind: str, amount: float, period: Optional[str], due: Optional[str] = None) -> dict:
    return {
        "kind": kind,
        "title": obligation_title(kind),
        "amount": round(float(amount or 0), 2),
        "period": period,
        "due_date": due or due_date_for(kind, period),
    }


def parse_tax_text(text: str, filename: str = "", source_kind: str = "") -> dict:
    kind = source_kind if source_kind in SOURCE_KINDS else guess_source_kind(filename, text)
    if kind == "bordro":
        draft = parse_bordro(text, filename)
    elif kind == "mizan":
        draft = parse_mizan(text, filename)
        if not draft["obligations"]:
            alt = parse_tahakkuk(text, filename)
            if alt["obligations"]:
                draft = alt
    else:
        draft = parse_tahakkuk(text, filename)
        if not draft["obligations"]:
            alt = parse_bordro(text, filename)
            if alt["obligations"]:
                draft = alt
    draft["filename"] = (filename or "").rsplit("/", 1)[-1]
    draft["text_preview"] = str(text or "")[:1500]
    return draft


def pdf_text(data: bytes, max_pages: int = 8) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages[:max_pages])


def extract_tax_file(data: bytes, filename: str = "", content_type: str = "", source_kind: str = "") -> dict:
    if not data:
        raise ValueError("Dosya boş.")
    name = (filename or "").lower()
    ctype = (content_type or "").lower().split(";")[0].strip()
    is_pdf = ctype == "application/pdf" or name.endswith(".pdf")
    is_text = ctype in ("text/plain",) or name.endswith(".txt")
    if is_pdf:
        try:
            text = pdf_text(data)
        except Exception as e:
            raise ValueError(f"PDF okunamadı: {str(e)[:100]}") from e
        if len(text.strip()) < 12:
            raise ValueError("PDF'de okunabilir metin yok.")
        return {"draft": parse_tax_text(text, filename, source_kind), "source": "pdf"}
    if is_text:
        text = data.decode("utf-8", "ignore")
        return {"draft": parse_tax_text(text, filename, source_kind), "source": "text"}
    raise ValueError("PDF veya metin dosyası yükleyin.")


def normalize_import_lines(draft: dict, selected: Optional[list] = None) -> list[dict]:
    rows = []
    for i, ob in enumerate(draft.get("obligations") or []):
        if selected is not None and i not in selected and ob.get("kind") not in selected:
            continue
        amount = round(float(ob.get("amount") or 0), 2)
        if amount <= 0:
            continue
        kind = ob.get("kind") if ob.get("kind") in OBLIGATION_KINDS else "diger"
        rows.append({
            "kind": kind,
            "title": (ob.get("title") or obligation_title(kind))[:120],
            "amount": amount,
            "period": ob.get("period") or draft.get("period"),
            "due_date": ob.get("due_date") or due_date_for(kind, ob.get("period") or draft.get("period")),
            "account_code": ob.get("account_code") or "",
        })
    return rows
