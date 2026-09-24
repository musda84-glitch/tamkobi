"""Tahsilat / tediye makbuzundan tutar, yön ve açıklama çıkar."""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

RECEIPT_SYSTEM = """Sen bir Türk ön muhasebe asistanısın. Sana bir TAHSİLAT veya TEDİYE / ÖDEME makbuzunun görüntüsü veya metni verilecek.
Yalnızca TEK bir JSON nesnesi döndür. Açıklama, markdown veya kod bloğu YAZMA.
Şema:
{"type":"inflow"|"outflow","amount":number,"date":"YYYY-MM-DD"|null,"description":str,"contact_name":str|null,"tax_number":str|null,"confidence":number}
Kurallar:
- type=inflow: tahsilat, alınan, müşteriden, alacak makbuzu.
- type=outflow: tediye, ödeme, verilen, cariye ödeme.
- amount: ödenen/tahsil edilen tutar. Türkçe 1.250,00 → 1250.00.
- date: belge tarihi ISO. Yoksa null.
- description: kısa işlem açıklaması (Cari tahsilat, POS tahsilat, vs.).
- Bulamadığın metin alanlarına null yaz. amount yoksa 0."""

_AMOUNT_RE = re.compile(
    r"(?:tutar|toplam|ödenen|tahsil(?:at)?|bedel|yalnız)\s*[:.]?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)\s*(?:₺|tl|try)?",
    re.I,
)
_BARE_AMOUNT_RE = re.compile(r"([0-9]{1,3}(?:\.[0-9]{3})+,[0-9]{2}|[0-9]+,[0-9]{2})\s*(?:₺|tl|try)")
_DATE_DMY_RE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")
_DATE_ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


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


def _guess_type(text: str) -> str:
    low = (text or "").lower()
    out_hits = sum(k in low for k in ("tediye", "ödeme", "odeme", "verilen", "cariye"))
    in_hits = sum(k in low for k in ("tahsilat", "alınan", "alinan", "müşteriden", "musteriden", "alacak makbuz"))
    if out_hits > in_hits:
        return "outflow"
    return "inflow"


def parse_receipt_text(text: str) -> dict:
    raw = str(text or "")
    amount = 0.0
    m = _AMOUNT_RE.search(raw) or _BARE_AMOUNT_RE.search(raw)
    if m:
        amount = parse_tr_amount(m.group(1))
    desc = "Cari tahsilat"
    typ = _guess_type(raw)
    if typ == "outflow":
        desc = "Cari ödeme"
    for line in raw.splitlines():
        ls = line.strip()
        if re.match(r"(?i)açıklama\s*[:.]", ls):
            rest = re.sub(r"(?i)^açıklama\s*[:.]\s*", "", ls).strip()
            if rest:
                desc = rest[:160]
                break
    return normalize_receipt_draft({
        "type": typ,
        "amount": amount,
        "date": parse_tr_date(raw),
        "description": desc,
        "contact_name": None,
        "tax_number": None,
        "confidence": 0.55 if amount else 0.2,
    })


def normalize_receipt_draft(raw: Any) -> dict:
    d = raw if isinstance(raw, dict) else {}
    typ = str(d.get("type") or "").strip().lower()
    if typ not in ("inflow", "outflow"):
        typ = _guess_type(" ".join(str(d.get(k) or "") for k in ("description", "notes", "kind")))
    amount = parse_tr_amount(d.get("amount"))
    desc = str(d.get("description") or d.get("notes") or "").strip()[:160]
    if not desc:
        desc = "Cari tahsilat" if typ == "inflow" else "Cari ödeme"
    try:
        conf = float(d.get("confidence") or 0)
    except (TypeError, ValueError):
        conf = 0.0
    conf = max(0.0, min(1.0, conf))
    tax = str(d.get("tax_number") or d.get("vkn") or "").strip() or None
    name = str(d.get("contact_name") or d.get("name") or "").strip() or None
    return {
        "type": typ,
        "amount": amount,
        "date": parse_tr_date(d.get("date")) or parse_tr_date(d.get("issue_date")),
        "description": desc,
        "contact_name": name,
        "tax_number": tax,
        "confidence": conf or (0.7 if amount else 0.2),
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


async def extract_receipt_from_text(text: str) -> dict:
    heuristic = parse_receipt_text(text)
    try:
        from ai_service import make_chat
        from emergentintegrations.llm.chat import UserMessage
        chat = await make_chat(f"receipt-extract-{abs(hash(text[:200]))}", RECEIPT_SYSTEM, purpose="extract")
        raw = str(await chat.send_message(UserMessage(text=f"MAKBUZ METNİ:\n\n{text[:12000]}"))).strip()
        parsed = normalize_receipt_draft(_json_object(raw))
        if parsed["amount"] > 0:
            return parsed
    except Exception as e:
        logger.info("AI receipt text extract fallback: %s", e)
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


async def extract_receipt_file(data: bytes, filename: str = "", content_type: str = "") -> dict:
    """Dosya türüne göre makbuz taslağı çıkar (görüntü / PDF / metin)."""
    if not data:
        raise ValueError("Dosya boş.")
    name = (filename or "").lower()
    ctype = (content_type or "").lower().split(";")[0].strip()
    is_pdf = ctype == "application/pdf" or name.endswith(".pdf")
    is_text = ctype in ("text/plain",) or name.endswith(".txt")
    is_img = ctype.startswith("image/") or name.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))
    if is_img:
        mime = ctype if ctype.startswith("image/") else _mime_from_name(name)
        draft = await extract_receipt_from_image(data, mime)
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
            raise ValueError("PDF'de okunabilir metin yok. Makbuzun fotoğrafını çekin.")
        draft = await extract_receipt_from_text(text)
        return {"draft": draft, "source": "pdf", "text_preview": text[:1200]}
    if is_text:
        text = data.decode("utf-8", "ignore")
        draft = await extract_receipt_from_text(text)
        return {"draft": draft, "source": "text", "text_preview": text[:1200]}
    raise ValueError("JPEG, PNG, WebP veya PDF yükleyin.")


async def extract_receipt_from_image(data: bytes, mime: str = "image/jpeg") -> dict:
    if not data:
        raise ValueError("Görüntü boş.")
    b64 = base64.b64encode(data).decode("ascii")
    mime = (mime or "image/jpeg").split(";")[0].strip() or "image/jpeg"
    from ai_service import DirectChat, make_chat, protocol_of
    chat = await make_chat(f"receipt-img-{abs(hash(b64[:80]))}", RECEIPT_SYSTEM, purpose="extract")
    prompt = "Bu makbuz görüntüsünü oku ve JSON şemasına uy."
    if isinstance(chat, DirectChat):
        raw = await _send_vision(chat, prompt, b64, mime)
    else:
        from emergentintegrations.llm.chat import UserMessage
        raw = str(await chat.send_message(UserMessage(text=f"{prompt}\n(görüntü base64, {mime}, {len(data)} bayt)"))).strip()
    parsed = normalize_receipt_draft(_json_object(raw))
    if parsed["amount"] <= 0:
        raise ValueError("Makbuzdan tutar okunamadı.")
    return parsed


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
