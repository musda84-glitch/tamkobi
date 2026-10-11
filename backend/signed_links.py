"""İmzalı belge paylaşım linkleri (?t= HMAC: id + son kullanma)."""
from __future__ import annotations

import hashlib
import hmac
import re
import time
from typing import Optional, Tuple
from urllib.parse import quote

from auth_utils import get_jwt_secret

# Paylaşım linki varsayılan ömrü (72 saat)
DOC_SHARE_TTL_SEC = 72 * 3600

_DOC_PATH_RE = re.compile(r"^/api/(invoices|e-invoice)/([^/]+)/(pdf|xml)$")


def doc_kind_from_path(path: str) -> Optional[Tuple[str, str]]:
    """(doc_id, kind) — kind örn. invoices-pdf, e-invoice-xml."""
    p = (path or "").split("?", 1)[0]
    m = _DOC_PATH_RE.match(p)
    if not m:
        return None
    prefix, doc_id, ext = m.group(1), m.group(2), m.group(3)
    if prefix == "invoices" and ext != "pdf":
        return None
    return doc_id, f"{prefix}-{ext}"


def make_doc_share_token(doc_id: str, kind: str, ttl_sec: int = DOC_SHARE_TTL_SEC) -> str:
    exp = int(time.time()) + int(ttl_sec)
    msg = f"{kind}:{doc_id}:{exp}".encode("utf-8")
    sig = hmac.new(get_jwt_secret().encode("utf-8"), msg, hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{sig}"


def verify_doc_share_token(doc_id: str, kind: str, token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    try:
        exp_s, sig = token.split(".", 1)
        exp = int(exp_s)
    except (TypeError, ValueError):
        return False
    if exp < int(time.time()):
        return False
    msg = f"{kind}:{doc_id}:{exp}".encode("utf-8")
    expect = hmac.new(get_jwt_secret().encode("utf-8"), msg, hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(expect, sig)


def is_signed_public_doc(path: str, method: str, token: Optional[str]) -> bool:
    """Allowlist yardımcısı: yalnızca GET + geçerli t."""
    if (method or "GET").upper() not in ("GET", "HEAD"):
        return False
    parsed = doc_kind_from_path(path)
    if not parsed:
        return False
    doc_id, kind = parsed
    return verify_doc_share_token(doc_id, kind, token)


def build_doc_share_url(base: str, path: str, token: str) -> str:
    root = (base or "").rstrip("/")
    p = path if path.startswith("/") else f"/{path}"
    return f"{root}{p}?t={quote(token, safe='')}"
