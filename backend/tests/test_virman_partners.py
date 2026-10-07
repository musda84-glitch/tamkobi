"""Virman kaynak/hedef: ortak (partner:) uçları — hesap↔ortak ve ortak↔ortak."""
import uuid

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

CID = TEST_COMPANY_ID
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _manual_accounts(admin):
    return [
        a
        for a in admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json()
        if not a.get("is_integrated")
    ]


def _partners(admin):
    rows = admin.get(f"{API}/banking/partners", params={"company_id": CID}, timeout=20).json()
    return [p for p in rows if p.get("is_active") is not False]


def test_virman_account_to_partner_withdrawal(admin):
    accs = _manual_accounts(admin)
    partners = _partners(admin)
    assert accs and partners
    acc, partner = accs[0], partners[0]
    amount = 17.5
    before_acc = acc["current_balance"]
    before_p = float(partner.get("balance") or 0)
    r = admin.post(
        f"{API}/banking/virman",
        json={
            "company_id": CID,
            "source_account_id": acc["id"],
            "target_account_id": f"partner:{partner['id']}",
            "amount": amount,
            "description": f"test-virman-acc-partner-{uuid.uuid4().hex[:8]}",
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    if body.get("status") == "pending_approval":
        pytest.skip("cash dual approval enabled — pending queue")
    assert body.get("status") == "success"
    after_acc = next(a for a in _manual_accounts(admin) if a["id"] == acc["id"])
    after_p = next(p for p in _partners(admin) if p["id"] == partner["id"])
    assert round(before_acc - after_acc["current_balance"], 2) == amount
    assert round(before_p - float(after_p.get("balance") or 0), 2) == amount


def test_virman_partner_to_account_capital_in(admin):
    accs = [a for a in _manual_accounts(admin) if a.get("type") != "credit_card"]
    partners = _partners(admin)
    assert accs and partners
    acc, partner = accs[0], partners[0]
    amount = 11.25
    before_acc = acc["current_balance"]
    before_p = float(partner.get("balance") or 0)
    r = admin.post(
        f"{API}/banking/virman",
        json={
            "company_id": CID,
            "source_account_id": f"partner:{partner['id']}",
            "target_account_id": acc["id"],
            "amount": amount,
            "description": f"test-virman-partner-acc-{uuid.uuid4().hex[:8]}",
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    if body.get("status") == "pending_approval":
        pytest.skip("cash dual approval enabled — pending queue")
    assert body.get("status") == "success"
    after_acc = next(a for a in _manual_accounts(admin) if a["id"] == acc["id"])
    after_p = next(p for p in _partners(admin) if p["id"] == partner["id"])
    assert round(after_acc["current_balance"] - before_acc, 2) == amount
    assert round(float(after_p.get("balance") or 0) - before_p, 2) == amount


def test_virman_partner_to_partner(admin):
    partners = _partners(admin)
    if len(partners) < 2:
        pytest.skip("need at least 2 partners")
    src, dst = partners[0], partners[1]
    amount = 5.5
    before_s = float(src.get("balance") or 0)
    before_d = float(dst.get("balance") or 0)
    r = admin.post(
        f"{API}/banking/virman",
        json={
            "company_id": CID,
            "source_account_id": f"partner:{src['id']}",
            "target_account_id": f"partner:{dst['id']}",
            "amount": amount,
            "description": f"test-virman-partner-partner-{uuid.uuid4().hex[:8]}",
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    if body.get("status") == "pending_approval":
        pytest.skip("cash dual approval enabled — pending queue")
    assert body.get("status") == "success"
    after = {p["id"]: float(p.get("balance") or 0) for p in _partners(admin)}
    assert round(before_s - after[src["id"]], 2) == amount
    assert round(after[dst["id"]] - before_d, 2) == amount


def _contacts(admin):
    rows = admin.get(f"{API}/contacts", params={"company_id": CID, "lite": "1"}, timeout=20).json()
    return rows if isinstance(rows, list) else []


def _non_card_accounts(admin):
    return [a for a in _manual_accounts(admin) if a.get("type") != "credit_card"]


def test_virman_account_to_contact_outflow(admin):
    accs = _non_card_accounts(admin)
    contacts = _contacts(admin)
    if not accs or not contacts:
        pytest.skip("need cash/bank account + contact")
    acc, contact = accs[0], contacts[0]
    amount = 8.75
    before_acc = acc["current_balance"]
    before_c = float(contact.get("balance") or 0)
    r = admin.post(
        f"{API}/banking/virman",
        json={
            "company_id": CID,
            "source_account_id": acc["id"],
            "target_account_id": f"contact:{contact['id']}",
            "amount": amount,
            "description": f"test-virman-acc-contact-{uuid.uuid4().hex[:8]}",
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    if body.get("status") == "pending_approval":
        pytest.skip("cash dual approval enabled — pending queue")
    assert body.get("status") == "success"
    after_acc = next(a for a in _manual_accounts(admin) if a["id"] == acc["id"])
    after_c = next(c for c in _contacts(admin) if c["id"] == contact["id"])
    assert round(before_acc - after_acc["current_balance"], 2) == amount
    assert round(float(after_c.get("balance") or 0) - before_c, 2) == amount
    txs = admin.get(f"{API}/banking/transactions", params={"company_id": CID, "account_id": acc["id"]}, timeout=20).json()
    hit = next((t for t in txs if t.get("contact_id") == contact["id"] and t.get("source") == "virman"), None)
    assert hit and hit.get("type") == "outflow"
    assert hit.get("category") == "Virman Çıkışı (Cari)"


def test_virman_contact_to_account_inflow(admin):
    accs = _non_card_accounts(admin)
    contacts = _contacts(admin)
    if not accs or not contacts:
        pytest.skip("need cash/bank account + contact")
    acc, contact = accs[0], contacts[0]
    amount = 6.5
    before_acc = acc["current_balance"]
    before_c = float(contact.get("balance") or 0)
    r = admin.post(
        f"{API}/banking/virman",
        json={
            "company_id": CID,
            "source_account_id": f"contact:{contact['id']}",
            "target_account_id": acc["id"],
            "amount": amount,
            "description": f"test-virman-contact-acc-{uuid.uuid4().hex[:8]}",
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    if body.get("status") == "pending_approval":
        pytest.skip("cash dual approval enabled — pending queue")
    assert body.get("status") == "success"
    after_acc = next(a for a in _manual_accounts(admin) if a["id"] == acc["id"])
    after_c = next(c for c in _contacts(admin) if c["id"] == contact["id"])
    assert round(after_acc["current_balance"] - before_acc, 2) == amount
    assert round(before_c - float(after_c.get("balance") or 0), 2) == amount


def test_virman_customer_card_to_account_stamps_card(admin):
    contacts = _contacts(admin)
    accs = _non_card_accounts(admin)
    if not contacts or not accs:
        pytest.skip("need contact + cash/bank")
    contact, acc = contacts[0], accs[0]
    created = admin.post(
        f"{API}/banking/accounts",
        json={
            "company_id": CID,
            "type": "credit_card",
            "bank_name": "Test Kart Bank",
            "account_name": f"Musteri Kart {uuid.uuid4().hex[:6]}",
            "currency": "TRY",
            "current_balance": 0,
            "card_owner": "customer",
            "linked_contact_id": contact["id"],
        },
        timeout=20,
    )
    assert created.status_code == 200, created.text
    card = created.json()
    card["id"] = card.get("id") or card.get("_id")
    amount = 4.25
    r = admin.post(
        f"{API}/banking/virman",
        json={
            "company_id": CID,
            "source_account_id": card["id"],
            "target_account_id": acc["id"],
            "amount": amount,
            "description": f"test-virman-custcard-{uuid.uuid4().hex[:8]}",
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    if body.get("status") == "pending_approval":
        pytest.skip("cash dual approval enabled — pending queue")
    assert body.get("status") == "success"
    txs = admin.get(f"{API}/banking/transactions", params={"company_id": CID, "account_id": card["id"]}, timeout=20).json()
    hit = next((t for t in txs if t.get("customer_card") and t.get("amount") == amount), None)
    assert hit, txs[:5]
    assert hit.get("customer_card_account_id") == card["id"]
    assert hit.get("type") == "transfer"
    assert hit.get("target_account_id") == acc["id"]


def test_virman_partner_to_credit_card_rejected(admin):
    cards = [a for a in _manual_accounts(admin) if a.get("type") == "credit_card"]
    partners = _partners(admin)
    if not cards or not partners:
        pytest.skip("need credit card + partner")
    r = admin.post(
        f"{API}/banking/virman",
        json={
            "company_id": CID,
            "source_account_id": f"partner:{partners[0]['id']}",
            "target_account_id": cards[0]["id"],
            "amount": 3,
            "description": "test-virman-partner-cc-blocked",
        },
        timeout=20,
    )
    assert r.status_code == 400, r.text
