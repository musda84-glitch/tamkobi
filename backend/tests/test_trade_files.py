"""İthalat / ihracat dosyaları ve fatura dış ticaret alanları."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
API = base_url.rstrip("/") + "/api"
CID = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def created():
    return {"files": [], "invoices": []}


@pytest.fixture(scope="module", autouse=True)
def cleanup(api, created):
    yield
    for iid in created["invoices"]:
        api.delete(f"{API}/invoices/{iid}")
    for fid in created["files"]:
        api.delete(f"{API}/trade-files/{fid}")


def test_meta(api):
    r = api.get(f"{API}/trade-files/meta")
    assert r.status_code == 200, r.text
    d = r.json()
    assert "FOB" in d["incoterms"] and "CIF" in d["incoterms"]
    assert any(x[0] == "4000" for x in d["regimes_import"])
    assert any(x[0] == "1000" for x in d["regimes_export"])
    assert "USD" in d["currencies"]


def test_export_file_and_convert(api, created):
    payload = {
        "company_id": CID,
        "kind": "export",
        "contact_id": "cnt_01",
        "contact_name": "TEST Cari",
        "country": "DE",
        "incoterm": "FOB",
        "currency": "EUR",
        "fx_rate": 46.2,
        "regime_code": "1000",
        "items": [{"name": "Kulaklık", "quantity": 2, "unit_price_fx": 50, "gtip": "8518.30.00.00.00", "origin_country": "TR"}],
    }
    r = api.post(f"{API}/trade-files", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    created["files"].append(d["id"])
    assert d["file_number"].startswith("IHR-")
    assert d["kind"] == "export"
    assert d["amount_fx"] == 100
    assert d["amount_try"] == round(100 * 46.2, 2)
    lst = api.get(f"{API}/trade-files", params={"company_id": CID, "kind": "export"}).json()
    assert any(x["id"] == d["id"] for x in lst)

    conv = api.post(f"{API}/trade-files/{d['id']}/convert-to-invoice", json={})
    assert conv.status_code == 200, conv.text
    body = conv.json()
    inv = body["invoice"]
    created["invoices"].append(inv["id"])
    assert inv["invoice_number"].startswith("IHR")
    assert inv["e_type"] == "e_export"
    assert inv["trade_kind"] == "export"
    assert inv["currency"] == "EUR"
    assert inv["incoterm"] == "FOB"
    assert inv["vat_total"] == 0
    assert inv["items"][0]["gtip"] == "8518.30.00.00.00"

    again = api.post(f"{API}/trade-files/{d['id']}/convert-to-invoice", json={})
    assert again.status_code == 200
    assert again.json()["status"] == "exists"

    exp = api.get(f"{API}/invoices", params={"company_id": CID, "type": "export"}).json()
    assert any(x["id"] == inv["id"] for x in exp)
    sales = api.get(f"{API}/invoices", params={"company_id": CID, "type": "sales"}).json()
    assert any(x["id"] == inv["id"] for x in sales)


def test_import_landed_cost(api, created):
    payload = {
        "company_id": CID,
        "kind": "import",
        "contact_id": "cnt_01",
        "contact_name": "TEST Cari",
        "country": "CN",
        "incoterm": "CIF",
        "currency": "USD",
        "fx_rate": 40,
        "freight": 100,
        "insurance": 50,
        "customs_duty_rate": 10,
        "import_vat_rate": 20,
        "items": [{"name": "Parça", "quantity": 1, "unit_price_fx": 100, "gtip": "8471.30.00.00.00"}],
    }
    r = api.post(f"{API}/trade-files", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    created["files"].append(d["id"])
    assert d["file_number"].startswith("ITH-")
    assert d["amount_try"] == 4000
    assert d["cif"] == 4150
    assert d["customs_duty"] == 415
    assert d["import_vat"] == 913
    assert d["landed_cost"] == 5478
    assert d["items"][0]["landed_unit_try"] == 5478

    conv = api.post(f"{API}/trade-files/{d['id']}/convert-to-invoice", json={})
    assert conv.status_code == 200, conv.text
    inv = conv.json()["invoice"]
    created["invoices"].append(inv["id"])
    assert inv["invoice_number"].startswith("ITH")
    assert inv["invoice_type"] == "purchase"
    assert inv["trade_kind"] == "import"
    assert inv["e_type"] == "paper"
    imps = api.get(f"{API}/invoices", params={"company_id": CID, "type": "import"}).json()
    got = next(x for x in imps if x["id"] == inv["id"])
    assert got.get("incoterm") == "CIF"
    assert got.get("country") == "CN"


def test_direct_e_export_invoice_prefix_and_vat(api, created):
    r = api.post(f"{API}/invoices", json={
        "company_id": CID,
        "contact_id": "cnt_01",
        "contact_name": "TEST Cari",
        "invoice_type": "sales",
        "e_type": "e_export",
        "trade_kind": "export",
        "currency": "USD",
        "fx_rate": 42.5,
        "incoterm": "EXW",
        "country": "US",
        "status": "draft",
        "items": [{"name": "Export item", "quantity": 1, "unit_price": 200, "vat_rate": 20, "total": 200, "gtip": "1234.56"}],
    })
    assert r.status_code == 200, r.text
    inv = r.json()
    created["invoices"].append(inv["id"])
    assert inv["invoice_number"].startswith("IHR")
    assert inv["e_type"] == "e_export"
    assert inv["vat_total"] == 0
    assert inv["grand_total"] == 200
    gib = api.post(f"{API}/invoices/{inv['id']}/send-to-gib", json={"e_type": "e_export"})
    assert gib.status_code == 200, gib.text
    assert "e-İhracat" in gib.json()["message"]


def test_etype_filter_keys_match_db():
    """InvoiceToolbar used to filter e_fatura/e_arsiv; DB stores e_invoice/e_archive/e_export."""
    from pathlib import Path
    src = Path("/workspace/frontend/src/components/InvoiceToolbar.jsx").read_text()
    assert '["e_invoice", "E-Fatura"]' in src
    assert '["e_archive", "E-Arşiv"]' in src
    assert '["e_export", "e-İhracat"]' in src
    assert "e_fatura" not in src
    assert "e_arsiv" not in src
    inv_src = Path("/workspace/frontend/src/pages/InvoicesPage.jsx").read_text()
    assert "inv-declaration" in inv_src and "inv-try-equivalent" in inv_src
    assert "fmtMoney(item.total, formData.currency)" in inv_src
    trade_src = Path("/workspace/frontend/src/pages/TradePage.jsx").read_text()
    assert "trade-status" in trade_src and "trade-print-modal" in trade_src
    assert "landed_unit_try" in Path("/workspace/backend/trade.py").read_text()


def test_status_workflow_and_invoice_customs_fields(api, created):
    r = api.post(f"{API}/trade-files", json={
        "company_id": CID, "kind": "export", "contact_id": "cnt_01", "contact_name": "TEST Cari",
        "country": "IT", "incoterm": "CIP", "currency": "EUR", "fx_rate": 46,
        "items": [{"name": "Makine", "quantity": 1, "unit_price_fx": 10, "gtip": "8479.89", "net_weight": 12, "origin_country": "TR"}],
    })
    assert r.status_code == 200, r.text
    d = r.json()
    created["files"].append(d["id"])
    st = api.post(f"{API}/trade-files/{d['id']}/status", json={"status": "declared", "declaration_no": "BEY-99"})
    assert st.status_code == 200, st.text
    assert st.json()["status"] == "declared" and st.json()["declaration_no"] == "BEY-99"
    cl = api.post(f"{API}/trade-files/{d['id']}/status", json={"status": "cleared"})
    assert cl.status_code == 200 and cl.json()["status"] == "cleared"
    inv = api.post(f"{API}/invoices", json={
        "company_id": CID, "contact_id": "cnt_01", "contact_name": "TEST Cari",
        "invoice_type": "sales", "e_type": "e_export", "trade_kind": "export",
        "currency": "EUR", "fx_rate": 46, "incoterm": "CIP", "country": "IT",
        "declaration_no": "BEY-99", "bl_awb": "BL-1", "dab_no": "DAB-2", "regime_code": "1000",
        "status": "draft",
        "items": [{"name": "Makine", "quantity": 1, "unit_price": 10, "vat_rate": 0, "total": 10, "gtip": "8479.89", "origin_country": "TR"}],
    })
    assert inv.status_code == 200, inv.text
    body = inv.json()
    created["invoices"].append(body["id"])
    assert body["declaration_no"] == "BEY-99" and body["bl_awb"] == "BL-1" and body["dab_no"] == "DAB-2"
    assert body["vat_total"] == 0
