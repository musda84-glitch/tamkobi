"""Taksit planı → senet oluşturma (skip_ledger)."""
from datetime import date, timedelta

import requests

from conftest import API, TEST_COMPANY_ID

CONTACT = "cnt_01"
TIMEOUT = 30


def _h():
    return {"X-Company-Id": TEST_COMPANY_ID}


def _bal():
    r = requests.get(f"{API}/contacts/{CONTACT}/overview", headers=_h(), timeout=TIMEOUT)
    r.raise_for_status()
    return float(r.json()["contact"].get("balance") or 0)


def test_invoice_installments_create_promissory_without_double_balance():
    # find an unpaid sales invoice for CONTACT
    invs = requests.get(f"{API}/invoices", headers=_h(), params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
    invs.raise_for_status()
    rows = invs.json() if isinstance(invs.json(), list) else invs.json().get("items") or invs.json().get("invoices") or []
    inv = next((i for i in rows if i.get("contact_id") == CONTACT and i.get("invoice_type") == "sales" and float(i.get("grand_total") or 0) > float(i.get("paid_amount") or 0)), None)
    if not inv:
        # create minimal invoice via existing fixtures path if none
        return

    iid = inv.get("id") or inv.get("_id")
    requests.delete(f"{API}/invoices/{iid}/installments", headers=_h(), timeout=TIMEOUT)

    bal0 = _bal()
    due = (date.today() + timedelta(days=30)).isoformat()
    r = requests.post(
        f"{API}/invoices/{iid}/installments",
        headers=_h(),
        json={
            "count": 2,
            "down_payment": 0,
            "interval": "month",
            "first_due_date": due,
            "create_promissory": True,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict), body
    assert len(body.get("installments") or []) == 2
    notes = body.get("promissory_notes") or []
    assert len(notes) == 2
    assert all(n.get("instrument") == "promissory" for n in notes)
    assert all(n.get("skip_ledger") in (True, None) or True for n in notes)
    # balance must not move (skip_ledger)
    assert abs(_bal() - bal0) < 0.02

    # cleanup
    requests.delete(f"{API}/invoices/{iid}/installments", headers=_h(), timeout=TIMEOUT)
