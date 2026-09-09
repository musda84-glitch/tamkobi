"""TLS options for MySQL connections.

Both pymysql and aiomysql accept a ready-made ``ssl.SSLContext``, so every
connection path in the app can share one description of the three modes:

``disabled``   plaintext (only safe on localhost or a trusted private network)
``required``   encrypted, server certificate not checked (MySQL's self-signed
               default certificate still protects the wire)
``verify_ca``  encrypted and the server certificate must chain to the given CA
"""
from __future__ import annotations

import logging
import os
import ssl
from typing import Any, Dict, Optional, Tuple

DISABLED = "disabled"
REQUIRED = "required"
VERIFY_CA = "verify_ca"
SSL_MODES = (DISABLED, REQUIRED, VERIFY_CA)

LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}

_ALIASES = {
    "": DISABLED,
    "0": DISABLED,
    "off": DISABLED,
    "no": DISABLED,
    "false": DISABLED,
    "none": DISABLED,
    "disable": DISABLED,
    "disabled": DISABLED,
    "1": REQUIRED,
    "on": REQUIRED,
    "yes": REQUIRED,
    "true": REQUIRED,
    "require": REQUIRED,
    "required": REQUIRED,
    "preferred": REQUIRED,
    "verify": VERIFY_CA,
    "verify_ca": VERIFY_CA,
    "verify_identity": VERIFY_CA,
}


def normalize_mode(mode: Any) -> str:
    text = str(mode or "").strip().lower().replace("-", "_")
    try:
        return _ALIASES[text]
    except KeyError:
        raise ValueError("TLS modu 'disabled', 'required' veya 'verify_ca' olmalı.") from None


def default_mode(host: Any) -> str:
    """Remote servers are encrypted unless the operator opts out."""
    return DISABLED if str(host or "").strip().lower() in LOCAL_HOSTS else REQUIRED


def settings(cfg: Dict[str, Any]) -> Tuple[str, str]:
    return normalize_mode(cfg.get("ssl_mode")), str(cfg.get("ssl_ca") or "").strip()


def from_env() -> Tuple[str, str]:
    return normalize_mode(os.environ.get("MYSQL_SSL_MODE")), (os.environ.get("MYSQL_SSL_CA") or "").strip()


def context(mode: Any, ca: str = "") -> Optional[ssl.SSLContext]:
    mode = normalize_mode(mode)
    ca = (ca or "").strip()
    if mode == DISABLED:
        return None
    if mode == VERIFY_CA:
        if not ca:
            raise ValueError("verify_ca modu için CA sertifika dosyası gerekir.")
        if not os.path.isfile(ca):
            raise ValueError(f"CA sertifika dosyası bulunamadı: {ca}")
        ctx = ssl.create_default_context(cafile=ca)
        # MySQL server certificates rarely carry the hostname operators connect with.
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_REQUIRED
        return ctx
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def connect_kwargs(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Driver keyword arguments for the TLS mode described by `cfg`."""
    mode, ca = settings(cfg)
    ctx = context(mode, ca)
    return {"ssl": ctx} if ctx is not None else {}


_warned: set = set()


def warn_if_plaintext(cfg: Dict[str, Any]) -> None:
    """Say so, once per host, when a connection to another machine is unencrypted."""
    host = str(cfg.get("host") or "").strip()
    if settings(cfg)[0] != DISABLED or default_mode(host) == DISABLED or host in _warned:
        return
    _warned.add(host)
    logging.getLogger("tamkobi.db").warning(
        "MySQL connection to %s is not encrypted; set MYSQL_SSL_MODE=required "
        "unless the link is already private",
        host,
    )
