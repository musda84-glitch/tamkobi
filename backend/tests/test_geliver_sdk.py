"""Official geliver Python SDK is installed and wired into cargo_providers."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest


def test_geliver_package_importable():
    from geliver import ClientOptions, GeliverClient

    assert ClientOptions is not None
    assert GeliverClient is not None


def test_make_geliver_client_uses_official_sdk():
    import cargo_providers as cp
    from geliver import GeliverClient

    client = cp.make_geliver_client("tok_test")
    assert isinstance(client, GeliverClient)
    assert client._token == "tok_test"
    client._client.close()


def test_geliver_transport_prefers_sdk(monkeypatch):
    import cargo_providers as cp

    monkeypatch.setattr(cp, "USE_GELIVER_SDK", True)
    calls = []

    def fake_sdk(method, path, token, **kwargs):
        calls.append((method, path, token))
        return {"id": "shp_sdk", "offers": {}}

    with patch.object(cp, "_geliver_via_sdk", side_effect=fake_sdk):
        out = asyncio.run(cp._geliver("GET", "/shipments/x", "tok"))
    assert out["id"] == "shp_sdk"
    assert calls == [("GET", "/shipments/x", "tok")]


def test_geliver_sdk_error_maps_friendly():
    import cargo_providers as cp
    from fastapi import HTTPException
    from geliver.client import GeliverError

    monkey_client = MagicMock()
    monkey_client._request.side_effect = GeliverError(
        "bu işlem için yetkiniz yok",
        status=403,
        additional_message="yetki yok",
    )
    monkey_client._client.close = MagicMock()

    with patch.object(cp, "make_geliver_client", return_value=monkey_client):
        with pytest.raises(HTTPException) as exc:
            cp._geliver_via_sdk("POST", "/transactions", "tok", json={"offerID": "o1"})
    assert exc.value.status_code == 400
    assert "yetki" in str(exc.value.detail).lower()
