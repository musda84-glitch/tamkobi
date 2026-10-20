"""ShopPHP: bağlantı aktif, KDV dahil fiyat, ödeme alanları."""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import marketplace_providers as mp  # noqa: E402


SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<SIPARISLER>
  <SIPARIS>
    <SIPARIS_NO>908188687</SIPARIS_NO>
    <TARIH>2026-10-08</TARIH>
    <ZAMAN>14:21:22</ZAMAN>
    <DURUM_NO>2</DURUM_NO>
    <ODEME_DURUM>Ödendi</ODEME_DURUM>
    <ODEME_SEKLI>PayTR -  / 3 Taksit</ODEME_SEKLI>
    <BANKA_ADI>Kredi Kartı ile Ödeme</BANKA_ADI>
    <NET_TOPLAM>12548.90</NET_TOPLAM>
    <ODEME_TOPLAM>12548.90</ODEME_TOPLAM>
    <ISKONTO>0</ISKONTO>
    <SEPETINDIRIM>0</SEPETINDIRIM>
    <PROMOSYON>0</PROMOSYON>
    <KARGO_UCRETI>0</KARGO_UCRETI>
    <TeslimAlici>OSMAN BEKTEŞ</TeslimAlici>
    <TeslimAdresi>Kayadibi Mah.</TeslimAdresi>
    <TeslimIl>AFYONKARAHİSAR</TeslimIl>
    <TeslimIlce>Merkez</TeslimIlce>
    <TeslimTelefon>0555</TeslimTelefon>
    <POSTA>a@b.com</POSTA>
    <SATIRLAR>
      <SATIR>
        <URUN_ID>1</URUN_ID>
        <ADI>Namaz Kıble</ADI>
        <KOD>NK1</KOD>
        <MIKTAR>1</MIKTAR>
        <FIYAT>11999</FIYAT>
        <KDV>20</KDV>
      </SATIR>
      <SATIR>
        <URUN_ID>2</URUN_ID>
        <ADI>Kitap Standı</ADI>
        <KOD>KS1</KOD>
        <MIKTAR>1</MIKTAR>
        <FIYAT>549.90</FIYAT>
        <KDV>20</KDV>
      </SATIR>
    </SATIRLAR>
  </SIPARIS>
</SIPARISLER>
"""


def test_map_shopphp_xml_order_payment_and_vat_inclusive():
    root = ET.fromstring(SAMPLE)
    s = root.find("SIPARIS")
    doc = mp.map_shopphp_xml_order(s, "c1", "shopphp")
    assert doc["payment_method"] == "PayTR -  / 3 Taksit"
    assert doc["bank_name"] == "Kredi Kartı ile Ödeme"
    assert doc["total_amount"] == 12548.90
    assert all(it.get("price_includes_vat") is True for it in doc["items"])
    assert doc["items"][0]["unit_price"] == 11999  # ham XML brüt; normalize nete indirir
    assert abs(sum(it["total"] for it in doc["items"]) - 12548.90) < 0.01


def test_normalize_shopphp_stores_net_and_keeps_paid_grand_total():
    root = ET.fromstring(SAMPLE)
    doc = mp.map_shopphp_xml_order(root.find("SIPARIS"), "c1", "shopphp")
    out = mp.normalize_marketplace_order_prices(doc)
    assert out["items"][0]["unit_price_incl"] == 11999
    assert abs(out["items"][0]["unit_price"] - 9999.1667) < 0.01
    assert out["items"][1]["unit_price_incl"] == 549.90
    assert out["grand_total"] == 12548.90
    assert out["total_amount"] == 12548.90
    assert abs(out["subtotal"] + out["vat_total"] - out["grand_total"]) < 0.02
    assert abs(sum(it["total_incl"] for it in out["items"]) - 12548.90) < 0.02


HAVALE = """<?xml version="1.0" encoding="UTF-8"?>
<SIPARISLER>
  <SIPARIS>
    <SIPARIS_NO>881325049</SIPARIS_NO>
    <TARIH>2026-10-18</TARIH>
    <ZAMAN>11:05:00</ZAMAN>
    <DURUM_NO>2</DURUM_NO>
    <ODEME_DURUM>Ödeme Onay Bekliyor</ODEME_DURUM>
    <ODEME_SEKLI>Havale</ODEME_SEKLI>
    <BANKA_ADI>Ziraat Bankası</BANKA_ADI>
    <NET_TOPLAM>11999</NET_TOPLAM>
    <ODEME_TOPLAM>11519.04</ODEME_TOPLAM>
    <ISKONTO>0</ISKONTO>
    <SEPETINDIRIM>0</SEPETINDIRIM>
    <PROMOSYON>0</PROMOSYON>
    <TeslimAlici>Ayşe Gökmen</TeslimAlici>
    <SATIRLAR>
      <SATIR>
        <URUN_ID>9</URUN_ID>
        <ADI>Ürün</ADI>
        <KOD>U9</KOD>
        <MIKTAR>1</MIKTAR>
        <FIYAT>11999</FIYAT>
        <KDV>20</KDV>
      </SATIR>
    </SATIRLAR>
  </SIPARIS>
</SIPARISLER>
"""


def test_havale_pending_uses_odeme_toplam_and_keeps_list_price():
    root = ET.fromstring(HAVALE)
    doc = mp.map_shopphp_xml_order(root.find("SIPARIS"), "c1", "shopphp")
    assert doc["payment_type"] == "transfer"
    assert doc["payment_confirmed"] is False
    assert doc["payment_status"] == "Ödeme Onay Bekliyor"
    assert doc["order_status"] == "approved"
    assert doc["total_amount"] == 11519.04
    assert doc["gross_total"] == 11999
    assert doc["discount_total"] == 479.96
    assert doc["items"][0]["unit_price"] == 11999
    out = mp.normalize_marketplace_order_prices(doc)
    assert out["items"][0]["unit_price_incl"] == 11999
    assert abs(out["items"][0]["unit_price"] - 9999.1667) < 0.01
    assert out["total_amount"] == 11519.04
    assert out["discount_total"] == 479.96
    assert out["grand_total"] == 11519.04


def test_explicit_discount_fields_win_and_paid_status_confirms_card():
    assert mp.shopphp_order_amounts(11999, 11519.04, 0, 0, 0, 11999)[2] == 479.96
    total, gross, discount = mp.shopphp_order_amounts(11999, 11000, 500, 0, 0, 11999)
    assert discount == 500
    assert total == 11000
    assert gross == 11999
    assert mp.shopphp_payment_type("PayTR -  / 3 Taksit", "Kredi Kartı ile Ödeme") == "card"
    assert mp.shopphp_payment_confirmed("Ödendi", "2") is True
    assert mp.shopphp_payment_confirmed("Ödendi", "1") is False
    assert mp.shopphp_payment_confirmed("Ödeme Onay Bekliyor", "2") is False
    assert mp.shopphp_payment_confirmed("Ödeme Onaylandı", "2") is True
    assert mp.shopphp_payment_confirmed("Onaylandı", "2") is True
    assert mp.shopphp_payment_confirmed("unpaid", "2") is False
    assert mp.shopphp_payment_confirmed("", "2") is False


def test_rest_havale_order_uses_same_payable_and_transfer_type():
    doc = mp.map_shopphp_order(
        {
            "no": "881325049",
            "durum": "2",
            "NET_TOPLAM": "11999",
            "ODEME_TOPLAM": "11519.04",
            "ISKONTO": "0",
            "ODEME_SEKLI": "EFT",
            "BANKA_ADI": "Garanti BBVA",
            "ODEME_DURUM": "Ödendi",
            "urunler": [{"urunAdi": "Ürün", "adet": 1, "fiyat": "11999"}],
        },
        "c1",
        "shopphp",
    )
    assert doc["total_amount"] == 11519.04
    assert doc["discount_total"] == 479.96
    assert doc["payment_type"] == "transfer"
    assert doc["payment_confirmed"] is True
    assert doc["items"][0]["unit_price"] == 11999


def test_normalize_trendyol_gap_still_follows_line_gross():
    doc = {
        "channel": "trendyol",
        "total_amount": 90,
        "discount_total": 10,
        "items": [{"product_name": "X", "quantity": 1, "unit_price": 100, "vat_rate": 20, "price_includes_vat": True}],
    }
    out = mp.normalize_marketplace_order_prices(doc)
    assert abs(out["grand_total"] - 100) < 0.02
    assert abs(out["total_amount"] - 100) < 0.02


def test_havale_bank_match_is_exact_and_ambiguous_is_empty():
    ziraat = {"_id": "acc_z", "type": "bank", "bank_name": "Ziraat Bankası", "account_name": "Ziraat Vadesiz"}
    paytr = {"_id": "acc_p", "type": "bank", "bank_name": "PayTR", "account_name": "PayTR Hesabı"}
    card = {"_id": "acc_c", "type": "credit_card", "bank_name": "Ziraat", "account_name": "Şirket Kartı"}
    assert mp.pick_havale_bank_account([paytr, card, ziraat], "Ziraat Bankası")["_id"] == "acc_z"
    other = {"_id": "acc_z2", "type": "bank", "bank_name": "Ziraat Bankası", "account_name": "Ziraat Döviz"}
    assert mp.pick_havale_bank_account([ziraat, other], "Ziraat Bankası") is None
    assert mp.pick_havale_bank_account([paytr], "Ziraat Bankası") is None


def test_mismatch_report_flags_pending_paytr_posting_without_mutating():
    order = {
        "channel": "shopphp",
        "payment_type": "transfer",
        "payment_confirmed": False,
        "payment_status": "Ödeme Onay Bekliyor",
        "gross_total": 11999,
        "total_amount": 11519.04,
        "settlement": {"tx_id": "tx_old", "account_id": "acc_paytr", "gross": 11999},
    }
    assert mp.shopphp_settlement_mismatch_reason(order, "acc_paytr") == "odeme_onaylanmamis,havale_paytr_hesabina,liste_fiyati_tahsil"
    paid = {**order, "payment_confirmed": True, "payment_status": "Ödendi", "settlement": {"tx_id": "tx", "account_id": "acc_z", "gross": 11519.04}}
    assert mp.shopphp_settlement_mismatch_reason(paid, "acc_paytr") is None


def test_map_trendyol_marks_price_includes_vat():
    pkg = {
        "orderNumber": "TY1",
        "id": 1,
        "customerFirstName": "A",
        "customerLastName": "B",
        "totalPrice": 120,
        "lines": [{"productName": "X", "price": 100, "quantity": 1, "barcode": "1"}],
        "shipmentAddress": {},
        "invoiceAddress": {},
    }
    doc = mp.map_trendyol_order(pkg, "c1", "trendyol")
    assert doc["items"][0]["price_includes_vat"] is True
    norm = mp.normalize_marketplace_order_prices(doc)
    assert norm["items"][0]["unit_price_incl"] == 100
    assert abs(norm["items"][0]["unit_price"] - 100 / 1.2) < 0.01
