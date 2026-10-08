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
    assert doc["items"][0]["unit_price"] == 11999
    assert abs(sum(it["total"] for it in doc["items"]) - 12548.90) < 0.01


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
