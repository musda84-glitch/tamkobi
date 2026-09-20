"""Pazaryeri kargo firması değiştirme + Trendyol cargoProvider yazımı."""
import asyncio
import os
import sys

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _BACKEND)
sys.path.insert(0, os.path.join(_BACKEND, "docker", "stubs"))
import marketplace_providers as mp  # noqa: E402


def run(coro):
    return asyncio.run(coro)


class TestTyCargoProvider:
    def test_maps_code_and_display_name(self):
        assert mp.ty_cargo_provider_name("yurtici") == "Yurtiçi Kargo Marketplace"
        assert mp.ty_cargo_provider_name("trendyolexpress") == "Trendyol Express Marketplace"
        assert mp.ty_cargo_provider_name("trendyol_express") == "Trendyol Express Marketplace"
        assert mp.ty_cargo_provider_name("Yurtiçi Kargo Marketplace") == "Yurtiçi Kargo Marketplace"
        assert mp.ty_cargo_provider_name("") is None


class TestUpdateCargoProviderClient:
    def test_puts_cargo_provider_on_the_package(self, monkeypatch):
        calls = []

        class FakeClient:
            def __init__(self, **kwargs):
                pass

            async def request(self, method, path, **kw):
                calls.append({"method": method, "path": path, **kw})

                class R:
                    status_code = 200
                    content = b"{}"
                    text = "{}"

                    def json(self):
                        return {}

                return R()

            async def aclose(self):
                return None

        monkeypatch.setattr(mp.httpx, "AsyncClient", FakeClient)
        client = mp.TrendyolClient({"api_key": "k", "api_secret": "s", "supplier_id": "123"})
        run(client.update_cargo_provider("pkg1", "Yurtiçi Kargo Marketplace"))
        assert calls[0]["method"] == "PUT"
        assert calls[0]["path"] == "/integration/order/sellers/123/shipment-packages/pkg1"
        assert calls[0]["json"] == {"cargoProvider": "Yurtiçi Kargo Marketplace"}
