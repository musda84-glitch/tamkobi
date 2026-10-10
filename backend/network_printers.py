"""Ethernet / IP (raw TCP :9100) etiket yazıcı — TSPL/ESC-POS gönderimi.

Tarayıcı ham TCP açamaz; API sunucusu yazıcıyla aynı LAN'daysa (ofis Docker)
veya istemci yerel köprü kullanıyorsa doğrudan yazdırma mümkün olur.
SSRF için yalnızca özel IP aralıklarına izin verilir.
"""
from __future__ import annotations

import asyncio
import base64
import concurrent.futures
import ipaddress
import socket
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/network-printers", tags=["network-printers"])
_current_user = None

DEFAULT_PORT = 9100
ALLOWED_PORTS = frozenset(range(9100, 9110)) | {515, 631}
MAX_PAYLOAD = 512_000
CONNECT_TIMEOUT = 4.0
SEND_TIMEOUT = 8.0
SCAN_CONNECT_TIMEOUT = 0.35
SCAN_MAX_HOSTS = 256
SCAN_WORKERS = 48


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


class DiscoverBody(BaseModel):
    """LAN'da :9100 (veya verilen port) açık özel IP'leri tara."""
    subnet: Optional[str] = Field(None, max_length=32)  # örn. 192.168.1.0/24
    host: Optional[str] = Field(None, max_length=253)  # alt ağ ipucu
    port: int = Field(DEFAULT_PORT, ge=1, le=65535)


def local_ipv4() -> Optional[str]:
    """Çıkış arayüzünün IPv4 adresi (UDP connect; paket gitmez)."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("192.168.0.1", 80))
            ip = sock.getsockname()[0]
        finally:
            sock.close()
        parsed = ipaddress.ip_address(ip)
        if parsed.version == 4 and parsed.is_private and not parsed.is_loopback:
            return str(parsed)
    except OSError:
        pass
    return None


def resolve_scan_network(subnet: Optional[str], host_hint: Optional[str]) -> ipaddress.IPv4Network:
    """Yalnızca özel /24 (veya daha dar) tarama ağı."""
    raw_subnet = (subnet or "").strip()
    if raw_subnet:
        try:
            net = ipaddress.ip_network(raw_subnet, strict=False)
        except ValueError as e:
            raise ValueError(f"Geçersiz subnet: {e}") from e
        if not isinstance(net, ipaddress.IPv4Network):
            raise ValueError("Yalnızca IPv4 subnet.")
        if not net.is_private:
            raise ValueError("Yalnızca özel ağ taranabilir.")
        if net.num_addresses > SCAN_MAX_HOSTS + 2:
            # /23 ve daha genişleri /24'e sıkıştır (ağ adresi tarafı)
            net = ipaddress.ip_network(f"{net.network_address}/24", strict=False)
        return net

    hint = (host_hint or "").strip() or (local_ipv4() or "")
    if not hint:
        raise ValueError("Alt ağ bulunamadı. Yazıcı IP veya subnet (192.168.1.0/24) verin.")
    ok, resolved = is_allowed_printer_host(hint)
    if not ok:
        raise ValueError(resolved)
    return ipaddress.ip_network(f"{resolved}/24", strict=False)


def _sync_port_open(host: str, port: int) -> bool:
    try:
        sock = socket.create_connection((host, port), timeout=SCAN_CONNECT_TIMEOUT)
        sock.close()
        return True
    except OSError:
        return False


def _sync_discover(subnet: Optional[str], host_hint: Optional[str], port: int) -> Dict[str, Any]:
    port = int(port)
    if port not in ALLOWED_PORTS:
        raise ValueError(f"Port {port} desteklenmiyor.")
    net = resolve_scan_network(subnet, host_hint)
    hosts = [str(ip) for ip in net.hosts()]
    found: List[Dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=SCAN_WORKERS) as pool:
        futures = {pool.submit(_sync_port_open, h, port): h for h in hosts}
        for fut in concurrent.futures.as_completed(futures):
            host = futures[fut]
            try:
                if fut.result():
                    found.append({"host": host, "port": port})
            except Exception:
                continue
    found.sort(key=lambda row: tuple(int(part) for part in str(row["host"]).split(".")))
    return {
        "ok": True,
        "printers": found,
        "scanned": len(hosts),
        "subnet": str(net),
        "port": port,
    }


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


@router.post("/discover")
async def discover_printers(request: Request, body: DiscoverBody):
    """LAN'da açık :9100 (veya verilen port) özel IP'leri tara."""
    await _require_user(request)
    try:
        port = validate_port(body.port)
        return await asyncio.to_thread(
            _sync_discover,
            (body.subnet or "").strip() or None,
            (body.host or "").strip() or None,
            port,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


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
