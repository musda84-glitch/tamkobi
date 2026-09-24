"""Masraf fişi / POS belgesinden tutar, KDV, kategori ve açıklama çıkar."""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

CATEGORIES = (
    "Kira", "Elektrik / Su / Doğalgaz", "İnternet / Telefon", "Yakıt", "Yemek",
    "Yol / Ulaşım", "Ofis Malzemesi", "Personel Masrafı", "Vergi / Harç / SGK",
    "Bakım / Onarım", "Pazarlama / Reklam", "Yazılım / Abonelik", "Kargo / Nakliye",
    "Muhasebe / Danışmanlık", "Diğer",
)

EXPENSE_SYSTEM = """Sen bir Türk ön muhasebe asistanısın. Sana bir MASRAF FİŞİ, POS slip veya gider faturası verilecek.
Yalnızca TEK bir JSON nesnesi döndür. Açıklama, markdown veya kod bloğu YAZMA.
Şema:
{"amount":number,"vat_rate":0|1|10|20,"vat_included":true|false,"date":"YYYY-MM-DD"|null,"description":str,"category":str,"document_no":str|null,"contact_name":str|null,"tax_number":str|null,"notes":str,"confidence":number}
Kurallar:
- amount: ödenen tutar. Türkçe 1.035,84 → 1035.84. POS fişinde genellikle KDV DAHİL genel toplam.
- vat_included: tutar KDV dahil ise true (POS/fiş genel toplamı için true).
- vat_rate: yalnızca 0, 1, 10 veya 20.
- category: tam olarak şu listeden biri: """ + ", ".join(CATEGORIES) + """.
- description: kısa masraf açıklaması (işyeri + ne alındı).
- document_no: fiş / fatura numarası.
- Bulamadığın metin alanlarına null yaz. amount yoksa 0."""

# Formu doldurmak için yeterli alanlar; portal token / bakiye dönülmez.
_EXPENSE_MATCH_KEYS = ("name", "tax_number_or_id", "phone", "email")


def public_expense_match(match: Optional[dict]) -> Optional[dict]:
    """Cari eşleşmesini masraf formuna güvenli alanlarla indirger."""
    if not match:
        return None
    out = {"id": str(match.get("_id") or match.get("id") or "")}
    for key in _EXPENSE_MATCH_KEYS:
        value = match.get(key)
        if value not in (None, ""):
            out[key] = value
    return out


def session_token_from_headers(authorization: str = "", cookie: str = "") -> Optional[str]:
    """Bearer or cookie session; empty means the caller is anonymous."""
    if (authorization or "").startswith("Bearer "):
        token = authorization[7:].strip()
        if token:
            return token
    cookie = (cookie or "").strip()
    return cookie or None


_AMOUNT_RE = re.compile(
    r"(?:genel\s*toplam|kdv\s*dahil|ödenecek|odenecek|toplam|tutar|yalnız)\s*[:.]?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)\s*(?:₺|tl|try)?",
    re.I,
)
_BARE_AMOUNT_RE = re.compile(r"([0-9]{1,3}(?:\.[0-9]{3})+,[0-9]{2}|[0-9]+,[0-9]{2})\s*(?:₺|tl|try)")
_DATE_DMY_RE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")
_DATE_ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_VAT_RE = re.compile(r"(?:kdv|katma\s*değer)\s*%?\s*(0|1|10|20)\b", re.I)
_DOC_RE = re.compile(r"(?:fiş\s*no|fis\s*no|belge\s*no|fatura\s*no|no)\s*[:.]?\s*([A-ZÇĞİÖŞÜ0-9\-/]{3,24})", re.I)
_DESC_RE = re.compile(r"(?:açıklama|aciklama)\s*[:.]\s*(.+)", re.I)
_CATEGORY_KEYS = (
    ("Yakıt", ("yakit", "benzin", "motorin", "shell", "opet", "petrol", "bp ", "totalenergies")),
    ("Yemek", ("yemek", "restoran", "lokanta", "cafe", "kahve", "kebap", "burger", "pizza", "starbucks")),
    ("Yol / Ulaşım", ("taksi", "uber", "otogar", "bilet", "metro", "otopark", "ulasim")),
    ("Kargo / Nakliye", ("kargo", "yurtici", "aras", "mng", "surat", "ptt kargo")),
    ("Elektrik / Su / Doğalgaz", ("elektrik", "dogalgaz", "igdas", "ayedas", "su fatur")),
    ("İnternet / Telefon", ("turkcell", "vodafone", "telekom", "internet", "superonline")),
    ("Kira", ("kira",)),
    ("Yazılım / Abonelik", ("abonelik", "adobe", "microsoft", "hosting", "yazilim")),
    ("Ofis Malzemesi", ("kirtasiye", "ofis", "bim ", "a101", "sok ", "migros", "market")),
    ("Bakım / Onarım", ("bakim", "onarim", "servis")),
    ("Vergi / Harç / SGK", ("vergi", "harc", "sgk")),
)


def parse_tr_amount(raw: Any) -> float:
    if isinstance(raw, (int, float)) and raw == raw:
        return round(float(raw), 2)
    s = str(raw or "").strip().replace("₺", "").replace("TL", "").replace("tl", "").replace("TRY", "").strip()
    if not s:
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


def parse_tr_date(raw: Any) -> Optional[str]:
    s = str(raw or "").strip()
    if not s:
        return None
    iso = _DATE_ISO_RE.search(s)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
    dmy = _DATE_DMY_RE.search(s)
    if not dmy:
        return None
    d, m, y = int(dmy.group(1)), int(dmy.group(2)), int(dmy.group(3))
    if m > 12 or d > 31 or d < 1:
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


def _fold_tr(text: str) -> str:
    table = str.maketrans({
        "I": "i", "İ": "i", "ı": "i",
        "Ş": "s", "ş": "s",
        "Ğ": "g", "ğ": "g",
        "Ü": "u", "ü": "u",
        "Ö": "o", "ö": "o",
        "Ç": "c", "ç": "c",
    })
    return (text or "").translate(table).lower()


def guess_category(text: str) -> str:
    low = _fold_tr(text)
    for name, keys in _CATEGORY_KEYS:
        if any(k in low for k in keys):
            return name
    return "Diğer"


def _vat_rate(raw: Any, text: str = "") -> int:
    try:
        n = int(round(float(raw)))
        if n in (0, 1, 10, 20):
            return n
    except (TypeError, ValueError):
        pass
    m = _VAT_RE.search(text or "")
    if m:
        return int(m.group(1))
    return 20


def parse_expense_text(text: str) -> dict:
    raw = str(text or "")
    amount = 0.0
    m = _AMOUNT_RE.search(raw) or _BARE_AMOUNT_RE.search(raw)
    if m:
        amount = parse_tr_amount(m.group(1))
    desc = ""
    dm = _DESC_RE.search(raw)
    if dm:
        desc = dm.group(1).strip()[:160]
    if not desc:
        for line in raw.splitlines():
            ls = line.strip()
            if len(ls) >= 4 and not re.match(r"^[\d.,\s₺tlTRY/%:-]+$", ls, re.I):
                if not re.match(r"(?i)^(fiş|fis|kdv|toplam|tutar|tarih|vkn|vergi)", ls):
                    desc = ls[:160]
                    break
    if not desc:
        desc = "Masraf fişi"
    doc = ""
    dcm = _DOC_RE.search(raw)
    if dcm:
        doc = dcm.group(1).strip()
    return normalize_expense_draft({
        "amount": amount,
        "vat_rate": _vat_rate(None, raw),
        "vat_included": True,
        "date": parse_tr_date(raw),
        "description": desc,
        "category": guess_category(raw),
        "document_no": doc,
        "contact_name": None,
        "tax_number": None,
        "notes": "",
        "confidence": 0.55 if amount else 0.2,
    })


def normalize_expense_draft(raw: Any) -> dict:
    d = raw if isinstance(raw, dict) else {}
    cat = str(d.get("category") or "").strip()
    if cat not in CATEGORIES:
        cat = guess_category(" ".join(str(d.get(k) or "") for k in ("category", "description", "notes")))
    desc = str(d.get("description") or d.get("notes") or "").strip()[:160]
    if not desc:
        desc = "Masraf fişi"
    vat_included = d.get("vat_included")
    if vat_included is None:
        vat_included = True
    try:
        conf = float(d.get("confidence") or 0)
    except (TypeError, ValueError):
        conf = 0.0
    amount = parse_tr_amount(d.get("amount") or d.get("total"))
    return {
        "amount": amount,
        "vat_rate": _vat_rate(d.get("vat_rate"), ""),
        "vat_included": bool(vat_included),
        "date": parse_tr_date(d.get("date")) or parse_tr_date(d.get("issue_date")),
        "description": desc,
        "category": cat,
        "document_no": str(d.get("document_no") or d.get("fis_no") or "").strip()[:24] or None,
        "contact_name": str(d.get("contact_name") or d.get("merchant") or "").strip()[:120] or None,
        "tax_number": str(d.get("tax_number") or d.get("vkn") or "").strip() or None,
        "notes": str(d.get("notes") or "").strip()[:160],
        "confidence": max(0.0, min(1.0, conf)) or (0.7 if amount else 0.2),
    }


def _json_object(raw: str) -> dict:
    text = str(raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("AI yanıtı JSON içermiyor.")
    return json.loads(text[start:end + 1])


_STRONG_KEYS = ("date", "document_no", "contact_name", "tax_number")


def expense_draft_is_strong(draft: Optional[dict]) -> bool:
    """Regex/heuristik yeterliyse yapay zekaya gitmeye gerek yok."""
    if not draft:
        return False
    if float(draft.get("amount") or 0) <= 0:
        return False
    extras = sum(1 for key in _STRONG_KEYS if draft.get(key))
    if draft.get("category") and draft.get("category") != "Diğer":
        extras += 1
    desc = str(draft.get("description") or "").strip()
    if desc and desc != "Masraf fişi":
        extras += 1
    try:
        conf = float(draft.get("confidence") or 0)
    except (TypeError, ValueError):
        conf = 0.0
    return extras >= 1 and conf >= 0.5


def merge_expense_drafts(primary: dict, fallback: dict) -> dict:
    """AI taslağındaki boş alanları heuristikle tamamla."""
    out = dict(primary or {})
    extra = fallback or {}
    for key in ("date", "document_no", "contact_name", "tax_number", "notes"):
        if not out.get(key) and extra.get(key):
            out[key] = extra[key]
    desc = str(out.get("description") or "").strip()
    if (not desc or desc == "Masraf fişi") and extra.get("description"):
        out["description"] = extra["description"]
    if (not out.get("category") or out.get("category") == "Diğer") and extra.get("category"):
        out["category"] = extra["category"]
    if float(out.get("amount") or 0) <= 0 and float(extra.get("amount") or 0) > 0:
        out["amount"] = extra["amount"]
    return normalize_expense_draft(out)


def _is_ai_auth_error(err: BaseException) -> bool:
    low = str(err).lower()
    return "anahtar" in low or "api key" in low or "401" in str(err) or "403" in str(err)


async def _ai_expense_from_text(text: str) -> dict:
    from ai_service import make_chat
    from emergentintegrations.llm.chat import UserMessage
    chat = await make_chat(f"expense-extract-{abs(hash(text[:200]))}", EXPENSE_SYSTEM, purpose="extract")
    raw = str(await chat.send_message(UserMessage(text=f"MASRAF FİŞİ METNİ:\n\n{text[:12000]}"))).strip()
    return normalize_expense_draft(_json_object(raw))


async def extract_expense_from_text(text: str) -> dict:
    heuristic = parse_expense_text(text)
    if expense_draft_is_strong(heuristic):
        return heuristic
    try:
        parsed = await _ai_expense_from_text(text)
        if parsed["amount"] > 0:
            return merge_expense_drafts(parsed, heuristic)
    except Exception as e:
        logger.info("AI expense text extract fallback: %s", e)
    return heuristic


def _mime_from_name(name: str) -> str:
    n = (name or "").lower()
    if n.endswith(".png"):
        return "image/png"
    if n.endswith(".webp"):
        return "image/webp"
    if n.endswith(".gif"):
        return "image/gif"
    return "image/jpeg"


async def extract_expense_file(data: bytes, filename: str = "", content_type: str = "") -> dict:
    if not data:
        raise ValueError("Dosya boş.")
    name = (filename or "").lower()
    ctype = (content_type or "").lower().split(";")[0].strip()
    is_pdf = ctype == "application/pdf" or name.endswith(".pdf")
    is_text = ctype in ("text/plain",) or name.endswith(".txt")
    is_img = ctype.startswith("image/") or name.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))
    if is_img:
        mime = ctype if ctype.startswith("image/") else _mime_from_name(name)
        draft = await extract_expense_from_image(data, mime)
        return {"draft": draft, "source": "image"}
    if is_pdf:
        import io
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((p.extract_text() or "") for p in reader.pages[:8])
        except Exception as e:
            raise ValueError(f"PDF okunamadı: {str(e)[:100]}") from e
        if len(text.strip()) < 20:
            raise ValueError("PDF'de okunabilir metin yok. Fişin fotoğrafını çekin.")
        draft = await extract_expense_from_text(text)
        return {"draft": draft, "source": "pdf", "text_preview": text[:1200]}
    if is_text:
        text = data.decode("utf-8", "ignore")
        draft = await extract_expense_from_text(text)
        return {"draft": draft, "source": "text", "text_preview": text[:1200]}
    raise ValueError("JPEG, PNG, WebP veya PDF yükleyin.")


async def _ai_expense_from_image(data: bytes, mime: str) -> dict:
    b64 = base64.b64encode(data).decode("ascii")
    mime = (mime or "image/jpeg").split(";")[0].strip() or "image/jpeg"
    from ai_service import DirectChat, make_chat
    chat = await make_chat(f"expense-img-{abs(hash(b64[:80]))}", EXPENSE_SYSTEM, purpose="extract")
    prompt = "Bu masraf fişini oku ve JSON şemasına uy."
    if isinstance(chat, DirectChat):
        raw = await _send_vision(chat, prompt, b64, mime)
    else:
        from emergentintegrations.llm.chat import UserMessage
        raw = str(await chat.send_message(UserMessage(text=f"{prompt}\n(görüntü base64, {mime}, {len(data)} bayt)"))).strip()
    return normalize_expense_draft(_json_object(raw))


async def extract_expense_from_image(data: bytes, mime: str = "image/jpeg") -> dict:
    """Fotoğrafta regex yetmez; tutar için yapay zeka gerekir. AI boş dönerse notes heuristiği denenir."""
    if not data:
        raise ValueError("Görüntü boş.")
    last_err: Optional[BaseException] = None
    try:
        parsed = await _ai_expense_from_image(data, mime)
        if parsed["amount"] > 0:
            return parsed
        notes = " ".join(
            str(parsed.get(k) or "")
            for k in ("notes", "description", "document_no", "contact_name")
        )
        heuristic = parse_expense_text(notes)
        if heuristic["amount"] > 0:
            return merge_expense_drafts(heuristic, parsed)
    except Exception as e:
        last_err = e
        logger.info("AI expense image extract fallback: %s", e)
        if _is_ai_auth_error(e):
            raise
    raise ValueError("Fişten tutar okunamadı.") from last_err


async def _send_vision(chat: Any, text: str, image_b64: str, mime: str) -> str:
    import httpx
    from ai_service import (
        ANTHROPIC_BASE,
        ANTHROPIC_VERSION,
        DIRECT_MAX_TOKENS,
        GEMINI_BASE,
        OPENAI_BASE,
        _blank_reason,
        _direct_answer,
        _provider_error,
        protocol_of,
        provider_label,
    )
    proto = protocol_of(chat.provider)
    if proto == "google":
        payload = {
            "contents": [{"role": "user", "parts": [
                {"text": text},
                {"inline_data": {"mime_type": mime, "data": image_b64}},
            ]}],
            "generationConfig": {"maxOutputTokens": DIRECT_MAX_TOKENS, "temperature": 0.1},
        }
        if chat.system_message:
            payload["systemInstruction"] = {"parts": [{"text": chat.system_message}]}
        url, headers = f"{GEMINI_BASE}/models/{chat.model}:generateContent", {"x-goog-api-key": chat.api_key}
    elif proto == "anthropic":
        payload = {
            "model": chat.model,
            "max_tokens": DIRECT_MAX_TOKENS,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": image_b64}},
                {"type": "text", "text": text},
            ]}],
        }
        if chat.system_message:
            payload["system"] = chat.system_message
        url, headers = f"{ANTHROPIC_BASE}/messages", {"x-api-key": chat.api_key, "anthropic-version": ANTHROPIC_VERSION}
    else:
        messages = ([{"role": "system", "content": chat.system_message}] if chat.system_message else []) + [{
            "role": "user",
            "content": [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
            ],
        }]
        payload = {"model": chat.model, "messages": messages}
        url = chat.base_url or f"{OPENAI_BASE}/chat/completions"
        headers = {"Authorization": f"Bearer {chat.api_key}"} if chat.api_key else {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
            resp = await client.post(url, headers={**headers, "Content-Type": "application/json"}, json=payload)
    except httpx.HTTPError as e:
        raise RuntimeError(f"{provider_label(chat.provider)} sunucusuna ulaşılamadı: {e}") from e
    if resp.status_code >= 400:
        raise RuntimeError(_provider_error(chat.provider, resp))
    try:
        data = resp.json()
    except ValueError as e:
        raise RuntimeError(f"{provider_label(chat.provider)} beklenmeyen bir yanıt döndürdü.") from e
    answer = _direct_answer(chat.provider, data)
    if not answer:
        raise RuntimeError(_blank_reason(chat.provider, data))
    return answer
