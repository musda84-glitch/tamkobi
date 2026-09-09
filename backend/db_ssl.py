"""TLS options for MySQL connections.

Both pymysql and aiomysql accept a ready-made ``ssl.SSLContext``, so every
connection path in the app can share one description of the modes. They mean
what MySQL's own ``--ssl-mode`` means:

``disabled``         plaintext (only for a MySQL on this machine)
``required``         encrypted, certificate NOT checked — an on-path attacker
                     can still present its own certificate, so this is an
                     explicit choice for links that are private by other means
``verify_ca``        the certificate must chain to the CA you name
``verify_identity``  the certificate must chain to a trusted CA *and* match the
                     host you typed; the default for a database on another host
"""
from __future__ import annotations

import logging
import os
import ssl
from typing import Any, Dict, Optional, Tuple

DISABLED = "disabled"
REQUIRED = "required"
VERIFY_CA = "verify_ca"
VERIFY_IDENTITY = "verify_identity"
SSL_MODES = (DISABLED, REQUIRED, VERIFY_CA, VERIFY_IDENTITY)

UNVERIFIED = (DISABLED, REQUIRED)

LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}

_ALIASES = {
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
    "verify_ca": VERIFY_CA,
    "verify": VERIFY_IDENTITY,
    "verify_identity": VERIFY_IDENTITY,
}

STRENGTH = {DISABLED: 0, REQUIRED: 1, VERIFY_CA: 2, VERIFY_IDENTITY: 3}

LABELS = {
    DISABLED: "şifreleme kapalı",
    REQUIRED: "şifreli, sertifika doğrulanmaz",
    VERIFY_CA: "şifreli, CA doğrulamalı",
    VERIFY_IDENTITY: "şifreli, CA ve sunucu adı doğrulamalı",
}


def normalize_mode(mode: Any) -> str:
    text = str(mode or "").strip().lower().replace("-", "_")
    if not text:
        return DISABLED
    try:
        return _ALIASES[text]
    except KeyError:
        raise ValueError(
            "TLS modu 'disabled', 'required', 'verify_ca' veya 'verify_identity' olmalı."
        ) from None


def default_mode(host: Any) -> str:
    """A database on another host is verified; only a local one runs plaintext."""
    return DISABLED if str(host or "").strip().lower() in LOCAL_HOSTS else VERIFY_IDENTITY


def resolve(host: Any) -> Tuple[str, str]:
    """Mode for the database this deployment is already configured with.

    `MYSQL_SSL_MODE` describes that connection, so it wins here; with nothing
    set the host decides. The running pool, the backup script and the log
    writer all go through this, so they cannot disagree about what an unset
    variable means for a database on another machine.
    """
    ca = (os.environ.get("MYSQL_SSL_CA") or "").strip()
    raw = (os.environ.get("MYSQL_SSL_MODE") or "").strip()
    return (normalize_mode(raw) if raw else default_mode(host)), ca


def for_target(host: Any) -> Tuple[str, str]:
    """Mode for a database the operator is pointing us at right now.

    `MYSQL_SSL_MODE` was configured for the current server — commonly
    `disabled` for a MySQL on this machine — so inheriting it would quietly
    copy the whole ERP to someone else's server in the clear. The host's own
    default is the floor; the environment may only raise it.
    """
    floor = default_mode(host)
    env_mode, ca = resolve(host)
    return (env_mode if STRENGTH[env_mode] >= STRENGTH[floor] else floor), ca


def settings(cfg: Dict[str, Any]) -> Tuple[str, str]:
    """The mode `cfg` records, or the floor for its host when it records none.

    A settings file written before this field existed says nothing about TLS.
    Reading that silence as plaintext would leave such a deployment talking to
    a database on another host in the clear, so an absent choice falls back to
    the rule a new target gets.
    """
    ca = str(cfg.get("ssl_ca") or "").strip()
    raw = str(cfg.get("ssl_mode") or "").strip()
    if raw:
        return normalize_mode(raw), ca
    mode, env_ca = for_target(cfg.get("host"))
    return mode, (ca or env_ca)


def _ca_context(ca: str) -> ssl.SSLContext:
    if ca and not os.path.isfile(ca):
        raise ValueError(f"CA sertifika dosyası bulunamadı: {ca}")
    return ssl.create_default_context(cafile=ca or None)


def context(mode: Any, ca: str = "") -> Optional[ssl.SSLContext]:
    mode = normalize_mode(mode)
    ca = (ca or "").strip()
    if mode == DISABLED:
        return None
    if mode == VERIFY_IDENTITY:
        ctx = _ca_context(ca)
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        return ctx
    if mode == VERIFY_CA:
        if not ca:
            raise ValueError("verify_ca modu için CA sertifika dosyası gerekir.")
        ctx = _ca_context(ca)
        # MySQL's VERIFY_CA checks the chain but not the name on the certificate.
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


def explain(exc: BaseException) -> str:
    """A Turkish hint when a connection failed on the certificate, not the login."""
    text = str(exc)
    if not isinstance(exc, ssl.SSLError) and "certificate" not in text.lower() and "SSL" not in text:
        return ""
    return (
        " Sunucunun TLS sertifikası doğrulanamadı. Kendi imzalı sertifika kullanıyorsanız "
        "sunucunun CA dosyasını girip 'CA doğrulamalı' modu seçin; bağlantı zaten özel bir "
        "ağdan geçiyorsa 'doğrulama yapılmaz' modunu bilerek seçebilirsiniz."
    )


_warned: set = set()


def warn_if_unverified(cfg: Dict[str, Any]) -> None:
    """Say so, once per host, when a connection to another machine is not verified."""
    host = str(cfg.get("host") or "").strip()
    mode = settings(cfg)[0]
    if mode not in UNVERIFIED or default_mode(host) == DISABLED or host in _warned:
        return
    _warned.add(host)
    logging.getLogger("tamkobi.db").warning(
        "MySQL connection to %s is %s; set MYSQL_SSL_MODE=verify_identity "
        "unless the link is private by other means",
        host,
        "not encrypted" if mode == DISABLED else "encrypted but unverified",
    )
