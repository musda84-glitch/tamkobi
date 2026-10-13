"""Sağlayıcı hata metinlerinde sır maskeleme ve kısa kullanıcı mesajı.

Ham SOAP/JSON/SMS gövdesi logda (maskeli) kalsın; HTTP detail yalnızca
kısa Türkçe metin + varsa sağlayıcı hata kodu taşır.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.I)
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b")
_BEARER_RE = re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._\-+=/]+")
_XML_SECRET_RE = re.compile(
    r"(?i)(<(?:[\w:]+:)?(?:UserName|Username|UserCode|UserId|User|Token|Password|"
    r"ApiKey|Authorization|Key)(?:\s[^>]*)?>)([^<]*)(</)"
)
_TOKEN_KV_RE = re.compile(
    r"(?i)[\"']?\b(token|access_token|refresh_token|id_token|api[_-]?key|apikey|"
    r"authorization|password|passwd|secret|session(?:_?id)?|jwt)\b[\"']?"
    r"(\s*[:=]\s*)([\"']?)[^\s\"'&,<;]+([\"']?)"
)
_USER_KV_RE = re.compile(
    r"(?i)[\"']?\b(user(?:name)?|usercode|userid|user_id|login|identificationnumber)\b[\"']?"
    r"(\s*[:=]\s*)([\"']?)[^\s\"'&,<;]+([\"']?)"
)
_QUERY_USER_RE = re.compile(
    r"(?i)([?&])(user(?:name)?|usercode|userid|login)=([^&\s\"']+)"
)
_QUERY_TOKEN_RE = re.compile(
    r"(?i)([?&])(token|key|access_token|auth|password|pwd|secret|session)=([^&\s\"']+)"
)
_PUBLIC_KOD_RE = re.compile(r"\(kod:\s*([^)]{1,40})\)", re.I)
_XML_CODE_RE = re.compile(
    r"<(?:[\w:]+:)?(?:ErrorCode|faultcode|FaultCode)\b[^>]*>([^<]{1,40})</",
    re.I,
)
_KV_CODE_RE = re.compile(
    r"[\"']?\b(?:ErrorCode|faultcode|error_code|code)\b[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9_.-]{1,40})",
    re.I,
)
_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.S)
_CODE_KEYS = (
    "errorcode",
    "error_code",
    "faultcode",
    "statuscode",
    "status_code",
    "code",
)
_SKIP_CODES = {
    "none",
    "null",
    "undefined",
    "success",
    "failed",
    "fail",
    "ok",
    "true",
    "false",
    "error",
}


def as_text(value: Any) -> str:
    """Sağlayıcı gövdesini metne çevir. dict[:n] KeyError üretmesin."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list, tuple)):
        try:
            return json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            return str(value)
    text = getattr(value, "text", None)
    if text is not None and text is not value:
        return as_text(text)
    return str(value)


def mask_sensitive_text(value: Any) -> str:
    """URL, kullanıcı adı ve token benzeri ifadeleri maskele."""
    s = as_text(value)
    if not s:
        return ""
    s = _URL_RE.sub("[url]", s)
    s = _JWT_RE.sub("[token]", s)
    s = _BEARER_RE.sub(r"\1 [token]", s)
    s = _XML_SECRET_RE.sub(lambda m: f"{m.group(1)}[mask]{m.group(3)}", s)
    s = _TOKEN_KV_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}[token]{m.group(4)}", s)
    s = _USER_KV_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}[user]{m.group(4)}", s)
    s = _QUERY_USER_RE.sub(r"\1\2=[user]", s)
    s = _QUERY_TOKEN_RE.sub(r"\1\2=[token]", s)
    return s


def _looks_like_token(value: str) -> bool:
    s = (value or "").strip()
    if s.startswith("eyJ"):
        return True
    if len(s) >= 32 and re.fullmatch(r"[A-Za-z0-9+/=._-]+", s):
        return True
    return False


def _clean_code(val: Any) -> str:
    s = str(val or "").strip().strip("\"'")
    if not s or s.lower() in _SKIP_CODES:
        return ""
    if _looks_like_token(s):
        return ""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,39}", s):
        return ""
    return s


def provider_error_code(raw: Any) -> str:
    """JSON/XML/metinden sağlayıcı hata kodunu ayıkla (token değil)."""
    if raw is None:
        return ""
    if isinstance(raw, dict):
        by_lower = {str(k).lower(): v for k, v in raw.items()}
        for key in _CODE_KEYS:
            if key in by_lower:
                c = _clean_code(by_lower[key])
                if c:
                    return c
        for nest in ("error", "status", "response", "fault", "Error"):
            inner = raw.get(nest) if nest in raw else by_lower.get(str(nest).lower())
            if isinstance(inner, dict):
                c = provider_error_code(inner)
                if c:
                    return c
        return ""
    if isinstance(raw, (list, tuple)) and raw:
        return provider_error_code(raw[0])
    text = as_text(raw).strip()
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = None
    if isinstance(parsed, (dict, list)):
        c = provider_error_code(parsed)
        if c:
            return c
    embedded = _JSON_OBJECT_RE.search(text)
    if embedded:
        try:
            parsed = json.loads(embedded.group(0))
        except Exception:
            parsed = None
        if isinstance(parsed, (dict, list)):
            c = provider_error_code(parsed)
            if c:
                return c
    m = _PUBLIC_KOD_RE.search(text)
    if m:
        c = _clean_code(m.group(1))
        if c:
            return c
    m = _XML_CODE_RE.search(text)
    if m:
        c = _clean_code(m.group(1))
        if c:
            return c
    m = _KV_CODE_RE.search(text)
    if m:
        c = _clean_code(m.group(1))
        if c:
            return c
    return ""


def looks_like_raw_body(value: Any) -> bool:
    s = as_text(value).lstrip()
    if not s:
        return False
    if s.startswith("{") or s.startswith("[") or s.startswith("<"):
        return True
    if s.startswith("slice("):
        return True
    if _URL_RE.search(s):
        return True
    return False


def public_provider_detail(
    message: str,
    raw: Any = None,
    *,
    code: Optional[str] = None,
) -> str:
    """Kısa genel Türkçe mesaj; varsa (kod: X). Ham gövde eklenmez."""
    msg = (message or "").strip() or "İşlem başarısız."
    c = _clean_code(code) if code not in (None, "") else ""
    if not c:
        c = provider_error_code(raw)
    if c and f"(kod: {c})" not in msg:
        return f"{msg} (kod: {c})"
    return msg
