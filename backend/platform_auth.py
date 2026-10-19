"""Ortak platform HMAC doğrulayıcısı (v1 ve sonraki admin-v1 uçları).

Sıra: başlıklar → timestamp → anahtar → IP limiti → IP izin listesi →
İMZA → scope → nonce → anahtar kotası → audit.
"""
from __future__ import annotations

import ipaddress
import json
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fastapi import HTTPException, Request

from client_ip import request_ip
import platform_store as store

MAX_SKEW_SEC = 300


def normalize_ip_allowlist(values: Optional[Sequence[str]]) -> List[str]:
    """Her öğeyi kanonik ağa çevirir. Boş / None → []. Host biti set ise ValueError.

    Tek adres IPv4'te /32, IPv6'da /128 olur. Tekrarlar atılır.
    """
    if values is None:
        return []
    if isinstance(values, str) or not isinstance(values, (list, tuple)):
        raise ValueError("Geçersiz IP izin listesi")
    out: List[str] = []
    seen = set()
    for raw in values:
        text = str(raw).strip()
        if not text:
            raise ValueError("Geçersiz IP izin listesi değeri")
        try:
            net = ipaddress.ip_network(text, strict=True)
        except ValueError:
            raise ValueError(f"Geçersiz IP izin listesi değeri: {text}") from None
        canon = str(net)
        if canon in seen:
            continue
        seen.add(canon)
        out.append(canon)
    return out


def _candidate_addrs(raw: str) -> List[Any]:
    addr = ipaddress.ip_address((raw or "").strip())
    found = [addr]
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        found.append(mapped)
    return found


def ip_allowed(client_ip: str, allowlist: Optional[Sequence[str]]) -> bool:
    """Boş veya eksik listede herkese izin. Doluysa adres (veya IPv4-mapped) bir ağda olmalı.

    "unknown" ve geçersiz adres, liste doluysa reddedilir.
    """
    if not allowlist:
        return True
    try:
        addrs = _candidate_addrs(client_ip)
    except ValueError:
        return False
    for raw in allowlist:
        try:
            net = ipaddress.ip_network(str(raw).strip(), strict=False)
        except ValueError:
            continue
        for addr in addrs:
            if addr.version == net.version and addr in net:
                return True
    return False


async def authenticate(
    request: Request,
    *,
    required_scope: str,
    also_accept_scopes: tuple = (),
    audit_prefix: str = "v1",
) -> Tuple[dict, Dict[str, Any]]:
    """HMAC doğrula. Dönüş: (key_doc, payload). Ret: 401 / 403 / 429, bugünkü detail metinleri.

    IP izin listesi, IP dakikalık limitinden sonra ve imzadan önce bakılır.
    Ret nonce tüketmez, anahtar kotasını yakmaz; audit'e secret/imza/liste yazılmaz.
    """
    key_id = (request.headers.get("X-Platform-Key") or "").strip()
    ts = (request.headers.get("X-Platform-Timestamp") or "").strip()
    nonce = (request.headers.get("X-Platform-Nonce") or "").strip()
    sig = (request.headers.get("X-Platform-Signature") or "").strip()
    if not key_id or not ts or not nonce or not sig:
        raise HTTPException(status_code=401, detail="Eksik imza başlıkları")

    try:
        ts_i = int(ts)
    except ValueError:
        raise HTTPException(status_code=401, detail="Geçersiz timestamp")
    if abs(int(time.time()) - ts_i) > MAX_SKEW_SEC:
        raise HTTPException(status_code=401, detail="Timestamp kayması çok büyük")

    doc, secret = await store.resolve_key_for_auth(key_id)
    if not doc or not secret:
        raise HTTPException(status_code=401, detail="Geçersiz veya süresi dolmuş anahtar")

    ip = request_ip(request)
    if not await store.check_ip_rate_limit(ip):
        raise HTTPException(status_code=429, detail="IP dakika limiti aşıldı")

    allow = doc.get("ip_allowlist") or []
    if allow and not ip_allowed(ip, allow):
        path = request.url.path
        await store.write_audit(
            actor_type="api_key",
            actor_id=key_id,
            ip=ip,
            action=f"{audit_prefix}.auth.ip_denied",
            target_type="api_key",
            target_id=key_id,
            details={"path": path, "scope": required_scope},
        )
        raise HTTPException(status_code=403, detail="IP adresi bu anahtar için izinli değil")

    body = await request.body()
    path = request.url.path
    method = request.method
    if not store.verify_signature(secret, ts, nonce, method, path, body, sig):
        raise HTTPException(status_code=401, detail="İmza doğrulanamadı")

    scopes = doc.get("scopes") or []
    if required_scope not in scopes and not any(extra in scopes for extra in also_accept_scopes):
        raise HTTPException(status_code=403, detail="Kapsam yetersiz")

    if not await store.check_and_store_nonce(key_id, nonce):
        raise HTTPException(status_code=401, detail="Tekrarlanan nonce")

    if not await store.check_rate_limit(key_id):
        raise HTTPException(status_code=429, detail="Dakika limiti aşıldı")

    await store.touch_last_used(key_id, ip)
    await store.write_audit(
        actor_type="api_key",
        actor_id=key_id,
        ip=ip,
        action=f"{audit_prefix}.{required_scope}",
        target_type="api_key",
        target_id=key_id,
        details={"path": path},
    )
    try:
        payload = json.loads(body.decode("utf-8") or "{}") if body else {}
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return doc, payload
