"""Döviz kurları: TCMB XML parse, manuel kur, fatura/masraf TL karşılığı."""
from datetime import date

import pytest
import requests

from conftest import API as BASE, TEST_COMPANY_ID as CO
import fx as fx_mod

SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="08.09.2026" Date="09/08/2026" Bulten_No="2026/172">
  <Currency Kod="USD" CurrencyCode="USD">
    <Unit>1</Unit>
    <Isim>ABD DOLARI</Isim>
    <ForexBuying>34.1000</ForexBuying>
    <ForexSelling>34.2000</ForexSelling>
  </Currency>
  <Currency Kod="EUR" CurrencyCode="EUR">
    <Unit>1</Unit>
    <Isim>EURO</Isim>
    <ForexBuying>37.0000</ForexBuying>
    <ForexSelling>37.2500</ForexSelling>
  </Currency>
  <Currency Kod="JPY" CurrencyCode="JPY">
    <Unit>100</Unit>
    <Isim>JAPON YENI</Isim>
    <ForexBuying>22.0000</ForexBuying>
    <ForexSelling>23.0000</ForexSelling>
  </Currency>
</Tarih_Date>
"""


def test_parse_tcmb_xml():
    iso, rates = fx_mod.parse_tcmb_xml(SAMPLE)
    assert iso == "2026-09-08"
    assert rates["USD"]["rate"] == 34.2
    assert rates["USD"]["buying"] == 34.1
    assert rates["EUR"]["selling"] == 37.25
    assert abs(rates["JPY"]["rate"] - 0.23) < 1e-9


@pytest.fixture
def s():
    ses = requests.Session()
    ses.headers.update({"Content-Type": "application/json"})
    return ses


def test_manual_rate_roundtrip(s):
    r = s.put(f"{BASE}/fx/rates", json={"company_id": CO, "date": "2026-09-08", "currency": "USD", "rate": 41.5})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["currency"] == "USD" and float(d["rate"]) == 41.5 and d["source"] == "manual"
    q = s.get(f"{BASE}/fx/quote", params={"company_id": CO, "currency": "USD", "date": "2026-09-08"})
    assert q.status_code == 200
    assert float(q.json()["rate"]) == 41.5


def test_invoice_usd_local_total(s):
    s.put(f"{BASE}/fx/rates", json={"company_id": CO, "date": date.today().isoformat(), "currency": "USD", "rate": 40})
    contacts = s.get(f"{BASE}/contacts", params={"company_id": CO})
    assert contacts.status_code == 200
    cid = (contacts.json() or [{}])[0].get("id")
    assert cid, "test contact required"
    body = {
        "company_id": CO,
        "invoice_type": "sales",
        "e_type": "paper",
        "status": "draft",
        "contact_id": cid,
        "contact_name": "FX Test",
        "issue_date": date.today().isoformat(),
        "currency": "USD",
        "fx_rate": 40,
        "fx_source": "manual",
        "items": [{"name": "Dolar kalem", "quantity": 1, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "total": 100, "is_service": True}],
    }
    r = s.post(f"{BASE}/invoices", json=body)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["currency"] == "USD"
    assert float(inv["fx_rate"]) == 40
    assert float(inv["grand_total"]) == 120  # 100 + %20 KDV
    assert float(inv["local_total"]) == 4800


def test_expense_eur_local_total(s):
    s.put(f"{BASE}/fx/rates", json={"company_id": CO, "date": date.today().isoformat(), "currency": "EUR", "rate": 45})
    r = s.post(f"{BASE}/expenses", json={"company_id": CO, "description": "EUR hosting", "amount": 10, "vat_rate": 0, "currency": "EUR", "fx_rate": 45, "category": "Yazılım / Abonelik"})
    assert r.status_code == 200, r.text
    exp = r.json()
    assert exp["currency"] == "EUR"
    assert float(exp["total"]) == 10
    assert float(exp["local_total"]) == 450
