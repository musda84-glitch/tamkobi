"""Çek / senet: cari etkisi, tahsil, ödeme, ciro, karşılıksız, silme."""
from __future__ import annotations

from datetime import date, timedelta

import requests

from conftest import API, TEST_COMPANY_ID

CONTACT = "cnt_01"
OTHER = "cnt_02"
BANK = "bank_01"
TIMEOUT = 30


def _h():
    return {"X-Company-Id": TEST_COMPANY_ID}


def _contact_balance() -> float:
    r = requests.get(f"{API}/contacts/{CONTACT}/overview", headers=_h(), timeout=TIMEOUT)
    r.raise_for_status()
    return float(r.json()["contact"].get("balance") or 0)


def _bank_balance() -> float:
    r = requests.get(f"{API}/banking/accounts", params={"company_id": TEST_COMPANY_ID}, headers=_h(), timeout=TIMEOUT)
    r.raise_for_status()
    acc = next((a for a in r.json() if a.get("id") == BANK), None)
    assert acc, "bank_01 yok"
    return float(acc.get("current_balance") or 0)


def test_cheque_received_collect_and_bounce():
    due = (date.today() + timedelta(days=10)).isoformat()
    bal0 = _contact_balance()
    bank0 = _bank_balance()

    r = requests.post(
        f"{API}/cheques",
        headers=_h(),
        json={
            "company_id": TEST_COMPANY_ID,
            "instrument": "cheque",
            "direction": "received",
            "contact_id": CONTACT,
            "amount": 250,
            "due_date": due,
            "serial_no": "CK-TEST-1",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    ch = r.json()
    cid = ch["id"]
    assert ch["status"] == "open"
    assert ch["instrument"] == "cheque"
    assert abs(_contact_balance() - (bal0 - 250)) < 0.02

    r = requests.post(
        f"{API}/cheques/{cid}/collect",
        headers=_h(),
        json={"account_id": BANK, "date": date.today().isoformat()},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "collected"
    assert abs(_contact_balance() - (bal0 - 250)) < 0.02
    assert abs(_bank_balance() - (bank0 + 250)) < 0.02

    r = requests.post(f"{API}/cheques/{cid}/bounce", headers=_h(), json={"reason": "test bounce"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "bounced"
    assert abs(_contact_balance() - bal0) < 0.02
    assert abs(_bank_balance() - bank0) < 0.02

    r = requests.delete(f"{API}/cheques/{cid}", headers=_h(), timeout=TIMEOUT)
    assert r.status_code == 200, r.text


def test_cheque_issued_pay():
    due = (date.today() + timedelta(days=5)).isoformat()
    bal0 = _contact_balance()
    bank0 = _bank_balance()

    r = requests.post(
        f"{API}/cheques",
        headers=_h(),
        json={
            "company_id": TEST_COMPANY_ID,
            "kind": "bond",
            "direction": "issued",
            "contact_id": CONTACT,
            "amount": 80,
            "due_date": due,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    assert r.json()["instrument"] == "promissory"
    assert abs(_contact_balance() - (bal0 + 80)) < 0.02

    r = requests.post(f"{API}/cheques/{cid}/collect", headers=_h(), json={"bank_account_id": BANK}, timeout=TIMEOUT)
    assert r.status_code == 400

    r = requests.post(
        f"{API}/cheques/{cid}/pay",
        headers=_h(),
        json={"bank_account_id": BANK, "date": date.today().isoformat()},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid"
    assert abs(_contact_balance() - (bal0 + 80)) < 0.02
    assert abs(_bank_balance() - (bank0 - 80)) < 0.02

    r = requests.delete(f"{API}/cheques/{cid}", headers=_h(), timeout=TIMEOUT)
    assert r.status_code == 400

    r = requests.post(f"{API}/cheques/{cid}/bounce", headers=_h(), json={}, timeout=TIMEOUT)
    assert r.status_code == 200
    assert abs(_contact_balance() - bal0) < 0.02
    assert abs(_bank_balance() - bank0) < 0.02
    requests.delete(f"{API}/cheques/{cid}", headers=_h(), timeout=TIMEOUT)


def test_cheque_endorse_and_validation():
    due = date.today().isoformat()
    r = requests.post(
        f"{API}/cheques",
        headers=_h(),
        json={
            "company_id": TEST_COMPANY_ID,
            "instrument": "cheque",
            "direction": "received",
            "contact_id": CONTACT,
            "amount": 40,
            "due_date": due,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    cid = r.json()["id"]

    r = requests.post(f"{API}/cheques/{cid}/endorse", headers=_h(), json={"contact_id": CONTACT}, timeout=TIMEOUT)
    assert r.status_code == 400

    r = requests.post(f"{API}/cheques/{cid}/endorse", headers=_h(), json={}, timeout=TIMEOUT)
    assert r.status_code == 400

    other0 = float(requests.get(f"{API}/contacts/{OTHER}/overview", headers=_h(), timeout=TIMEOUT).json()["contact"].get("balance") or 0)
    contact0 = _contact_balance()
    r = requests.post(f"{API}/cheques/{cid}/endorse", headers=_h(), json={"contact_id": OTHER}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "endorsed"
    other1 = float(requests.get(f"{API}/contacts/{OTHER}/overview", headers=_h(), timeout=TIMEOUT).json()["contact"].get("balance") or 0)
    assert abs(other1 - (other0 + 40)) < 0.02
    assert abs(_contact_balance() - contact0) < 0.02

    r = requests.post(f"{API}/cheques/missing/collect", headers=_h(), json={"account_id": BANK}, timeout=TIMEOUT)
    assert r.status_code == 404
    r = requests.delete(f"{API}/cheques/{cid}", headers=_h(), timeout=TIMEOUT)
    assert r.status_code == 400

    r = requests.post(f"{API}/cheques/{cid}/bounce", headers=_h(), json={"reason": "ciro geri"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    assert abs(_contact_balance() - (contact0 + 40)) < 0.02
    other2 = float(requests.get(f"{API}/contacts/{OTHER}/overview", headers=_h(), timeout=TIMEOUT).json()["contact"].get("balance") or 0)
    assert abs(other2 - other0) < 0.02
    requests.delete(f"{API}/cheques/{cid}", headers=_h(), timeout=TIMEOUT)

    sm = requests.get(f"{API}/cheques/summary", params={"company_id": TEST_COMPANY_ID}, headers=_h(), timeout=TIMEOUT)
    assert sm.status_code == 200, sm.text
    assert "portfolio" in sm.json()
