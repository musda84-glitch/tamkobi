"""İşNet TLS doğrulaması.

einvoiceservice.isnet.net.tr ve aynı zinciri kullanan İşNet hostları ara
sertifikayı (GlobalSign GCC R46 OV TLS CA 2025) el sıkışmasında göndermez.
certifi GlobalSign Root R46'yı içerir; ara olmadan OpenSSL
CERTIFICATE_VERIFY_FAILED ('unable to get local issuer certificate') verir.

Üretim her sürümde yeni bir venv kurduğu için certifi demetine elle yama
kaybolur. Ara sertifika bu depodadır. İstemci bağlamı certifi kökleri +
bu aradır. Doğrulama kapatılmaz.
"""
from __future__ import annotations

import ssl
from functools import lru_cache
from pathlib import Path
from typing import Any

import certifi

# PEM. CN=GlobalSign GCC R46 OV TLS CA 2025, issuer CN=GlobalSign Root R46.
_INTERMEDIATE = (
    Path(__file__).resolve().parent / "certs" / "globalsign-gcc-r46-ov-tls-ca-2025.pem"
)


def intermediate_path() -> Path:
    return _INTERMEDIATE


@lru_cache(maxsize=1)
def ssl_context() -> ssl.SSLContext:
    """certifi varsayılanları ve İşNet ara sertifikası. CERT_REQUIRED kalır."""
    path = intermediate_path()
    if not path.is_file():
        raise FileNotFoundError(f"İşNet ara sertifikası yok: {path}")
    der = ssl.PEM_cert_to_DER_cert(path.read_text(encoding="ascii"))
    ctx = ssl.create_default_context(cafile=certifi.where())
    ctx.load_verify_locations(cafile=str(path))
    if ctx.verify_mode != ssl.CERT_REQUIRED or not ctx.check_hostname:
        raise RuntimeError("İşNet TLS doğrulaması kapatılamaz.")
    if der not in ctx.get_ca_certs(binary_form=True):
        raise RuntimeError("İşNet ara sertifikası güven deposuna yüklenmedi.")
    return ctx


def open_async_client(httpx_module: Any, source_ip: str, **kwargs: Any) -> Any:
    """httpx.AsyncClient. Doğrulama açık kalır.

    EINVOICE_SOURCE_IP doluysa taşıyıcı local_address ile kurulur. httpx,
    özel taşıyıcı verildiğinde AsyncClient(verify=...) değerini yok sayar;
    bağlam bu yüzden taşıyıcının verify argümanına yazılır.
    """
    if kwargs.get("verify") is False:
        raise RuntimeError("İşNet TLS doğrulaması kapatılamaz.")
    verify = kwargs.pop("verify", True)
    if verify is True:
        verify = ssl_context()
    source = (source_ip or "").strip()
    if source and "transport" not in kwargs:
        kwargs["transport"] = httpx_module.AsyncHTTPTransport(
            local_address=source,
            verify=verify,
        )
    else:
        kwargs["verify"] = verify
    return httpx_module.AsyncClient(**kwargs)
