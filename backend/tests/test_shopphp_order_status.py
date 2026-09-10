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

    @pytest.mark.parametrize("body", [
        "<r><success>1</success><message>Başarılı</message></r>",
        "<r><success>1</success><mesaj>İşlem tamamlandı</mesaj></r>",
        "<r><basarili>1</basarili><aciklama>Kayıt güncellendi</aciklama></r>",
    ])
    def test_bir_bilgilendirme_metni_basariyi_bozmaz(self, body):
        # "message" bilgilendirme alanı: başarı metni de taşıyabildiği için tek
        # başına ret sayılırsa çalışan her gönderim hata görünürdü.
        mp.parse_rest_ack(body)

    def test_acik_basari_bildirimi_diger_alanlari_gecersiz_kilar(self):
        # setOrderStatus yanıtı kendi alanlarını geri döndürüyor; status=0
        # burada bir ret değil, yazılan sipariş durumunun yankısı.
        assert mp.parse_rest_ack("<r><success>1</success><status>0</status></r>")["success"] == "1"

    def test_bilgilendirme_metni_ret_gerekcesine_tasinir(self):
        with pytest.raises(HTTPException) as e:
            mp.parse_rest_ack("<r><success>0</success><message>Ürün bulunamadı</message></r>")
        assert "Ürün bulunamadı" in e.value.detail


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


class TestSetProductActive:
    """Ürünü satışa açma/kapatma ucu: gövdede mağaza ürün ID'si + active 1/0."""

    def test_hits_the_documented_endpoint(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient(CFG).set_product_active(132, False))
        assert calls[0]["method"] == "POST"
        assert calls[0]["url"] == "https://api.siteniz.com/rest/setProduct/active"

    @pytest.mark.parametrize("active,expected", [(False, 0), (True, 1), (0, 0), (1, 1)])
    def test_active_flag_is_sent_as_one_or_zero(self, monkeypatch, active, expected):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient(CFG).set_product_active(132, active))
        assert calls[0]["data"]["ID"] == 132
        assert calls[0]["data"]["active"] == expected

    def test_auth_travels_with_the_product_call(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient(CFG).set_product_active(132, True))
        assert calls[0]["data"]["auth_key"] == expected_auth_key(CFG["api_key"], CFG["api_secret"])

    def test_xml_answer_is_accepted(self, monkeypatch):
        _patch(monkeypatch, [FakeResponse(text="<r><success>1</success></r>")])
        assert run(mp.ShopPHPClient(CFG).set_product_active(132, False))["success"] == "1"

    def test_price_and_stock_also_tolerates_xml(self, monkeypatch):
        _patch(monkeypatch, [FakeResponse(text="<r><success>1</success></r>")])
        out = run(mp.ShopPHPClient(CFG).set_price_stock(132, price=19.9, stock=4))
        assert out["success"] == "1"

    def test_price_and_stock_body(self, monkeypatch):
        calls = _patch(monkeypatch, [FakeResponse(payload={})])
        run(mp.ShopPHPClient(CFG).set_price_stock(132, price=19.9, stock=4))
        assert calls[0]["url"].endswith("/rest/setProduct/priceAndStock")
        assert calls[0]["data"]["ID"] == 132 and calls[0]["data"]["fiyat"] == 19.9 and calls[0]["data"]["stok"] == 4


class TestJsonWriteAcks:
    """İstek `format=json` gönderiyor; ret bildirimi genelde XML'de değil JSON'da geliyor."""

    @pytest.mark.parametrize("payload", [
        {"success": 0, "message": "Ürün bulunamadı"},
        {"error": "Yetkisiz istek"},
        {"basarili": "false"},
        {"data": {"success": 0, "mesaj": "Stok güncellenemedi"}},
    ])
    def test_a_json_body_that_rejects_the_write_raises(self, monkeypatch, payload):
        _patch(monkeypatch, [FakeResponse(payload=payload)])
        with pytest.raises(HTTPException) as e:
            run(mp.ShopPHPClient(CFG).set_product_active(132, False))
        assert e.value.status_code == 502 and "reddetti" in e.value.detail

    def test_the_json_message_is_carried_into_the_error(self, monkeypatch):
        _patch(monkeypatch, [FakeResponse(payload={"success": 0, "message": "Ürün bulunamadı"})])
        with pytest.raises(HTTPException) as e:
            run(mp.ShopPHPClient(CFG).set_price_stock(132, price=1.0, stock=1))
        assert "Ürün bulunamadı" in e.value.detail

    @pytest.mark.parametrize("payload", [{"success": 1}, {"success": 1, "message": "Başarılı"}, {}, {"ID": 132}])
    def test_a_json_body_that_accepts_the_write_passes(self, monkeypatch, payload):
        _patch(monkeypatch, [FakeResponse(payload=payload)])
        run(mp.ShopPHPClient(CFG).set_product_active(132, True))

    def test_read_endpoints_are_not_ack_checked(self, monkeypatch):
        # Listelerde "status" ürünün kendi alanı; ack kuralı okuma yollarına girmemeli.
        _patch(monkeypatch, [FakeResponse(payload={"orders": [{"no": 1, "status": "0"}]})])
        assert run(mp.ShopPHPClient(CFG).orders(days=1)) == [{"no": 1, "status": "0"}]


class FakeCollection:
    def __init__(self, doc=None, by_barcode=None):
        self.doc = doc
        self.by_barcode = by_barcode or {}
        self.inserted = []
        self.updates = []

    async def find_one(self, query, projection=None):
        if self.by_barcode:
            if query.get("_id"):
                return next((p for p in self.by_barcode.values() if p.get("_id") == query["_id"]), None)
            wanted = []
            for cond in query.get("$or", []):
                for value in cond.values():
                    wanted.extend(value["$in"] if isinstance(value, dict) and "$in" in value else [value])
            return next((self.by_barcode[c] for c in wanted if c in self.by_barcode), None)
        return self.doc

    async def insert_one(self, doc):
        self.inserted.append(doc)

    async def update_one(self, query, update, upsert=False):
        self.updates.append((query, update))
        if self.doc is not None:
            self.doc.update(update.get("$set") or {})


class FakeDB:
    def __init__(self, cache_items=(), products=None):
        self.marketplace_product_cache = FakeCollection(doc={"_id": "cache_1", "items": [dict(i) for i in cache_items]})
        self.products = FakeCollection(by_barcode=products or {})
        self.marketplace_push_logs = FakeCollection()


# Üç düz ürün (biri barkodsuz, biri mağaza ID'siz) ve bir varyasyon satırı.
CACHE = [
    {"barcode": "8690000000017", "stock_code": "KOD-1", "product_main_id": "132", "sale_price": 10.0, "quantity": 1},
    {"barcode": "", "stock_code": "KOD-2", "product_main_id": "133"},
    {"barcode": "8690000000031", "stock_code": "KOD-3", "product_main_id": ""},
    {"barcode": "8690000000048", "stock_code": "KOD-4", "product_main_id": "140", "variant": "Kırmızı / L"},
]


def rest_cfg():
    import comm_service
    return {"store_url": "api.siteniz.com", "api_key": "https://api.siteniz.com/xml.php?c=siparisler&xmlc=abc",
            "rest_email": CFG["api_key"], "rest_password_enc": comm_service.encrypt(CFG["api_secret"])}


class TestProductIndex:
    def test_barcode_and_stock_code_both_resolve_to_the_store_id(self, monkeypatch):
        import server
        monkeypatch.setattr(server, "db", FakeDB(CACHE))
        ids = run(server._shopphp_product_ids("comp_1"))
        assert ids["8690000000017"]["id"] == "132"
        assert ids["kod-1"]["id"] == "132"
        assert ids["kod-2"]["id"] == "133"

    def test_rows_without_a_store_id_are_skipped(self, monkeypatch):
        import server
        monkeypatch.setattr(server, "db", FakeDB(CACHE))
        ids = run(server._shopphp_product_ids("comp_1"))
        assert "8690000000031" not in ids

    def test_variant_rows_are_marked_as_variants(self, monkeypatch):
        import server
        monkeypatch.setattr(server, "db", FakeDB(CACHE))
        ids = run(server._shopphp_product_ids("comp_1"))
        assert ids["8690000000048"]["variant"] == "Kırmızı / L" and ids["8690000000048"]["is_variant"]
        assert ids["8690000000017"]["is_variant"] is False

    def test_adsiz_varyasyon_da_varyasyon_sayilir(self, monkeypatch):
        # Varyasyon adı ayrıştırılamayıp boş kaldığında satır ana ürün sanılıyor
        # ve mağazanın ortak urun_ID'sine yazılıp kardeşlerinin fiyatını eziyordu.
        import server
        cache = CACHE + [{"barcode": "8690000000055", "stock_code": "KOD-5", "product_main_id": "141", "variant": "", "is_variant": True}]
        monkeypatch.setattr(server, "db", FakeDB(cache))
        assert run(server._shopphp_product_ids("comp_1"))["8690000000055"]["is_variant"] is True

    def test_ayni_magaza_idsini_paylasan_satirlar_varyasyon_sayilir(self, monkeypatch):
        # is_variant alanı eklenmeden önce yazılmış önbelleklerde bayrak yok;
        # aynı urun_ID'nin birden çok satırda geçmesi tek başına yeterli kanıt.
        import server
        cache = [{"barcode": "AAA", "product_main_id": "150"}, {"barcode": "BBB", "product_main_id": "150"}]
        monkeypatch.setattr(server, "db", FakeDB(cache))
        ids = run(server._shopphp_product_ids("comp_1"))
        assert ids["aaa"]["is_variant"] is True and ids["bbb"]["is_variant"] is True


class TestPushProducts:
    def _push(self, monkeypatch, items, from_stock=False, products=None, responses=None):
        import server
        calls = _patch(monkeypatch, responses or [FakeResponse(payload={})] * 6)
        monkeypatch.setattr(server.marketplace_providers.httpx, "AsyncClient", mp.httpx.AsyncClient)
        db = FakeDB(CACHE, products)
        monkeypatch.setattr(server, "db", db)
        out = run(server._push_products_to_shopphp(rest_cfg(), "comp_1", {"items": items, "from_stock": from_stock}))
        return out, calls, db

    def test_price_and_stock_go_to_the_price_endpoint(self, monkeypatch):
        out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017", "sale_price": 19.9, "quantity": 4}])
        assert out["sent"] == 1
        assert len(calls) == 1
        assert calls[0]["url"].endswith("/setProduct/priceAndStock")
        assert calls[0]["data"]["ID"] == "132"

    def test_active_flag_goes_to_the_active_endpoint(self, monkeypatch):
        out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017", "active": 0}])
        assert out["sent"] == 1
        assert len(calls) == 1
        assert calls[0]["url"].endswith("/setProduct/active")
        assert calls[0]["data"] == {**calls[0]["data"], "ID": "132", "active": 0}

    def test_price_and_active_together_use_both_endpoints(self, monkeypatch):
        _out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017", "sale_price": 5, "active": 1}])
        assert [c["url"].rsplit("/rest/", 1)[1] for c in calls] == ["setProduct/priceAndStock", "setProduct/active"]

    def test_from_stock_reads_the_local_card(self, monkeypatch):
        products = {"8690000000017": {"_id": "p1", "sale_price": 42.5, "stock_quantity": 7}}
        _out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017"}], from_stock=True, products=products)
        assert calls[0]["data"]["fiyat"] == 42.5
        assert calls[0]["data"]["stok"] == 7

    def test_negative_local_stock_is_sent_as_zero(self, monkeypatch):
        products = {"8690000000017": {"_id": "p1", "sale_price": 1, "stock_quantity": -3}}
        _out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017"}], from_stock=True, products=products)
        assert calls[0]["data"]["stok"] == 0

    def test_stok_kodundan_eslesen_kart_da_okunur(self, monkeypatch):
        # Liste ekranı kartı stok koduyla da eşleştiriyor. Burada yalnızca barkoda
        # bakılınca listede eşleşmiş görünen satır "stok kartı yok" diye dönüyordu.
        products = {"KOD-1": {"_id": "p9", "sku": "KOD-1", "sale_price": 33.0, "stock_quantity": 2}}
        out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017", "stock_code": "KOD-1"}], from_stock=True, products=products)
        assert out["sent"] == 1 and calls[0]["data"]["fiyat"] == 33.0

    def test_panelin_verdigi_stok_karti_dogrudan_kullanilir(self, monkeypatch):
        products = {"herhangi": {"_id": "p7", "sale_price": 12.5, "stock_quantity": 4}}
        _out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017", "product_id": "p7"}], from_stock=True, products=products)
        assert calls[0]["data"]["fiyat"] == 12.5 and calls[0]["data"]["stok"] == 4

    def test_a_product_missing_from_the_store_is_reported_not_sent(self, monkeypatch):
        out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017", "active": 1}, {"barcode": "yok-boyle-barkod", "active": 1}])
        assert out["sent"] == 1
        assert out["unmatched"] == ["yok-boyle-barkod"]
        assert len(calls) == 1
        assert "eşleşmedi" in out["message"]

    def test_nothing_to_send_is_refused_with_a_hint(self, monkeypatch):
        import server
        _patch(monkeypatch, [])
        monkeypatch.setattr(server, "db", FakeDB(CACHE))
        with pytest.raises(HTTPException) as e:
            run(server._push_products_to_shopphp(rest_cfg(), "comp_1", {"items": [{"barcode": "8690000000017"}]}))
        assert e.value.status_code == 400

    def test_missing_rest_user_points_at_the_settings_screen(self, monkeypatch):
        import server
        monkeypatch.setattr(server, "db", FakeDB(CACHE))
        with pytest.raises(HTTPException) as e:
            run(server._push_products_to_shopphp({"store_url": "api.siteniz.com"}, "comp_1", {"items": [{"barcode": "x", "active": 1}]}))
        assert e.value.status_code == 400
        assert "Mağazaya Geri Bildirim" in e.value.detail

    def test_a_store_error_on_one_product_does_not_lose_the_others(self, monkeypatch):
        out, _calls, db = self._push(
            monkeypatch,
            [{"barcode": "8690000000017", "active": 1}, {"barcode": "KOD-2", "active": 0}],
            responses=[FakeResponse(status_code=500, payload={}), FakeResponse(payload={})],
        )
        assert out["sent"] == 1
        assert len(out["errors"]) == 1
        assert "yazılamadı" in out["message"]
        assert db.marketplace_push_logs.inserted[0]["errors"]

    def test_every_product_failing_raises(self, monkeypatch):
        with pytest.raises(HTTPException) as e:
            self._push(monkeypatch, [{"barcode": "8690000000017", "active": 1}], responses=[FakeResponse(status_code=500, payload={})])
        assert e.value.status_code == 502

    def test_variants_are_skipped_so_siblings_are_not_overwritten(self, monkeypatch):
        out, calls, _ = self._push(monkeypatch, [{"barcode": "8690000000017", "sale_price": 5}, {"barcode": "8690000000048", "sale_price": 5}])
        assert out["sent"] == 1
        assert out["variants"] == ["8690000000048"]
        assert [c["data"]["ID"] for c in calls] == ["132"]
        assert "varyasyonlu" in out["message"]

    def test_a_variant_only_push_explains_why_nothing_was_sent(self, monkeypatch):
        with pytest.raises(HTTPException) as e:
            self._push(monkeypatch, [{"barcode": "8690000000048", "sale_price": 5}])
        assert e.value.status_code == 400
        assert "Varyasyonlu" in e.value.detail

    def test_a_local_card_miss_is_named_separately_from_a_store_miss(self, monkeypatch):
        with pytest.raises(HTTPException) as e:
            self._push(monkeypatch, [{"barcode": "8690000000017"}], from_stock=True, products={})
        assert "stok kartı yok" in e.value.detail

    def test_sent_values_are_written_back_to_the_cache(self, monkeypatch):
        _out, _calls, db = self._push(monkeypatch, [{"barcode": "8690000000017", "sale_price": 19.9, "quantity": 4, "active": 0}])
        row = next(i for i in db.marketplace_product_cache.doc["items"] if i["barcode"] == "8690000000017")
        assert row["sale_price"] == 19.9
        assert row["quantity"] == 4
        assert row["on_sale"] is False


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
