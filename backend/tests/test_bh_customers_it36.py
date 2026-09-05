"""Iteration 36 backend tests: BizimHesap customers import verification."""
import os
import requests
from pathlib import Path

def _load_env():
    p = Path('/app/frontend/.env')
    for line in p.read_text().splitlines():
        if line.startswith('REACT_APP_BACKEND_URL='):
            return line.split('=', 1)[1].strip()
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or _load_env()).rstrip('/')
COMPANY_ID = "comp_nexus_main_01"


def _login():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@nexus.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return s


def test_bh_config_last_customer_import():
    s = _login()
    r = s.get(f"{BASE_URL}/api/migration/bizimhesap/config", params={"company_id": COMPANY_ID})
    assert r.status_code == 200, r.text
    data = r.json()
    lci = data.get("last_customer_import")
    assert lci, f"last_customer_import missing: {data}"
    print("last_customer_import:", lci)
    assert lci.get("inserted") == 2309, lci
    assert lci.get("updated") == 39, lci
    tb = float(lci.get("total_balance") or 0)
    assert 3361911.0 <= tb <= 3361912.5, tb


def test_contacts_count_and_ersay():
    s = _login()
    r = s.get(f"{BASE_URL}/api/contacts", params={"company_id": COMPANY_ID})
    assert r.status_code == 200
    contacts = r.json()
    print("contacts count:", len(contacts))
    assert len(contacts) >= 2300
    with_bh = [c for c in contacts if c.get("bizimhesap_id")]
    print("with bizimhesap_id:", len(with_bh))
    assert len(with_bh) >= 2300
    ersay = [c for c in contacts if "ERSAY HOME" in (c.get("name") or "").upper()]
    assert ersay, "ERSAY HOME contact not found"
    e = ersay[0]
    print("ERSAY:", e.get("name"), e.get("balance"), e.get("tax_number_or_id"), e.get("tax_office"))
    assert abs(float(e.get("balance") or 0) - 727546.63) < 0.5
    assert e.get("tax_number_or_id") == "3680486408"
    assert (e.get("tax_office") or "").lower().startswith("başakşehir") or "başakşehir" in (e.get("tax_office") or "").lower()


def test_migration_batches_has_bh_customers():
    s = _login()
    r = s.get(f"{BASE_URL}/api/migration/batches", params={"company_id": COMPANY_ID})
    assert r.status_code == 200
    batches = r.json()
    bh = [b for b in batches if b.get("filename") == "BizimHesap API /customers" and b.get("inserted") == 2309]
    assert bh, f"customer batch not found among {[b.get('filename') for b in batches[:10]]}"
    b = bh[0]
    print("batch:", b.get("id"), b.get("inserted"), b.get("updated"), b.get("status"))
    assert b.get("updated") == 39
    assert b.get("status") == "done"


def test_products_count():
    s = _login()
    r = s.get(f"{BASE_URL}/api/products", params={"company_id": COMPANY_ID})
    assert r.status_code == 200
    prods = r.json()
    print("products:", len(prods))
    assert len(prods) >= 1900


def test_rerun_import_skip():
    """Re-run import with on_duplicate=skip; expect 0 inserted, ~2348 skipped, or 429 rate limit."""
    s = _login()
    r = s.post(
        f"{BASE_URL}/api/migration/bizimhesap/import-customers",
        json={"company_id": COMPANY_ID, "on_duplicate": "skip", "only_with_balance": False, "invert_sign": False},
        timeout=180,
    )
    print("rerun status:", r.status_code, r.text[:500])
    if r.status_code == 429:
        print("Rate limited - accepted")
        return
    assert r.status_code == 200, r.text
    data = r.json()
    print("rerun result:", {k: data.get(k) for k in ("read", "inserted", "updated", "skipped")})
    assert data.get("inserted", 0) == 0
    assert data.get("skipped", 0) >= 2300
