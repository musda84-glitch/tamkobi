"""Ethernet / IP (raw TCP :9100) etiket yazıcı — TSPL/ESC-POS gönderimi.

Tarayıcı ham TCP açamaz; API sunucusu yazıcıyla aynı LAN'daysa (ofis Docker)
veya istemci yerel köprü kullanıyorsa doğrudan yazdırma mümkün olur.
SSRF için yalnızca özel IP aralıklarına izin verilir.
"""
from __future__ import annotations

import asyncio
import base64
import ipaddress
import socket
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/network-printers", tags=["network-printers"])
_current_user = None

DEFAULT_PORT = 9100
ALLOWED_PORTS = frozenset(range(9100, 9110)) | {515, 631}
MAX_PAYLOAD = 512_000
CONNECT_TIMEOUT = 4.0
SEND_TIMEOUT = 8.0


def init(current_user_dep):
    global _current_user
    _current_user = current_user_dep


async def _require_user(request: Request) -> dict:
    if not _current_user:
        raise HTTPException(status_code=500, detail="Auth yapılandırılmadı.")
    return await _current_user(request)


class PrinterTarget(BaseModel):
    host: str = Field(..., min_length=1, max_length=253)
    port: int = Field(DEFAULT_PORT, ge=1, le=65535)


class ProbeBody(PrinterTarget):
    pass


class SendBody(PrinterTarget):
    """data: UTF-8 TSPL/ESC metni; data_b64: ham bayt (öncelikli)."""
    data: Optional[str] = None
    data_b64: Optional[str] = None
    encoding: str = "utf-8"


def is_allowed_printer_host(host: str) -> tuple[bool, str]:
    """Yalnızca özel IPv4; hostname çözülürse IP kontrol edilir."""
    raw = (host or "").strip()
    if not raw:
        return False, "Yazıcı IP/host boş."
    if raw.lower() in ("localhost",):
        return False, "localhost kullanılamaz."
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        try:
            infos = socket.getaddrinfo(raw, None, socket.AF_INET, socket.SOCK_STREAM)
        except OSError as e:
            return False, f"Host çözülemedi: {e}"
        if not infos:
            return False, "Host çözülemedi."
        try:
            ip = ipaddress.ip_address(infos[0][4][0])
        except Exception:
            return False, "Geçersiz IP."
    if ip.version != 4:
        return False, "Yalnızca IPv4 desteklenir."
    if ip.is_loopback or ip.is_unspecified or ip.is_multicast:
        return False, "Bu IP adresi kullanılamaz."
    if str(ip).startswith("169.254."):
        return False, "Link-local / metadata IP engellendi."
    if not ip.is_private:
        return False, "Yalnızca yerel ağ (özel IP) yazıcılarına izin verilir."
    return True, str(ip)


# Yazıcı konfig etiketindeki Serial Port baud — Ethernet raw port değil
_SERIAL_BAUD_PORTS = frozenset({9600, 19200, 38400, 57600, 115200})


def validate_port(port: int) -> int:
    p = int(port or DEFAULT_PORT)
    if p in _SERIAL_BAUD_PORTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Port {p} seri baud hızıdır (yazıcı konfig etiketi), Ethernet ham port değil. "
                "XP-490B Ethernet yazdırma için 9100 kullanın (9100–9109 raw, 515, 631)."
            ),
        )
    if p not in ALLOWED_PORTS:
        raise HTTPException(
            status_code=400,
            detail=f"Port {p} desteklenmiyor. Kullanın: 9100–9109 (raw), 515, 631.",
        )
    return p


def _sync_tcp_send(host: str, port: int, payload: bytes) -> Dict[str, Any]:
    ok_host, resolved = is_allowed_printer_host(host)
    if not ok_host:
        raise ValueError(resolved)
    port = int(port)
    if port not in ALLOWED_PORTS:
        raise ValueError(f"Port {port} desteklenmiyor.")
    if len(payload) > MAX_PAYLOAD:
        raise ValueError(f"Veri çok büyük (max {MAX_PAYLOAD} bayt).")
    sock = socket.create_connection((resolved, port), timeout=CONNECT_TIMEOUT)
    try:
        sock.settimeout(SEND_TIMEOUT)
        sock.sendall(payload)
    finally:
        try:
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            pass
        sock.close()
    return {"ok": True, "host": resolved, "port": port, "bytes": len(payload)}


def _sync_tcp_probe(host: str, port: int) -> Dict[str, Any]:
    ok_host, resolved = is_allowed_printer_host(host)
    if not ok_host:
        raise ValueError(resolved)
    port = int(port)
    if port not in ALLOWED_PORTS:
        raise ValueError(f"Port {port} desteklenmiyor.")
    sock = socket.create_connection((resolved, port), timeout=CONNECT_TIMEOUT)
    try:
        sock.settimeout(1.0)
        try:
            sock.sendall(b"~HS\r\n")
        except OSError:
            pass
    finally:
        sock.close()
    return {"ok": True, "host": resolved, "port": port, "reachable": True}


def _decode_payload(body: SendBody) -> bytes:
    if body.data_b64:
        try:
            raw = base64.b64decode(body.data_b64, validate=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"data_b64 geçersiz: {e}") from e
        if not raw:
            raise HTTPException(status_code=400, detail="Boş yazdırma verisi.")
        return raw
    text = body.data if body.data is not None else ""
    if not str(text).strip():
        raise HTTPException(status_code=400, detail="Yazdırma verisi gerekli (data veya data_b64).")
    enc = (body.encoding or "utf-8").lower()
    if enc not in ("utf-8", "cp857", "latin-1", "ascii"):
        enc = "utf-8"
    try:
        return str(text).encode(enc, errors="replace")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Kodlama hatası: {e}") from e


@router.post("/probe")
async def probe_printer(request: Request, body: ProbeBody):
    """TCP bağlantı testi (ham :9100)."""
    await _require_user(request)
    try:
        validate_port(body.port)
        return await asyncio.to_thread(_sync_tcp_probe, body.host.strip(), int(body.port))
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Yazıcıya ulaşılamadı ({body.host}:{body.port}): {e}. "
            "API sunucusu ile yazıcı aynı yerel ağda olmalı; değilse yerel köprü kullanın.",
        ) from e


@router.post("/send")
async def send_raw(request: Request, body: SendBody):
    """Ham TSPL/ESC-POS baytlarını yazıcıya gönder."""
    await _require_user(request)
    payload = _decode_payload(body)
    try:
        validate_port(body.port)
        return await asyncio.to_thread(_sync_tcp_send, body.host.strip(), int(body.port), payload)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Yazdırma başarısız ({body.host}:{body.port}): {e}. "
            "API sunucusu yazıcıya erişemiyorsa yerel Ethernet köprüsünü kullanın.",
        ) from e
