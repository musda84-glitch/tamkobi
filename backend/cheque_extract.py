"""Çek / senet görüntüsünden tutar, vade, banka ve seri çıkar."""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

CHEQUE_SYSTEM = """Sen bir Türk ön muhasebe asistanısın. Sana bir ÇEK veya SENET görüntüsü veya metni verilecek.
Yalnızca TEK bir JSON nesnesi döndür. Açıklama, markdown veya kod bloğu YAZMA.
Şema:
{"instrument":"cheque"|"promissory","direction":"received"|"issued","amount":number,"due_date":"YYYY-MM-DD"|null,"issue_date":"YYYY-MM-DD"|null,"serial_no":str|null,"bank_name":str|null,"bank_branch":str|null,"account_no":str|null,"drawer_name":str|null,"contact_name":str|null,"tax_number":str|null,"notes":str|null,"confidence":number}
Kurallar:
- instrument=cheque: çek. instrument=promissory: senet / bono.
- direction=received: alınan, müşteriden. direction=issued: verilen, tedarikçiye.
- amount: yüz tutarı. Türkçe 50.000,00 → 50000.00.
- due_date: vade. issue_date: keşide / düzenleme tarihi.
- serial_no: çek/senet numarası.
- bank_name / bank_branch / account_no: banka bilgileri (senette boş olabilir).
- drawer_name: keşideci. contact_name: lehdar / cari adı.
- Bulamadığın metin alanlarına null yaz. amount yoksa 0."""

# Formu doldurmak için yeterli alanlar; portal token / bakiye dönülmez.
_CHEQUE_MATCH_KEYS = ("name", "tax_number_or_id", "phone", "email")


def public_cheque_match(match: Optional[dict]) -> Optional[dict]:
    """Cari eşleşmesini çek formuna güvenli alanlarla indirger."""
    if not match:
        return None
    out = {"id": str(match.get("_id") or match.get("id") or "")}
    for key in _CHEQUE_MATCH_KEYS:
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
    r"(?:tutar|toplam|yalnız|bedel)\s*[:.]?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)\s*(?:₺|tl|try)?",
    re.I,
)
_BARE_AMOUNT_RE = re.compile(r"([0-9]{1,3}(?:\.[0-9]{3})+,[0-9]{2}|[0-9]+,[0-9]{2})\s*(?:₺|tl|try)")
_DATE_DMY_RE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")
_DATE_ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_SERIAL_RE = re.compile(
    r"(?:çek\s*no|cek\s*no|senet\s*no|seri(?:\s*no)?|no)\s*[:.]?\s*([A-ZÇĞİÖŞÜ0-9\-/]{3,24})",
    re.I,
)
_DUE_RE = re.compile(
    r"(?:vade(?:\s*tarihi)?)\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})",
    re.I,
)
_ISSUE_RE = re.compile(
    r"(?:keşide|keside|düzenleme|duzenleme)(?:\s*tarihi)?\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})",
    re.I,
)
_BANK_RE = re.compile(r"(?:banka)\s*[:.]?\s*(.+)", re.I)
_BRANCH_RE = re.compile(r"(?:şube|sube)\s*[:.]?\s*(.+)", re.I)
_DRAWER_RE = re.compile(r"(?:keşideci|kesideci|düzenleyen|duzenleyen)\s*[:.]?\s*(.+)", re.I)
_IBAN_RE = re.compile(r"\b(TR\d{2}(?:\s?\d{4}){5}\s?\d{2})\b", re.I)
_BANK_NAMES = (
    "garanti", "iş bankası", "is bankasi", "yapı kredi", "yapi kredi", "akbank",
    "ziraat", "halkbank", "vakıfbank", "vakifbank", "vakıf", "qnb", "enpara",
    "kuveyt türk", "kuveyt turk", "finansbank", "denizbank", "teb", "ing",
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


def _line_value(match: Optional[re.Match[str]]) -> str:
    if not match:
        return ""
    return re.sub(r"\s+", " ", match.group(1)).strip()[:80]


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


def _guess_instrument(text: str) -> str:
    low = _fold_tr(text)
    if "senet" in low or "bono" in low:
        return "promissory"
    return "cheque"


def _guess_direction(text: str) -> str:
    low = _fold_tr(text)
    out_hits = sum(k in low for k in ("verilen", "tedarikciye", "keside ettigimiz", "bizden"))
    in_hits = sum(k in low for k in ("alinan", "musteriden", "portfoy"))
    if out_hits > in_hits:
        return "issued"
    return "received"


def _guess_bank(text: str) -> str:
    labeled = _line_value(_BANK_RE.search(text or ""))
    if labeled:
        return labeled
    low = (text or "").lower()
    for name in _BANK_NAMES:
        if name in low:
            start = low.find(name)
            return (text or "")[start:start + len(name)].strip().title()
    return ""


def parse_cheque_text(text: str) -> dict:
    raw = str(text or "")
    amount = 0.0
    m = _AMOUNT_RE.search(raw) or _BARE_AMOUNT_RE.search(raw)
    if m:
        amount = parse_tr_amount(m.group(1))
    due = parse_tr_date(_line_value(_DUE_RE.search(raw))) or parse_tr_date(raw)
    issue = parse_tr_date(_line_value(_ISSUE_RE.search(raw)))
    serial = _line_value(_SERIAL_RE.search(raw))
    iban = _IBAN_RE.search(raw)
    return normalize_cheque_draft({
        "instrument": _guess_instrument(raw),
        "direction": _guess_direction(raw),
        "amount": amount,
        "due_date": due,
        "issue_date": issue,
        "serial_no": serial,
        "bank_name": _guess_bank(raw),
        "bank_branch": _line_value(_BRANCH_RE.search(raw)),
        "account_no": re.sub(r"\s+", "", iban.group(1)) if iban else "",
        "drawer_name": _line_value(_DRAWER_RE.search(raw)),
        "contact_name": None,
        "tax_number": None,
        "notes": "",
        "confidence": 0.55 if amount else 0.2,
    })


def normalize_cheque_draft(raw: Any) -> dict:
    d = raw if isinstance(raw, dict) else {}
    inst = str(d.get("instrument") or "").strip().lower()
    if inst not in ("cheque", "promissory"):
        inst = _guess_instrument(" ".join(str(d.get(k) or "") for k in ("notes", "instrument", "kind")))
    direction = str(d.get("direction") or "").strip().lower()
    if direction not in ("received", "issued"):
        direction = _guess_direction(" ".join(str(d.get(k) or "") for k in ("notes", "direction", "kind")))
    try:
        conf = float(d.get("confidence") or 0)
    except (TypeError, ValueError):
        conf = 0.0
    amount = parse_tr_amount(d.get("amount"))
    return {
        "instrument": inst,
        "direction": direction,
        "amount": amount,
        "due_date": parse_tr_date(d.get("due_date")) or parse_tr_date(d.get("maturity")),
        "issue_date": parse_tr_date(d.get("issue_date")) or parse_tr_date(d.get("keside")),
        "serial_no": str(d.get("serial_no") or d.get("number") or "").strip()[:24] or None,
        "bank_name": str(d.get("bank_name") or "").strip()[:80] or None,
        "bank_branch": str(d.get("bank_branch") or "").strip()[:80] or None,
        "account_no": re.sub(r"\s+", "", str(d.get("account_no") or d.get("iban") or "").strip())[:34] or None,
        "drawer_name": str(d.get("drawer_name") or "").strip()[:120] or None,
        "contact_name": str(d.get("contact_name") or d.get("payee") or "").strip()[:120] or None,
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


_STRONG_KEYS = ("due_date", "serial_no", "bank_name", "drawer_name", "issue_date")


def cheque_draft_is_strong(draft: Optional[dict]) -> bool:
    """Regex/heuristik yeterliyse yapay zekaya gitmeye gerek yok."""
    if not draft:
        return False
    if float(draft.get("amount") or 0) <= 0:
        return False
    extras = sum(1 for key in _STRONG_KEYS if draft.get(key))
    try:
        conf = float(draft.get("confidence") or 0)
    except (TypeError, ValueError):
        conf = 0.0
    return extras >= 1 and conf >= 0.5


def merge_cheque_drafts(primary: dict, fallback: dict) -> dict:
    """AI taslağındaki boş alanları heuristikle tamamla."""
    out = dict(primary or {})
    extra = fallback or {}
    for key in (
        "due_date", "issue_date", "serial_no", "bank_name", "bank_branch",
        "account_no", "drawer_name", "contact_name", "tax_number", "notes",
    ):
        if not out.get(key) and extra.get(key):
            out[key] = extra[key]
    if float(out.get("amount") or 0) <= 0 and float(extra.get("amount") or 0) > 0:
        out["amount"] = extra["amount"]
    return normalize_cheque_draft(out)


def _is_ai_auth_error(err: BaseException) -> bool:
    low = str(err).lower()
    return "anahtar" in low or "api key" in low or "401" in str(err) or "403" in str(err)


async def _ai_cheque_from_text(text: str) -> dict:
    from ai_service import make_chat
    from emergentintegrations.llm.chat import UserMessage
    chat = await make_chat(f"cheque-extract-{abs(hash(text[:200]))}", CHEQUE_SYSTEM, purpose="extract")
    raw = str(await chat.send_message(UserMessage(text=f"ÇEK / SENET METNİ:\n\n{text[:12000]}"))).strip()
    return normalize_cheque_draft(_json_object(raw))


async def extract_cheque_from_text(text: str) -> dict:
    heuristic = parse_cheque_text(text)
    if cheque_draft_is_strong(heuristic):
        return heuristic
    try:
        parsed = await _ai_cheque_from_text(text)
        if parsed["amount"] > 0:
            return merge_cheque_drafts(parsed, heuristic)
    except Exception as e:
        logger.info("AI cheque text extract fallback: %s", e)
    return heuristic


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


async def extract_cheque_file(data: bytes, filename: str = "", content_type: str = "") -> dict:
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
        draft = await extract_cheque_from_image(data, mime, filename)
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
            raise ValueError("PDF'de okunabilir metin yok. Çekin fotoğrafını çekin.")
        draft = await extract_cheque_from_text(text)
        return {"draft": draft, "source": "pdf", "text_preview": text[:1200]}
    if is_text:
        text = data.decode("utf-8", "ignore")
        draft = await extract_cheque_from_text(text)
        return {"draft": draft, "source": "text", "text_preview": text[:1200]}
    raise ValueError("JPEG, PNG, WebP, HEIC veya PDF yükleyin.")


async def _ai_cheque_from_image(data: bytes, mime: str) -> dict:
    b64 = base64.b64encode(data).decode("ascii")
    mime = (mime or "image/jpeg").split(";")[0].strip() or "image/jpeg"
    from ai_service import DirectChat, make_chat
    chat = await make_chat(f"cheque-img-{abs(hash(b64[:80]))}", CHEQUE_SYSTEM, purpose="extract")
    prompt = "Bu çek veya senet görüntüsünü oku ve JSON şemasına uy."
    if isinstance(chat, DirectChat):
        raw = await _send_vision(chat, prompt, b64, mime)
    else:
        from emergentintegrations.llm.chat import UserMessage
        raw = str(await chat.send_message(UserMessage(text=f"{prompt}\n(görüntü base64, {mime}, {len(data)} bayt)"))).strip()
    return normalize_cheque_draft(_json_object(raw))


async def extract_cheque_from_image(data: bytes, mime: str = "image/jpeg", filename: str = "") -> dict:
    """Fotoğrafta regex yetmez; tutar için yapay zeka gerekir. AI boş dönerse notes heuristiği denenir."""
    if not data:
        raise ValueError("Görüntü boş.")
    from image_opt import prepare_vision_image

    data, mime = prepare_vision_image(data, mime, filename)
    last_err: Optional[BaseException] = None
    try:
        parsed = await _ai_cheque_from_image(data, mime)
        if parsed["amount"] > 0:
            return parsed
        notes = " ".join(
            str(parsed.get(k) or "")
            for k in ("notes", "drawer_name", "contact_name", "serial_no", "bank_name")
        )
        heuristic = parse_cheque_text(notes)
        if heuristic["amount"] > 0:
            return merge_cheque_drafts(heuristic, parsed)
    except Exception as e:
        last_err = e
        logger.info("AI cheque image extract fallback: %s", e)
        if _is_ai_auth_error(e):
            raise ValueError(
                "Yapay zeka API anahtarı geçersiz veya eksik. Platform → AI Entegrasyonu'ndan anahtar kaydedip Bağlantıyı Test Et yapın."
            ) from e
    raise ValueError("Çekten tutar okunamadı. Daha net bir fotoğraf deneyin.") from last_err


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
        async with httpx.AsyncClient(timeout=httpx.Timeout(40.0, connect=10.0)) as client:
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
