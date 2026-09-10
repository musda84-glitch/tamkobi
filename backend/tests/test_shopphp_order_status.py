"""ShopPHP mağazasına sipariş durumu yazma.

Mağaza dokümanı durum güncellemesi için `setOrderStatus` ucunu tarif ediyor:
kimlik `auth_email` + `auth_key = md5(email + md5(parola))`, sipariş no ve durum
ise gövdede `no` + `status` alanlarında (örn. 51 = kargoya teslim edildi).
Bizim istemci yalnızca `updateOrder/no/{no}` + `sdurum` biçimini biliyordu ve
JSON olmayan yanıtı hata sayıyordu; dokümandaki örnek yanıtı XML olarak
ayrıştırdığı için bu da durum yazımını düşürebiliyordu.
"""
import asyncio
import hashlib
import json
import os
import sys

import pytest
from fastapi import HTTPException

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _BACKEND)
sys.path.insert(0, os.path.join(_BACKEND, "docker", "stubs"))
import marketplace_providers as mp  # noqa: E402

CFG = {"store_url": "api.siteniz.com", "api_key": "restapi@domainadi.com", "api_secret": "testapi"}


def run(coro):
    return asyncio.run(coro)


def expected_auth_key(email: str, password: str) -> str:
    return hashlib.md5((email + hashlib.md5(password.encode()).hexdigest()).encode()).hexdigest()


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload or {}, ensure_ascii=False)

    def json(self):
        if self._payload is None:
            raise ValueError("yanıt JSON değil")
        return self._payload


def _patch(monkeypatch, responses):
    """httpx.AsyncClient'ı taklit et; sırayla `responses` döndür, çağrıları biriktir."""
    calls = []
    queue = list(responses)

    class FakeClient:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def request(self, method, url, params=None, data=None):
            calls.append({"method": method, "url": url, "params": params, "data": data})
            item = queue.pop(0) if queue else FakeResponse(payload={})
            if isinstance(item, Exception):
                raise item
            return item

        async def aclose(self):
            return None

    monkeypatch.setattr(mp.httpx, "AsyncClient", FakeClient)
    return calls


class TestSetOrderStatus:
    def test_hits_the_documented_endpoint(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={"success": 1})])
        run(mp.ShopPHPClient(CFG).set_order_status(158238365, 51))
        assert len(calls) == 1
        assert calls[0]["method"] == "POST"
        assert calls[0]["url"] == "https://api.siteniz.com/rest/setOrderStatus"

    def test_order_number_and_status_go_in_the_body(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient(CFG).set_order_status(158238365, 51))
        body = calls[0]["data"]
        assert body["no"] == 158238365
        assert body["status"] == 51
        # Eski biçimin alan adı gönderilmemeli.
        assert "sdurum" not in body

    def test_auth_key_is_md5_of_email_and_md5_password(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient(CFG).set_order_status(1, 2))
        body = calls[0]["data"]
        assert body["auth_email"] == CFG["api_key"]
        assert body["auth_key"] == expected_auth_key(CFG["api_key"], CFG["api_secret"])

    def test_store_url_without_scheme_gets_https(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient({**CFG, "store_url": "api.siteniz.com/"}).set_order_status(1, 51))
        assert calls[0]["url"].startswith("https://api.siteniz.com/rest/")

    def test_bad_credentials_report_the_rest_permission(self, monkeypatch):
        _patch(monkeypatch, [FakeResponse(status_code=403, payload={})])
        with pytest.raises(HTTPException) as e:
            run(mp.ShopPHPClient(CFG).set_order_status(1, 51))
        assert e.value.status_code == 400
        assert "Rest API kullanabilir" in e.value.detail

    def test_missing_rest_base_says_to_enable_the_module(self, monkeypatch):
        """404, kimliğe hiç bakılmadığı anlamına gelir; mağazada REST kapalıdır."""
        _patch(monkeypatch, [FakeResponse(status_code=404, text="<html>404 Not Found</html>")])
        with pytest.raises(HTTPException) as e:
            run(mp.ShopPHPClient(CFG).set_order_status(1, 51))
        assert "REST API'yi etkinleştirin" in e.value.detail
        assert "setOrderStatus" in e.value.detail

    def test_the_404_message_does_not_leak_the_auth_key(self, monkeypatch):
        _patch(monkeypatch, [FakeResponse(status_code=404, text="")])
        with pytest.raises(HTTPException) as e:
            run(mp.ShopPHPClient(CFG).set_order_status(1, 51))
        assert expected_auth_key(CFG["api_key"], CFG["api_secret"]) not in e.value.detail


class TestXmlAnswers:
    """Doküman örneği yanıtı `simplexml_load_string` ile okuyor: XML gelebilir."""

    def test_xml_answer_is_accepted_on_a_write(self, monkeypatch):
        _patch(monkeypatch, [FakeResponse(text="<root><success>1</success></root>")])
        out = run(mp.ShopPHPClient(CFG).set_order_status(158238365, 51))
        assert out["success"] == "1"

    def test_xml_answer_is_accepted_by_update_order(self, monkeypatch):
        _patch(monkeypatch, [FakeResponse(text="<result><success>1</success></result>")])
        out = run(mp.ShopPHPClient(CFG).update_order(1, cargo_firm="Yurtiçi Kargo", tracking="123"))
        assert out["success"] == "1"

    def test_reading_orders_still_requires_json(self, monkeypatch):
        _patch(monkeypatch, [FakeResponse(text="<orders></orders>")])
        with pytest.raises(HTTPException) as e:
            run(mp.ShopPHPClient(CFG).orders(days=1))
        assert "JSON formatını etkinleştirin" in e.value.detail


class TestParseRestAck:
    def test_plain_text_is_kept_for_the_log(self):
        assert mp.parse_rest_ack("OK") == {"raw": "OK"}

    def test_empty_body_is_not_an_error(self):
        assert mp.parse_rest_ack("") == {"raw": ""}

    def test_xml_tags_become_a_flat_dict(self):
        out = mp.parse_rest_ack("<r><success>1</success><no>158238365</no></r>")
        assert out == {"success": "1", "no": "158238365"}

    @pytest.mark.parametrize("body", [
        "<r><success>0</success></r>",
        "<r><durum>hata</durum></r>",
        "<r><error>Sipariş bulunamadı</error></r>",
        "<r><hata>Yetkisiz istek</hata></r>",
    ])
    def test_a_failure_stated_in_the_body_raises(self, body):
        with pytest.raises(HTTPException) as e:
            mp.parse_rest_ack(body)
        assert e.value.status_code == 502
        assert "reddetti" in e.value.detail

    def test_the_store_message_is_carried_into_the_error(self):
        with pytest.raises(HTTPException) as e:
            mp.parse_rest_ack("<r><error>Sipariş bulunamadı</error></r>")
        assert "Sipariş bulunamadı" in e.value.detail

    @pytest.mark.parametrize("body", [
        "<r><success>1</success></r>",
        "<r><error>0</error></r>",
        "<r><message>ok</message></r>",
        "<r><no>158238365</no></r>",
    ])
    def test_an_unclear_body_is_not_treated_as_a_failure(self, body):
        mp.parse_rest_ack(body)


class TestUpdateOrder:
    def test_cargo_only_call_omits_the_status_field(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient(CFG).update_order(77, cargo_firm="Aras Kargo", tracking="X1"))
        body = calls[0]["data"]
        assert body["kargoFirma"] == "Aras Kargo"
        assert body["kargoSeriNo"] == "X1"
        assert "sdurum" not in body

    def test_order_number_stays_in_the_path(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient(CFG).update_order(158238365, invoice_no="FT-1"))
        assert calls[0]["url"].endswith("/rest/updateOrder/no/158238365")


class TestStatusFallback:
    """Dokümandaki uç yoksa durum eski `updateOrder` biçiminden yazılmalı."""

    def _write(self, monkeypatch, responses):
        import server  # noqa: PLC0415 — modül içe alımı ağır, yalnızca bu testlerde
        calls = _patch(monkeypatch, responses)
        monkeypatch.setattr(server.marketplace_providers.httpx, "AsyncClient", mp.httpx.AsyncClient)
        via, _ = run(server._shopphp_write_status(mp.ShopPHPClient(CFG), 158238365, 51))
        return via, calls

    def test_documented_endpoint_is_tried_first(self, monkeypatch):
        via, calls = self._write(monkeypatch, [FakeResponse(payload={"success": 1})])
        assert via == "setOrderStatus"
        assert len(calls) == 1

    def test_falls_back_to_update_order_when_the_endpoint_is_missing(self, monkeypatch):
        via, calls = self._write(monkeypatch, [FakeResponse(status_code=404, payload={}), FakeResponse(payload={})])
        assert via == "updateOrder"
        assert calls[1]["url"].endswith("/rest/updateOrder/no/158238365")
        assert calls[1]["data"]["sdurum"] == 51

    def test_both_failing_reports_the_documented_endpoint_error(self, monkeypatch):
        import server
        _patch(monkeypatch, [FakeResponse(status_code=500, payload={}), FakeResponse(status_code=500, payload={})])
        with pytest.raises(HTTPException) as e:
            run(server._shopphp_write_status(mp.ShopPHPClient(CFG), 1, 51))
        assert "setOrderStatus" in e.value.detail
