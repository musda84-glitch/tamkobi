"""Ethernet yazıcı host/port doğrulama birim testleri (TCP yok)."""
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from network_printers import (  # noqa: E402
    _sync_discover,
    is_allowed_printer_host,
    resolve_scan_network,
    validate_port,
)
import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def test_allows_private_ipv4():
    ok, ip = is_allowed_printer_host("192.168.1.100")
    assert ok is True
    assert ip == "192.168.1.100"
    ok, ip = is_allowed_printer_host("10.0.0.5")
    assert ok is True


def test_blocks_public_and_metadata():
    ok, msg = is_allowed_printer_host("8.8.8.8")
    assert ok is False
    assert "özel" in msg.lower() or "yerel" in msg.lower()
    ok, msg = is_allowed_printer_host("169.254.169.254")
    assert ok is False
    ok, msg = is_allowed_printer_host("127.0.0.1")
    assert ok is False


def test_validate_port():
    assert validate_port(9100) == 9100
    with pytest.raises(HTTPException):
        validate_port(22)


def test_validate_port_serial_baud_message():
    with pytest.raises(HTTPException) as ei:
        validate_port(9600)
    assert "seri baud" in ei.value.detail.lower() or "9100" in ei.value.detail
    assert "9600" in ei.value.detail


def test_resolve_scan_network_from_host_hint():
    net = resolve_scan_network(None, "192.168.1.50")
    assert str(net) == "192.168.1.0/24"


def test_resolve_scan_network_rejects_public():
    with pytest.raises(ValueError):
        resolve_scan_network("8.8.8.0/24", None)


def test_sync_discover_finds_open_hosts():
    open_hosts = {"192.168.1.10", "192.168.1.200"}

    def fake_open(host: str, port: int) -> bool:
        assert port == 9100
        return host in open_hosts

    with patch("network_printers._sync_port_open", side_effect=fake_open):
        result = _sync_discover("192.168.1.0/24", None, 9100)
    assert result["ok"] is True
    assert result["subnet"] == "192.168.1.0/24"
    assert result["scanned"] == 254
    hosts = [row["host"] for row in result["printers"]]
    assert hosts == ["192.168.1.10", "192.168.1.200"]
