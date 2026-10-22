"""İşNet TLS: certifi + depoya gömülü GlobalSign ara sertifikası."""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import socket
import ssl
import threading
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import certifi
import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

import isnet
import isnet_portal
import isnet_tls

# openssl x509 -fingerprint -sha256 of backend/certs/globalsign-gcc-r46-ov-tls-ca-2025.pem
_INTERMEDIATE_SHA256 = "d160e2de4e56cb10b66c1cb0adcb79cf93c78dcd9db30c2018220262c04063f9"
_INTERMEDIATE_CN = "GlobalSign GCC R46 OV TLS CA 2025"


def _der() -> bytes:
    return ssl.PEM_cert_to_DER_cert(isnet_tls.intermediate_path().read_text(encoding="ascii"))


def test_ssl_context_loads_bundled_intermediate():
    ctx = isnet_tls.ssl_context()
    assert ctx.verify_mode == ssl.CERT_REQUIRED
    assert ctx.check_hostname is True
    der = _der()
    assert hashlib.sha256(der).hexdigest() == _INTERMEDIATE_SHA256
    loaded = ctx.get_ca_certs(binary_form=True)
    assert der in loaded

    bare = ssl.create_default_context(cafile=certifi.where())
    assert der not in bare.get_ca_certs(binary_form=True)
    assert len(loaded) == len(bare.get_ca_certs(binary_form=True)) + 1

    intermediate = x509.load_der_x509_certificate(der)
    cn = intermediate.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
    assert cn == _INTERMEDIATE_CN
    root = None
    for candidate in loaded:
        try:
            parsed = x509.load_der_x509_certificate(candidate)
        except ValueError:
            continue
        if parsed.subject == intermediate.issuer:
            root = parsed
            break
    assert root is not None
    root.public_key().verify(
        intermediate.signature,
        intermediate.tbs_certificate_bytes,
        padding.PKCS1v15(),
        intermediate.signature_hash_algorithm,
    )


def test_cached_context_is_reused():
    assert isnet_tls.ssl_context() is isnet_tls.ssl_context()


def test_verify_false_is_rejected():
    with pytest.raises(RuntimeError, match="kapatılamaz"):
        isnet_tls.open_async_client(MagicMock(), "", verify=False)
    with pytest.raises(RuntimeError, match="kapatılamaz"):
        isnet._isnet_async_client(verify=False)
    with pytest.raises(RuntimeError, match="kapatılamaz"):
        isnet_portal._http(verify=False)


def test_client_uses_context_without_source_ip(monkeypatch):
    monkeypatch.delenv("EINVOICE_SOURCE_IP", raising=False)
    monkeypatch.delenv("ISNET_SOURCE_IP", raising=False)
    seen = {}

    def _client(**kwargs):
        seen["client"] = kwargs
        return MagicMock(name="client")

    with patch("isnet.httpx.AsyncClient", side_effect=_client), patch(
        "isnet.httpx.AsyncHTTPTransport"
    ) as transport:
        isnet._isnet_async_client(timeout=5)
    transport.assert_not_called()
    assert seen["client"]["verify"] is isnet_tls.ssl_context()
    assert seen["client"]["timeout"] == 5


def test_client_puts_context_on_source_ip_transport(monkeypatch):
    monkeypatch.setenv("EINVOICE_SOURCE_IP", "85.95.240.184")
    monkeypatch.delenv("ISNET_SOURCE_IP", raising=False)
    seen = {}

    def _transport(**kwargs):
        seen["transport"] = kwargs
        return MagicMock(name="transport")

    def _client(**kwargs):
        seen["client"] = kwargs
        return MagicMock(name="client")

    with patch("isnet.httpx.AsyncHTTPTransport", side_effect=_transport), patch(
        "isnet.httpx.AsyncClient", side_effect=_client
    ):
        isnet._isnet_async_client(timeout=5, follow_redirects=True)
    assert seen["transport"]["local_address"] == "85.95.240.184"
    assert seen["transport"]["verify"] is isnet_tls.ssl_context()
    assert "verify" not in seen["client"]
    assert seen["client"]["transport"] is not None
    assert seen["client"]["follow_redirects"] is True


def test_portal_client_uses_same_context(monkeypatch):
    monkeypatch.delenv("EINVOICE_SOURCE_IP", raising=False)
    monkeypatch.delenv("ISNET_SOURCE_IP", raising=False)
    seen = {}

    def _client(**kwargs):
        seen["client"] = kwargs
        return MagicMock(name="client")

    with patch("isnet_portal.httpx.AsyncClient", side_effect=_client), patch(
        "isnet_portal.httpx.AsyncHTTPTransport"
    ) as transport:
        isnet_portal._http(timeout=30.0, headers={"User-Agent": "test"})
    transport.assert_not_called()
    assert seen["client"]["verify"] is isnet_tls.ssl_context()
    assert seen["client"]["headers"]["User-Agent"] == "test"


def test_portal_client_binds_source_ip(monkeypatch):
    monkeypatch.setenv("EINVOICE_SOURCE_IP", "85.95.240.184")
    monkeypatch.delenv("ISNET_SOURCE_IP", raising=False)
    seen = {}

    def _transport(**kwargs):
        seen["transport"] = kwargs
        return MagicMock(name="transport")

    def _client(**kwargs):
        seen["client"] = kwargs
        return MagicMock(name="client")

    with patch("isnet_portal.httpx.AsyncHTTPTransport", side_effect=_transport), patch(
        "isnet_portal.httpx.AsyncClient", side_effect=_client
    ):
        isnet_portal._http(timeout=30.0)
    assert seen["transport"]["local_address"] == "85.95.240.184"
    assert seen["transport"]["verify"] is isnet_tls.ssl_context()
    assert "verify" not in seen["client"]


def test_tls_probe_uses_bundled_context(monkeypatch):
    used = {}

    class _Ctx:
        def wrap_socket(self, sock, server_hostname=None):
            used["host"] = server_hostname
            used["sock"] = sock
            raise ssl.SSLCertVerificationError("stop")

    monkeypatch.setattr(isnet_tls, "ssl_context", lambda: _Ctx())
    with patch(
        "socket.getaddrinfo",
        return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.10", 443))],
    ), patch("socket.create_connection", return_value=MagicMock(name="sock")):
        out = isnet._sync_tls_probe("einvoiceservice.isnet.net.tr", 443, 1.0)
    assert used["host"] == "einvoiceservice.isnet.net.tr"
    assert out["tcp_ok"] is True
    assert out["tls_ok"] is False
    assert "SSLCertVerificationError" in (out["error"] or "")


def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _signed(subject, issuer_name, public_key, issuer_key, *, ca: bool, path_length: int | None = None):
    now = datetime.now(timezone.utc)
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer_name)
        .public_key(public_key)
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=2))
        .add_extension(
            x509.BasicConstraints(ca=ca, path_length=path_length if ca else None),
            critical=True,
        )
    )
    if ca:
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    else:
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        builder = builder.add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        builder = builder.add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.IPv4Address("127.0.0.1"))]),
            critical=False,
        )
    return builder.sign(issuer_key, hashes.SHA256())


def _pem_cert(cert) -> bytes:
    return cert.public_bytes(serialization.Encoding.PEM)


def _pem_key(key) -> bytes:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )


def _serve_leaf(certfile: str, keyfile: str, ready: threading.Event, holder: dict) -> None:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile, keyfile)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    sock.settimeout(5)
    holder["port"] = sock.getsockname()[1]
    ready.set()
    try:
        conn, _ = sock.accept()
        conn.settimeout(5)
        try:
            tls = ctx.wrap_socket(conn, server_side=True)
            tls.recv(8192)
            tls.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
            tls.close()
        except Exception as exc:
            holder["server_error"] = f"{type(exc).__name__}: {exc}"
        finally:
            conn.close()
    except Exception as exc:
        holder["server_error"] = f"{type(exc).__name__}: {exc}"
    finally:
        sock.close()


def _context_with(root_path: str, intermediate_path: str | None) -> ssl.SSLContext:
    ctx = ssl.create_default_context(cafile=root_path)
    if intermediate_path:
        ctx.load_verify_locations(cafile=intermediate_path)
    return ctx


def test_omitted_intermediate_verifies_only_when_loaded(tmp_path):
    """Sunucu yalnız yaprağı gönderir. Ara depoda yoksa zincir kırılır; yüklenince tamamlanır."""
    root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    inter_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    root_name = _name("Test Root")
    inter_name = _name("Test Intermediate")
    root_cert = _signed(root_name, root_name, root_key.public_key(), root_key, ca=True, path_length=1)
    inter_cert = _signed(inter_name, root_name, inter_key.public_key(), root_key, ca=True, path_length=0)
    leaf_cert = _signed(_name("127.0.0.1"), inter_name, leaf_key.public_key(), inter_key, ca=False)
    root_file = tmp_path / "root.pem"
    inter_file = tmp_path / "inter.pem"
    leaf_file = tmp_path / "leaf.pem"
    key_file = tmp_path / "leaf.key"
    root_file.write_bytes(_pem_cert(root_cert))
    inter_file.write_bytes(_pem_cert(inter_cert))
    leaf_file.write_bytes(_pem_cert(leaf_cert))
    key_file.write_bytes(_pem_key(leaf_key))

    async def _get(ctx: ssl.SSLContext, port: int) -> str:
        async with isnet_tls.open_async_client(
            httpx, "", verify=ctx, timeout=3.0, trust_env=False
        ) as client:
            response = await client.get(f"https://127.0.0.1:{port}/")
        return response.text

    def _once(ctx: ssl.SSLContext):
        ready = threading.Event()
        holder: dict = {}
        thread = threading.Thread(
            target=_serve_leaf,
            args=(str(leaf_file), str(key_file), ready, holder),
            daemon=True,
        )
        thread.start()
        assert ready.wait(5)
        try:
            return asyncio.run(_get(ctx, holder["port"])), holder
        finally:
            thread.join(5)

    with pytest.raises(httpx.ConnectError) as missing:
        _once(_context_with(str(root_file), None))
    text = str(missing.value).lower()
    cause = missing.value.__cause__
    cause_text = str(cause).lower() if cause is not None else ""
    assert "certificate verify failed" in text or "certificate verify failed" in cause_text

    body, holder = _once(_context_with(str(root_file), str(inter_file)))
    assert body == "OK"
    assert "server_error" not in holder
