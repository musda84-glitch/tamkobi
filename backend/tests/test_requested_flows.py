"""Regression coverage for dashboard, accounting, stock, integration and operations flows."""
import os
import uuid

import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
COMPANY = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def client():
    session = requests.Session()
    login = session.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@nexus.com", "password": "admin123"})
    assert login.status_code == 200, login.text
    assert login.json().get("token")
    return session


def test_auth_and_dashboard(client):
    me = client.get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "admin@nexus.com"
    stats = client.get(f"{BASE_URL}/api/dashboard/stats", params={"company_id": COMPANY})
    assert stats.status_code == 200
    body = stats.json()
    for key in ("total_bank_balance", "net_profit", "chart_data", "channels_breakdown"):
        assert key in body
    assert len(body["chart_data"]) == 6


def test_read_all_seeded_modules(client):
    endpoints = [
        "contacts", "products", "invoices", "banking/accounts", "banking/transactions",
        "integrations/ecommerce", "integrations/cargo", "cargo/shipments", "orders",
        "warehouses", "warehouses/transfers", "production/recipes", "production/orders",
        "personnel/employees", "personnel/payrolls",
    ]
    for endpoint in endpoints:
        response = client.get(f"{BASE_URL}/api/{endpoint}", params={"company_id": COMPANY})
        assert response.status_code == 200, f"{endpoint}: {response.text}"
        assert isinstance(response.json(), list), endpoint


def test_contact_create_and_statement(client):
    suffix = uuid.uuid4().hex[:8]
    payload = {"company_id": COMPANY, "type": "customer", "name": f"TEST Cari {suffix}", "tax_number_or_id": f"9{suffix[:9]}", "city": "İstanbul"}
    created = client.post(f"{BASE_URL}/api/contacts", json=payload)
    assert created.status_code == 200
    contact = created.json()
    contact_id = contact.get("id") or contact.get("_id")
    assert contact["name"] == payload["name"]
    statement = client.get(f"{BASE_URL}/api/contacts/{contact_id}/statement")
    assert statement.status_code == 200
    assert statement.json()["contact"]["name"] == payload["name"]


def test_invoice_gib_and_preview_data(client):
    payload = {
        "company_id": COMPANY, "invoice_type": "sales", "e_type": "e_archive",
        "invoice_number": f"TEST-{uuid.uuid4().hex[:10]}", "contact_id": "cnt_01",
        "contact_name": "Trend Mağazacılık", "status": "draft",
        "items": [{"product_id": "prod_02", "name": "Test ürün", "quantity": 2, "unit_price": 100, "vat_rate": 20, "total": 200}],
    }
    created = client.post(f"{BASE_URL}/api/invoices", json=payload)
    assert created.status_code == 200
    invoice_id = created.json().get("id") or created.json().get("_id")
    assert created.json()["grand_total"] == 240
    gib = client.post(f"{BASE_URL}/api/invoices/{invoice_id}/send-to-gib")
    assert gib.status_code == 200
    assert gib.json().get("tracking_id", "").startswith("GIB-")


def test_banking_virman_persists_balances(client):
    before = client.get(f"{BASE_URL}/api/banking/accounts", params={"company_id": COMPANY}).json()
    accounts = {a.get("id") or a.get("_id"): a for a in before}
    source, target = list(accounts)[:2]
    amount = 1.25
    result = client.post(f"{BASE_URL}/api/banking/virman", json={"company_id": COMPANY, "source_account_id": source, "target_account_id": target, "amount": amount})
    assert result.status_code == 200
    after = client.get(f"{BASE_URL}/api/banking/accounts", params={"company_id": COMPANY}).json()
    balances = {a.get("id") or a.get("_id"): a["current_balance"] for a in after}
    assert balances[source] == pytest.approx(accounts[source]["current_balance"] - amount)
    assert balances[target] == pytest.approx(accounts[target]["current_balance"] + amount)


def test_barcode_and_stock_adjustment(client):
    product = client.get(f"{BASE_URL}/api/products/barcode/8680001234028", params={"company_id": COMPANY})
    assert product.status_code == 200
    body = product.json()
    product_id = body.get("id") or body.get("_id")
    old = body["stock_quantity"]
    adjusted = client.post(f"{BASE_URL}/api/products/quick-stock-adjust", json={"product_id": product_id, "quantity_change": 1})
    assert adjusted.status_code == 200
    assert adjusted.json()["new_stock"] == old + 1


def test_ecommerce_connection_and_sync(client):
    configs = client.get(f"{BASE_URL}/api/integrations/ecommerce", params={"company_id": COMPANY}).json()
    channel_id = configs[0].get("id") or configs[0].get("_id")
    tested = client.post(f"{BASE_URL}/api/integrations/ecommerce/{channel_id}/test-connection")
    assert tested.status_code == 200
    assert tested.json()["status"] == "success"
    synced = client.post(f"{BASE_URL}/api/integrations/ecommerce/{channel_id}/sync-now")
    assert synced.status_code == 200
    assert synced.json()["status"] == "success"
    assert synced.json()["order"].get("order_number")


def test_cargo_shipment_and_order_conversion(client):
    shipment = client.post(f"{BASE_URL}/api/cargo/create-shipment", json={"carrier_code": "yurtici", "customer_name": "TEST Alıcı", "address": "Test adres", "city": "İstanbul", "company_id": COMPANY})
    assert shipment.status_code == 200
    assert shipment.json().get("barcode") and shipment.json().get("tracking_number")
    orders = client.get(f"{BASE_URL}/api/orders", params={"company_id": COMPANY}).json()
    order = next(o for o in orders if not o.get("is_invoiced"))
    order_id = order.get("id") or order.get("_id")
    converted = client.post(f"{BASE_URL}/api/orders/{order_id}/convert-to-invoice")
    assert converted.status_code == 200
    assert converted.json().get("invoice_id")


def test_warehouse_production_payroll_and_ai(client):
    warehouses = client.get(f"{BASE_URL}/api/warehouses", params={"company_id": COMPANY}).json()
    products = client.get(f"{BASE_URL}/api/products", params={"company_id": COMPANY}).json()
    transfer = client.post(f"{BASE_URL}/api/warehouses/transfer", json={"company_id": COMPANY, "source_warehouse_id": "wh_main", "target_warehouse_id": "wh_ankara", "product_id": products[0].get("id") or products[0].get("_id"), "product_name": products[0]["name"], "quantity": 1, "transfer_number": ""})
    assert transfer.status_code == 200
    assert transfer.json().get("transfer_number")
    payroll = client.post(f"{BASE_URL}/api/personnel/generate-payroll", json={"company_id": COMPANY, "period": "2099-01"})
    assert payroll.status_code == 200
    assert isinstance(payroll.json().get("payrolls"), list)
    forecast = client.get(f"{BASE_URL}/api/ai/cashflow-forecast", params={"company_id": COMPANY})
    assert forecast.status_code == 200
    assert len(forecast.json().get("forecast_chart", [])) == 30
    advice = client.post(f"{BASE_URL}/api/ai/financial-advisor", json={"company_id": COMPANY, "message": "Nakit akışını özetle"})
    assert advice.status_code == 200
    assert advice.json().get("advice")