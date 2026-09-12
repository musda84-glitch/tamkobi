"""n11 Faturam gelen kutusu: SOAP yanıtının çözülmesi, UBL okuma ve gelen kutusuna kaydetme.

Kullanıcı bildirimi: 105 bekleyen fatura "Tedarikçi ?", 0,00 ₺ ve 0/0 satır olarak
düşmüştü. Buradaki testler o zinciri uçtan uca taklit eder: n11 ReturnValue'yu
base64/ZIP olarak verir, alan adlarını sürüme göre değiştirir, bazen de UBL yerine
başka bir XML gönderir.
"""
import asyncio
import base64
import io
import os
import sys
import tracemalloc
import zipfile

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import edocs  # noqa: E402
import n11faturam  # noqa: E402
from unittest.mock import patch  # noqa: E402

UBL = """<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>ABC2026000000042</cbc:ID>
  <cbc:UUID>11111111-2222-3333-4444-555555555555</cbc:UUID>
  <cbc:IssueDate>2026-09-01</cbc:IssueDate>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567801</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Anadolu Tedarik A.Ş.</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Sanayi Cad. 5</cbc:StreetName><cbc:CityName>Bursa</cbc:CityName></cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Nilüfer</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">180.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">900.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="TRY">1080.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">3</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">900.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cac:TaxSubtotal><cbc:Percent>20</cbc:Percent></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>Ofis Sandalyesi</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>SND-01</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">300.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>""".encode()

# Aynı fatura, ad alanı bildirmeyen entegratör çıktısı olarak.
UBL_NO_NS = b"""<?xml version="1.0"?>
<Invoice>
  <ID>NONS-1</ID><UUID>aaaa-bbbb-cccc</UUID><IssueDate>2026-09-02</IssueDate>
  <AccountingSupplierParty><Party>
    <PartyIdentification><ID schemeID="VKN">9876543210</ID></PartyIdentification>
    <PartyName><Name>Ad Alansiz Ltd.</Name></PartyName>
  </Party></AccountingSupplierParty>
  <LegalMonetaryTotal><PayableAmount>240.00</PayableAmount></LegalMonetaryTotal>
  <InvoiceLine><InvoicedQuantity unitCode="C62">2</InvoicedQuantity>
    <LineExtensionAmount>200.00</LineExtensionAmount>
    <Item><Name>Kablo</Name></Item><Price><PriceAmount>100.00</PriceAmount></Price>
  </InvoiceLine>
</Invoice>"""

SOAP_NOT_UBL = b"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><ErrorResponse><Message>Belge bulunamadi</Message></ErrorResponse></soap:Body>
</soap:Envelope>"""


def _zip(payload: bytes, name: str = "fatura.xml") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(name, payload)
    return buf.getvalue()


def _b64(payload: bytes, wrap: int = 0) -> str:
    text = base64.b64encode(payload).decode("ascii")
    return "\n".join(text[i:i + wrap] for i in range(0, len(text), wrap)) if wrap else text


def _ticket_xml():
    return b"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
  <GetFormsAuthenticationTicketResponse xmlns="http://tempuri.org/">
    <GetFormsAuthenticationTicketResult>TICKET</GetFormsAuthenticationTicketResult>
  </GetFormsAuthenticationTicketResponse>
</soap:Body></soap:Envelope>"""


def _inbox_xml(rows: str, wrapper: str = "InvoiceInfoResult") -> bytes:
    body = "".join(f"<{wrapper}>{r}</{wrapper}>" for r in rows)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
  <GetIncomingInvoicesByIssueDateResponse xmlns="http://tempuri.org/">
    <GetIncomingInvoicesByIssueDateResult>
      <ServiceResult>Successful</ServiceResult>
      <Invoices>{body}</Invoices>
    </GetIncomingInvoicesByIssueDateResult>
  </GetIncomingInvoicesByIssueDateResponse>
</soap:Body></soap:Envelope>""".encode()


def _invoice_xml_response(payload: str, *, action: str = "GetInvoiceXML", as_return_value: bool = False) -> bytes:
    """GetInvoiceXML* SOAP yanıtı üretir.

    Gerçek Digital Planet yanıtı ServiceResult + ReturnValue çocukları taşır;
    eski testler gövdeyi doğrudan Result metnine koyuyordu — ikisini de
    destekliyoruz.
    """
    if as_return_value:
        body = (
            "<ServiceResult>Successful</ServiceResult>"
            "<ServiceResultDescription>Invoice is retrieved successfully.</ServiceResultDescription>"
            f"<ReturnValue>{payload}</ReturnValue>"
        )
    else:
        body = payload
    return f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
  <{action}Response xmlns="http://tempuri.org/">
    <{action}Result>{body}</{action}Result>
  </{action}Response>
</soap:Body></soap:Envelope>""".encode()


def _empty_success_xml(action: str = "GetInvoiceXML") -> bytes:
    return _invoice_xml_response("", action=action, as_return_value=True)


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        return all(d.get(k) == v for k, v in (q or {}).items() if not isinstance(v, dict))

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if self._match(d, q)]
        return FakeCursor(rows)

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, q, update):
        d = await self.find_one(q)
        if d:
            d.update(update.get("$set") or {})

    async def delete_one(self, q):
        d = await self.find_one(q)
        if d:
            self.docs.remove(d)

    async def count_documents(self, q=None):
        return len([d for d in self.docs if self._match(d, q)])


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *a, **k):
        return self

    async def to_list(self, n):
        return list(self.rows[:n])


class FakeDb:
    def __init__(self):
        self.incoming_edocs = FakeCollection()
        self.incoming_edoc_xml = FakeCollection()
        self.contacts = FakeCollection()
        self.products = FakeCollection()


@pytest.fixture
def db():
    fake = FakeDb()
    edocs.init(fake, {})
    return fake


class TestDecodePayload:
    def test_plain_base64_ubl(self):
        assert n11faturam._decode_xml(_b64(UBL)).startswith(b"<?xml")

    def test_base64_with_line_breaks(self):
        assert n11faturam._decode_xml(_b64(UBL, wrap=76)) is not None

    def test_zipped_ubl_is_unpacked(self):
        out = n11faturam._decode_xml(_b64(_zip(UBL)))
        assert out is not None and b"Anadolu Tedarik" in out

    def test_zip_picks_the_ubl_entry(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("imza.xml", b"<Signature/>")
            z.writestr("fatura.xml", UBL)
        out = n11faturam._decode_xml(_b64(buf.getvalue()))
        assert out is not None and b"Anadolu Tedarik" in out

    def test_yuksek_oranli_arsiv_bellegi_tuketmiyor(self):
        # Sıkıştırma bombası: 64 MB sıfır tek bir XML girdisine sığıyor. Sınır
        # yoksa açılmış hali paylaşılan API işçisinin belleğine yazılırdı, o
        # yüzden sonucun doğruluğu değil tepe bellek kullanımı ölçülüyor.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("bomba.xml", b"\0" * (64 * 1024 * 1024))
            z.writestr("fatura.xml", UBL)
        blob = buf.getvalue()
        tracemalloc.start()
        try:
            out = n11faturam._as_xml(blob)
            peak = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
        assert out is not None and b"Anadolu Tedarik" in out
        assert peak < 3 * n11faturam.MAX_ZIP_MEMBER_BYTES

    def test_cok_sayida_girdi_sinirda_kesiliyor(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for i in range(n11faturam.MAX_ZIP_ENTRIES + 20):
                z.writestr(f"dolgu{i}.xml", b"<Signature/>")
            z.writestr("fatura.xml", UBL)
        assert n11faturam._decode_xml(_b64(buf.getvalue())) is None

    def test_toplam_acilan_bayt_sinirli(self):
        # Tek tek sınırın altında kalan girdiler toplamda sınırı aşıyor.
        member = b"<Signature>" + b"x" * (3 * 1024 * 1024) + b"</Signature>"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for i in range(8):
                z.writestr(f"ek{i}.xml", member)
            z.writestr("fatura.xml", UBL)
        assert n11faturam._decode_xml(_b64(buf.getvalue())) is None

    def test_plain_xml_passthrough(self):
        assert n11faturam._decode_xml(UBL.decode()) is not None

    def test_soap_envelope_is_rejected(self):
        # Eski kontrol "<?xml" görmeyi yeterli sayıyordu; bu yüzden boş kayıt açılıyordu.
        assert n11faturam._decode_xml(_b64(SOAP_NOT_UBL)) is None

    def test_garbage_is_rejected(self):
        assert n11faturam._decode_xml("bu base64 bile degil !!!") is None
        assert n11faturam._decode_xml("") is None


class TestFieldNameVariants:
    def test_case_and_underscore_insensitive(self):
        row = "<Uuid>u-1</Uuid><SENDER_TAX_ID>1234567801</SENDER_TAX_ID><PartyName>Tedarikçi A</PartyName><PayableAmount>1080,00</PayableAmount>"
        parsed = n11faturam.parse_service_result(
            n11faturam.parse_soap_xml(_inbox_xml([row])), "GetIncomingInvoicesByIssueDateResult")
        inv = parsed["invoices"][0]
        assert inv["uuid"] == "u-1" and inv["sender_tax_id"] == "1234567801" and inv["party_name"] == "Tedarikçi A"

    def test_unknown_wrapper_tag_still_found(self):
        # Gelen kutusu satırları InvoiceStateResult yerine başka adla sarıldığında liste boş dönüyordu.
        parsed = n11faturam.parse_service_result(
            n11faturam.parse_soap_xml(_inbox_xml(["<UUID>u-2</UUID>"], wrapper="GelenFatura")),
            "GetIncomingInvoicesByIssueDateResult")
        assert [i["uuid"] for i in parsed["invoices"]] == ["u-2"]

    def _wrapped(self, inner_tag: str):
        # Liste kabı (InvoiceListResult) iki fatura satırını sarıyor.
        rows = f"<{inner_tag}><UUID>u-1</UUID></{inner_tag}><{inner_tag}><UUID>u-2</UUID></{inner_tag}>"
        parsed = n11faturam.parse_service_result(
            n11faturam.parse_soap_xml(_inbox_xml([rows], wrapper="InvoiceListResult")),
            "GetIncomingInvoicesByIssueDateResult")
        return [i["uuid"] for i in parsed["invoices"]]

    def test_liste_kabi_fazladan_fatura_uretmiyor(self):
        # Kap da bilinen etiket kümesindeydi; satır sayılınca `_text` alt
        # düğümleri taradığı için ilk faturanın kopyası ikinci kez ekleniyordu.
        assert self._wrapped("InvoiceInfoResult") == ["u-1", "u-2"]

    def test_liste_kabi_faturalari_yutmuyor(self):
        # Kabın çocukları bilinen ad taşımadığında yalnızca kap dönüyordu ve
        # ilkinden sonraki bütün faturalar sessizce kayboluyordu.
        assert self._wrapped("Fatura") == ["u-1", "u-2"]


class TestListIncoming:
    def _run(self, inbox_bytes, xml_by_action=None):
        xml_by_action = xml_by_action or {}

        async def fake_post(url, action, inner):
            if action == "GetFormsAuthenticationTicket":
                return _ticket_xml()
            if action == "GetIncomingInvoicesByIssueDate":
                return inbox_bytes
            if action in ("GetInvoiceXMLWithOutFlag", "GetInvoiceXML"):
                assert action in xml_by_action, f"beklenmeyen {action} çağrısı"
                return xml_by_action[action]
            raise AssertionError(action)

        with patch.object(n11faturam, "_post", side_effect=fake_post):
            return asyncio.run(n11faturam.list_incoming({"username": "u", "corporate_code": "C"}, "pw", days=7))

    def test_return_value_zip_is_used(self):
        row = f"<UUID>u-1</UUID><InvoiceId>ABC2026000000042</InvoiceId><ReturnValue>{_b64(_zip(UBL))}</ReturnValue>"
        rows = self._run(_inbox_xml([row]))
        assert rows[0]["xml"] is not None and rows[0]["xml_error"] == ""

    def test_falls_back_to_get_invoice_xml_without_flag(self):
        rows = self._run(
            _inbox_xml(["<UUID>u-1</UUID>"]),
            {
                "GetInvoiceXMLWithOutFlag": _invoice_xml_response(
                    _b64(UBL), action="GetInvoiceXMLWithOutFlag", as_return_value=True
                ),
            },
        )
        assert rows[0]["xml"] is not None and rows[0]["xml_error"] == ""

    def test_empty_success_description_is_not_shown_as_failure_reason(self):
        # Canlıdaki çelişki: Successful + "Invoice is retrieved successfully." + boş ReturnValue.
        rows = self._run(
            _inbox_xml(["<UUID>u-1</UUID>"]),
            {
                "GetInvoiceXMLWithOutFlag": _empty_success_xml("GetInvoiceXMLWithOutFlag"),
                "GetInvoiceXML": _empty_success_xml("GetInvoiceXML"),
            },
        )
        assert rows[0]["xml"] is None
        assert "successfully" not in (rows[0]["xml_error"] or "").lower()
        assert "UBL" in rows[0]["xml_error"] or "XML" in rows[0]["xml_error"]

    def test_without_flag_recovers_after_empty_get_invoice_xml(self):
        # GetInvoiceXMLWithOutFlag önce denenir; o da boşsa GetInvoiceXML'e düşülür.
        # Bu testte WithOutFlag UBL döndürür — boş GetInvoiceXML'e hiç gidilmez.
        rows = self._run(
            _inbox_xml(["<UUID>ALE2026000007165</UUID>"]),
            {
                "GetInvoiceXMLWithOutFlag": _invoice_xml_response(
                    _b64(UBL), action="GetInvoiceXMLWithOutFlag", as_return_value=True
                ),
                "GetInvoiceXML": _empty_success_xml("GetInvoiceXML"),
            },
        )
        assert rows[0]["xml"] is not None

    def test_non_ubl_payload_is_reported_not_ingested(self):
        row = f"<UUID>u-1</UUID><ReturnValue>{_b64(SOAP_NOT_UBL)}</ReturnValue>"
        rows = self._run(
            _inbox_xml([row]),
            {
                "GetInvoiceXMLWithOutFlag": _invoice_xml_response(
                    _b64(SOAP_NOT_UBL), action="GetInvoiceXMLWithOutFlag", as_return_value=True
                ),
                "GetInvoiceXML": _invoice_xml_response(_b64(SOAP_NOT_UBL), as_return_value=True),
            },
        )
        assert rows[0]["xml"] is None and rows[0]["xml_error"]
        assert "successfully" not in rows[0]["xml_error"].lower()


class TestParseUbl:
    def test_reads_supplier_lines_and_totals(self):
        d = edocs.parse_ubl(UBL)
        assert d["supplier"]["name"] == "Anadolu Tedarik A.Ş." and d["supplier"]["tax_id"] == "1234567801"
        assert d["number"] == "ABC2026000000042" and d["grand_total"] == 1080.0
        assert len(d["lines"]) == 1 and d["lines"][0]["name"] == "Ofis Sandalyesi" and d["lines"][0]["quantity"] == 3.0

    def test_reads_document_without_namespaces(self):
        d = edocs.parse_ubl(UBL_NO_NS)
        assert d["supplier"]["name"] == "Ad Alansiz Ltd." and d["grand_total"] == 240.0 and len(d["lines"]) == 1

    def test_rejects_non_ubl_xml(self):
        # Eskiden bu XML "boş fatura" olarak kaydediliyordu: Tedarikçi ?, 0,00 ₺, 0/0 satır.
        with pytest.raises(HTTPException) as e:
            edocs.parse_ubl(SOAP_NOT_UBL)
        assert e.value.status_code == 400 and "UBL" in e.value.detail

    def test_rejects_empty_invoice_shell(self):
        with pytest.raises(HTTPException):
            edocs.parse_ubl(b"<Invoice><IssueDate>2026-09-01</IssueDate></Invoice>")

    def test_rejects_broken_xml(self):
        with pytest.raises(HTTPException):
            edocs.parse_ubl(b"<Invoice><ID>1</ID>")


def _no_number(line_name: str) -> bytes:
    """Numarası ve ETTN'si olmayan, yalnızca tedarikçi VKN'si ve tarihi olan bir UBL."""
    return (
        '<Invoice><IssueDate>2026-09-05</IssueDate>'
        '<AccountingSupplierParty><Party><PartyName><Name>Ayni Tedarik Ltd.</Name></PartyName>'
        '<PartyIdentification><ID schemeID="VKN">1234567801</ID></PartyIdentification></Party></AccountingSupplierParty>'
        f'<InvoiceLine><Item><Name>{line_name}</Name></Item></InvoiceLine></Invoice>'
    ).encode("utf-8")


class TestIngest:
    def test_stores_details_and_raw_xml(self, db):
        doc = asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL, source="n11faturam"))
        assert doc["supplier"]["name"] == "Anadolu Tedarik A.Ş." and doc["grand_total"] == 1080.0
        assert db.incoming_edoc_xml.docs[0]["xml"].startswith("<?xml")

    def test_repeat_sync_does_not_duplicate(self, db):
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL)) is not None
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL)) is None
        assert len(db.incoming_edocs.docs) == 1

    def test_repeat_sync_without_uuid_does_not_duplicate(self, db):
        # ETTN'siz belgelerde eskiden hiç kontrol yoktu; her senkron yeni kopya açıyordu.
        no_uuid = UBL.replace(b"<cbc:UUID>11111111-2222-3333-4444-555555555555</cbc:UUID>", b"")
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", no_uuid)) is not None
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", no_uuid)) is None
        assert len(db.incoming_edocs.docs) == 1

    def test_other_company_is_not_deduped(self, db):
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL)) is not None
        assert asyncio.run(edocs.ingest_ubl_bytes("comp2", UBL)) is not None

    def test_meta_fills_gaps_from_n11_list(self, db):
        bare = b'<Invoice><ID>NO-PARTY-1</ID><InvoiceLine><Item><Name>Hizmet</Name></Item></InvoiceLine></Invoice>'
        doc = asyncio.run(edocs.ingest_ubl_bytes("comp1", bare, source="n11faturam", meta={
            "party_name": "Liste Tedarik Ltd.", "sender_tax_id": "5555555555",
            "payable": "1250,00", "issue_date": "2026-09-03T00:00:00", "uuid": "meta-uuid"}))
        assert doc["supplier"]["name"] == "Liste Tedarik Ltd." and doc["supplier"]["tax_id"] == "5555555555"
        assert doc["grand_total"] == 1250.0 and doc["issue_date"] == "2026-09-03" and doc["uuid"] == "meta-uuid"

    def test_meta_does_not_overwrite_ubl(self, db):
        doc = asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL, meta={"party_name": "Yanlış", "payable": "1"}))
        assert doc["supplier"]["name"] == "Anadolu Tedarik A.Ş." and doc["grand_total"] == 1080.0

    def test_numarasiz_belgeler_birbirinin_kopyasi_sayilmaz(self, db):
        # Numara ve ETTN yoksa geriye VKN ile tarih kalıyor; ikisi de aynı olan iki
        # ayrı fatura eskiden tek anahtara düşüyor, ikincisi hiç kaydedilmiyordu.
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", _no_number("Ofis Sandalyesi"))) is not None
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", _no_number("Toplantı Masası"))) is not None
        assert len(db.incoming_edocs.docs) == 2

    def test_ayni_numarasiz_belge_yine_tekrarlanmaz(self, db):
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", _no_number("Ofis Sandalyesi"))) is not None
        assert asyncio.run(edocs.ingest_ubl_bytes("comp1", _no_number("Ofis Sandalyesi"))) is None


class TestRepair:
    def _blank(self, db, n=3):
        for i in range(n):
            db.incoming_edocs.docs.append({"_id": f"blank{i}", "company_id": "comp1", "status": "pending", "lines": [],
                                           "supplier": {"name": "", "tax_id": ""}, "grand_total": 0, "received_at": "2026-09-01"})

    def test_cleanup_removes_only_blank_pending(self, db):
        self._blank(db)
        asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL))
        r = asyncio.run(edocs.cleanup_inbox("comp1"))
        assert r["deleted"] == 3 and len(db.incoming_edocs.docs) == 1

    def test_inbox_reports_blank_count(self, db):
        self._blank(db, 2)
        assert asyncio.run(edocs.list_inbox("comp1"))["blank"] == 2

    def test_reparse_recovers_from_stored_xml(self, db):
        asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL))
        doc = db.incoming_edocs.docs[0]
        doc.update({"supplier": {"name": "", "tax_id": ""}, "lines": [], "grand_total": 0})
        r = asyncio.run(edocs.reparse_inbox("comp1"))
        assert r["fixed"] == 1
        assert db.incoming_edocs.docs[0]["supplier"]["name"] == "Anadolu Tedarik A.Ş."
        assert db.incoming_edocs.docs[0]["grand_total"] == 1080.0

    def test_ham_xml_baska_sirkete_verilmez(self, db):
        # Ham UBL tedarikçi VKN'si, adresi ve kalem fiyatlarını taşıyor; belge
        # kimliği tahmin edilerek başka şirketin faturası okunabilmemeli.
        doc = asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL))
        assert asyncio.run(edocs.get_edoc_xml(doc["id"], company_id="comp1"))["xml"].startswith("<?xml")
        with pytest.raises(HTTPException) as e:
            asyncio.run(edocs.get_edoc_xml(doc["id"], company_id="comp2"))
        assert e.value.status_code == 404

    def test_reparse_okunmus_belgeye_dokunmaz(self, db):
        # Yeniden okuma taze çözümlemeyi olduğu gibi yazıyordu; elle eşlenen satır
        # ve elle bağlanan cari, kullanıcı düğmeye bastığı anda siliniyordu.
        asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL))
        doc = db.incoming_edocs.docs[0]
        doc["lines"][0].update({"product_id": "prd1", "product_name": "Sandalye", "auto_matched": False})
        doc.update({"contact_id": "cnt1", "contact_name": "Elle Bağlanan Cari", "matched_lines": 1})
        r = asyncio.run(edocs.reparse_inbox("comp1"))
        assert r["fixed"] == 0
        assert db.incoming_edocs.docs[0]["lines"][0]["product_id"] == "prd1"
        assert db.incoming_edocs.docs[0]["contact_id"] == "cnt1"

    def test_saklanan_liste_bilgisi_ham_xml_tasimaz(self, db):
        # Liste satırı faturanın ham XML'ini de taşıyor. Satır olduğu gibi
        # saklanırsa gelen kutusu yanıtı bu yükü geri gönderir; ham belgeyi ayrı
        # koleksiyonda tutmanın anlamı kalmaz.
        doc = asyncio.run(edocs.ingest_ubl_bytes("comp1", UBL, source="n11faturam", meta={
            "party_name": "Liste Tedarik Ltd.", "payable": "1250,00", "xml": UBL, "return_value": "b64…"}))
        saved = db.incoming_edocs.docs[0]["source_meta"]
        assert set(saved) == {"party_name", "payable"}
        assert "source_meta" not in doc

    def test_reparse_n11_listesinden_gelen_bilgiyi_silmez(self, db):
        # UBL'de tedarikçi ve tutar hiç yok; bunlar liste yanıtından gelmişti.
        bare = b'<Invoice><ID>NO-PARTY-2</ID><InvoiceLine><Item><Name>Hizmet</Name></Item></InvoiceLine></Invoice>'
        asyncio.run(edocs.ingest_ubl_bytes("comp1", bare, source="n11faturam", meta={
            "party_name": "Liste Tedarik Ltd.", "sender_tax_id": "5555555555", "payable": "1250,00"}))
        doc = db.incoming_edocs.docs[0]
        doc.update({"supplier": {"name": "", "tax_id": ""}, "lines": [], "grand_total": 0})
        assert asyncio.run(edocs.reparse_inbox("comp1"))["fixed"] == 1
        assert db.incoming_edocs.docs[0]["supplier"]["name"] == "Liste Tedarik Ltd."
        assert db.incoming_edocs.docs[0]["grand_total"] == 1250.0


class _Req:
    def __init__(self, bearer=None, cookie=None):
        self.headers = {"Authorization": f"Bearer {bearer}"} if bearer is not None else {}
        self.cookies = {"access_token": cookie} if cookie is not None else {}


class TestInboxAuth:
    def _from_token(self, **kw):
        async def user_from_token(token):
            if token != "tok":
                raise HTTPException(status_code=401, detail="Geçersiz oturum anahtarı")
            base = {"company_ids": ["comp1"], "active_company_id": "comp1", "is_super_admin": False}
            base.update(kw)
            return base
        return user_from_token

    def test_oturumsuz_401(self, db):
        with pytest.raises(HTTPException) as e:
            asyncio.run(edocs.require_inbox_company(_Req(), "comp1"))
        assert e.value.status_code == 401

    def test_bos_bearer_401(self, db):
        edocs._deps["user_from_token"] = self._from_token()
        with pytest.raises(HTTPException) as e:
            asyncio.run(edocs.require_inbox_company(_Req(bearer="   "), "comp1"))
        assert e.value.status_code == 401

    def test_bos_bearer_ve_sahte_cerez_401(self, db):
        # Kap çerezi kabul edip get_current_user'a bırakırsa boş Bearer demo
        # yöneticiye düşer. Kullanıcı kapın seçtiği tokendan çözülmeli.
        edocs._deps["user_from_token"] = self._from_token()
        with pytest.raises(HTTPException) as e:
            asyncio.run(edocs.require_inbox_company(_Req(bearer=" ", cookie="dummy"), "comp1"))
        assert e.value.status_code == 401

    def test_tam_bos_bearer_ve_sahte_cerez_401(self, db):
        # Sömürülebilir tek girdi başlığın tam olarak "Bearer " olması:
        # `get_current_user` bunu tokensiz sayıp demo yöneticiye iniyor, oysa
        # `_session_token` çereze düşüp kapı açıyor. Bir boşluk daha olsaydı
        # token boş olmayacak ve düzeltme öncesi kod da reddedecekti, o yüzden
        # gerilemeyi yalnızca bu girdi yakalıyor.
        edocs._deps["user_from_token"] = self._from_token()
        with pytest.raises(HTTPException) as e:
            asyncio.run(edocs.require_inbox_company(_Req(bearer="", cookie="dummy"), "comp1"))
        assert e.value.status_code == 401

    def test_uye_olunmayan_sirket_403(self, db):
        edocs._deps["user_from_token"] = self._from_token()
        with pytest.raises(HTTPException) as e:
            asyncio.run(edocs.require_inbox_company(_Req(cookie="tok"), "comp2"))
        assert e.value.status_code == 403

    def test_uye_oldugu_sirket(self, db):
        edocs._deps["user_from_token"] = self._from_token()
        assert asyncio.run(edocs.require_inbox_company(_Req(cookie="tok"), "comp1")) == "comp1"

    def test_sirket_yoksa_aktif_sirket(self, db):
        edocs._deps["user_from_token"] = self._from_token()
        assert asyncio.run(edocs.require_inbox_company(_Req(cookie="tok"))) == "comp1"

    def test_super_admin_baska_sirket(self, db):
        edocs._deps["user_from_token"] = self._from_token(is_super_admin=True, company_ids=[])
        assert asyncio.run(edocs.require_inbox_company(_Req(cookie="tok"), "comp9")) == "comp9"

    def test_super_admin_sirketsiz_400(self, db):
        edocs._deps["user_from_token"] = self._from_token(is_super_admin=True, company_ids=[], active_company_id="")
        with pytest.raises(HTTPException) as e:
            asyncio.run(edocs.require_inbox_company(_Req(cookie="tok")))
        assert e.value.status_code == 400
