"""Bordro, mizan ve tahakkuk belgelerinden ödenecek vergi/SGK satırları çıkar."""
from __future__ import annotations

import io
import logging
import re
from typing import Any, Optional

from expense_extract import parse_tr_amount, parse_tr_date, _is_ai_auth_error, _json_object, _send_vision

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


TAX_SYSTEM = """Sen bir Türk mali müşavir asistanısın. Sana BORDRO, MİZAN veya VERGİ TAHAKKUK belgesi verilecek.
Yalnızca TEK bir JSON nesnesi döndür. Açıklama, markdown veya kod bloğu YAZMA.
Şema:
{"source_kind":"bordro"|"mizan"|"tahakkuk","period":"YYYY-MM"|null,"title":str,"document_no":str|null,
 "summary":{"gross":number,"net":number,"employer_cost":number,"count":number},
 "obligations":[{"kind":"sgk"|"issizlik"|"gelir_vergisi"|"damga"|"kdv"|"muhtasar"|"kurumlar"|"personel"|"vergi"|"diger","title":str,"amount":number,"due_date":"YYYY-MM-DD"|null}],
 "confidence":number}
Kurallar:
- Bordro: SGK (işçi+işveren+işsizlik), gelir vergisi, damga ve net maaşı ayrı satır yaz. summary.gross/net/employer_cost doldur.
- Tahakkuk: vergi türüne göre tek ödenecek tutar (ödenecek / tahakkuk eden).
- Mizan: yalnızca yükümlülük hesapları (335, 360, 361, 368, 391) alacak bakiyesi > 0 ise satır üret.
- Tutarı Türkçe 18.450,00 → 18450.00 number yap. period yoksa null.
- kind tam olarak şemadaki değerlerden biri olsun.
- Bulamadığın satırları uydurma. obligations boş olabilir."""


def map_obligation_kind(raw: Any) -> str:
    s = fold_tr(raw)
    if s in OBLIGATION_KINDS:
        return s
    if "sgk" in s or "sosyal guvenlik" in s:
        return "sgk"
    if "issizlik" in s:
        return "issizlik"
    if "damga" in s:
        return "damga"
    if "kdv" in s or "katma deger" in s:
        return "kdv"
    if "muhtasar" in s:
        return "muhtasar"
    if "kurumlar" in s:
        return "kurumlar"
    if "gelir" in s or "stopaj" in s or s in ("gv", "gv kesinti"):
        return "gelir_vergisi"
    if "maas" in s or "personel" in s or s == "net":
        return "personel"
    return "vergi"


def normalize_tax_draft(d: Optional[dict], filename: str = "", source_kind: str = "", text: str = "") -> dict:
    data = d or {}
    kind = data.get("source_kind") if data.get("source_kind") in SOURCE_KINDS else (
        source_kind if source_kind in SOURCE_KINDS else guess_source_kind(filename, text or str(data.get("title") or ""))
    )
    period = parse_period(str(data.get("period") or ""), filename) or parse_period(str(data.get("period") or ""))
    if not period:
        period = parse_period(f"{data.get('title') or ''} {text}", filename)
    summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
    obligations = []
    for ob in data.get("obligations") or []:
        if not isinstance(ob, dict):
            continue
        amount = parse_tr_amount(ob.get("amount") or ob.get("tutar"))
        if amount <= 0:
            continue
        k = map_obligation_kind(ob.get("kind") or ob.get("title") or "vergi")
        due = parse_tr_date(ob.get("due_date") or ob.get("vade")) or due_date_for(k, period)
        row = _ob(k, amount, period, due)
        title = str(ob.get("title") or "").strip()
        if title:
            row["title"] = title[:120]
        if ob.get("account_code"):
            row["account_code"] = str(ob.get("account_code"))[:16]
        obligations.append(row)
    return {
        "source_kind": kind,
        "period": period,
        "title": str(data.get("title") or "").strip()[:160] or (f"{kind} {period}" if period else kind),
        "document_no": str(data.get("document_no") or "").strip()[:40],
        "filename": (filename or "").rsplit("/", 1)[-1],
        "summary": {
            "gross": parse_tr_amount(summary.get("gross")),
            "net": parse_tr_amount(summary.get("net")),
            "employer_cost": parse_tr_amount(summary.get("employer_cost")),
            "count": int(parse_tr_amount(summary.get("count")) or 0),
        },
        "obligations": obligations,
        "confidence": float(data.get("confidence") or (0.8 if obligations else 0.2)),
        "text_preview": str(data.get("text_preview") or text or "")[:1500],
    }


def merge_tax_drafts(primary: dict, fallback: dict) -> dict:
    a, b = dict(primary or {}), dict(fallback or {})
    out = normalize_tax_draft(a, a.get("filename") or b.get("filename") or "", a.get("source_kind") or b.get("source_kind") or "")
    if not out.get("period") and b.get("period"):
        out["period"] = b["period"]
        for ob in out["obligations"]:
            ob["period"] = ob.get("period") or out["period"]
            ob["due_date"] = ob.get("due_date") or due_date_for(ob.get("kind"), out["period"])
    if not out.get("obligations") and b.get("obligations"):
        out["obligations"] = list(b["obligations"])
        out["source_kind"] = b.get("source_kind") or out["source_kind"]
        out["title"] = b.get("title") or out["title"]
    sa, sb = out.get("summary") or {}, b.get("summary") or {}
    out["summary"] = {
        "gross": sa.get("gross") or sb.get("gross") or 0,
        "net": sa.get("net") or sb.get("net") or 0,
        "employer_cost": sa.get("employer_cost") or sb.get("employer_cost") or 0,
        "count": sa.get("count") or sb.get("count") or 0,
    }
    if not out.get("document_no") and b.get("document_no"):
        out["document_no"] = b["document_no"]
    if not out.get("text_preview") and b.get("text_preview"):
        out["text_preview"] = b["text_preview"]
    return out


def tax_draft_is_strong(draft: Optional[dict]) -> bool:
    if not draft:
        return False
    lines = draft.get("obligations") or []
    if not lines:
        return False
    return any(float(x.get("amount") or 0) > 0 for x in lines) and bool(draft.get("period") or draft.get("source_kind") == "tahakkuk")


async def _ai_tax_from_text(text: str, filename: str = "", source_kind: str = "") -> dict:
    from ai_service import make_chat
    from emergentintegrations.llm.chat import UserMessage
    hint = source_kind if source_kind in SOURCE_KINDS else ""
    chat = await make_chat(f"tax-extract-{abs(hash(text[:200]))}", TAX_SYSTEM, purpose="extract")
    prompt = f"BELGE TÜRÜ İPUCU: {hint or 'bilinmiyor'}\nDOSYA: {filename}\n\nBELGE METNİ:\n\n{text[:20000]}"
    raw = str(await chat.send_message(UserMessage(text=prompt))).strip()
    return normalize_tax_draft(_json_object(raw), filename, source_kind, text)


async def _ai_tax_from_image(data: bytes, mime: str, filename: str = "", source_kind: str = "") -> dict:
    import base64
    b64 = base64.b64encode(data).decode("ascii")
    mime = (mime or "image/jpeg").split(";")[0].strip() or "image/jpeg"
    from ai_service import DirectChat, make_chat
    chat = await make_chat(f"tax-img-{abs(hash(b64[:80]))}", TAX_SYSTEM, purpose="extract")
    prompt = f"Bu {source_kind or 'mali'} belge görüntüsünü oku ve JSON şemasına uy. Dosya: {filename}"
    if isinstance(chat, DirectChat):
        raw = await _send_vision(chat, prompt, b64, mime)
    else:
        from emergentintegrations.llm.chat import UserMessage
        raw = str(await chat.send_message(UserMessage(text=f"{prompt}\n(görüntü base64, {mime}, {len(data)} bayt)"))).strip()
    return normalize_tax_draft(_json_object(raw), filename, source_kind)


async def extract_tax_from_text(text: str, filename: str = "", source_kind: str = "") -> dict:
    heuristic = parse_tax_text(text, filename, source_kind)
    try:
        parsed = await _ai_tax_from_text(text, filename, source_kind)
        if parsed.get("obligations"):
            return merge_tax_drafts(parsed, heuristic)
    except Exception as e:
        logger.info("AI tax text extract fallback: %s", e)
        if _is_ai_auth_error(e):
            raise ValueError(
                "Yapay zeka API anahtarı geçersiz veya eksik. Platform → AI Entegrasyonu'ndan anahtar kaydedip Bağlantıyı Test Et yapın."
            ) from e
    return heuristic


def pdf_text(data: bytes, max_pages: int = 8) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages[:max_pages])


def _mime_from_name(name: str) -> str:
    n = (name or "").lower()
    if n.endswith(".png"):
        return "image/png"
    if n.endswith(".webp"):
        return "image/webp"
    if n.endswith(".gif"):
        return "image/gif"
    if n.endswith((".heic", ".heif", ".avif")):
        return "image/heic"
    return "image/jpeg"


async def extract_tax_file(data: bytes, filename: str = "", content_type: str = "", source_kind: str = "") -> dict:
    if not data:
        raise ValueError("Dosya boş.")
    from image_opt import looks_like_image

    name = (filename or "").lower()
    ctype = (content_type or "").lower().split(";")[0].strip()
    is_pdf = ctype == "application/pdf" or name.endswith(".pdf")
    is_text = ctype in ("text/plain",) or name.endswith(".txt")
    is_img = looks_like_image(data, ctype, name)
    if is_img:
        mime = ctype if ctype.startswith("image/") else _mime_from_name(name)
        from image_opt import prepare_vision_image
        data, mime = prepare_vision_image(data, mime, filename)
        try:
            draft = await _ai_tax_from_image(data, mime, filename, source_kind)
        except Exception as e:
            logger.info("AI tax image extract: %s", e)
            if _is_ai_auth_error(e):
                raise ValueError(
                    "Yapay zeka API anahtarı geçersiz veya eksik. Platform → AI Entegrasyonu'ndan anahtar kaydedip Bağlantıyı Test Et yapın."
                ) from e
            raise ValueError("Belgeden ödenecek tutar okunamadı. Daha net bir fotoğraf veya PDF deneyin.") from e
        return {"draft": draft, "source": "ai-image"}
    if is_pdf:
        try:
            text = pdf_text(data)
        except Exception as e:
            raise ValueError(f"PDF okunamadı: {str(e)[:100]}") from e
        if len(text.strip()) < 12:
            raise ValueError("PDF'de okunabilir metin yok. Belgenin fotoğrafını yükleyin.")
        draft = await extract_tax_from_text(text, filename, source_kind)
        return {"draft": draft, "source": "ai-pdf" if draft.get("obligations") else "pdf", "text_preview": text[:1200]}
    if is_text:
        text = data.decode("utf-8", "ignore")
        draft = await extract_tax_from_text(text, filename, source_kind)
        return {"draft": draft, "source": "ai-text", "text_preview": text[:1200]}
    raise ValueError("PDF, fotoğraf veya metin dosyası yükleyin.")


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
