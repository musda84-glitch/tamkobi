"""Restore seeded demo data mutated by iteration-2 tests and remove TEST_ records."""
import os
import requests
from dotenv import dotenv_values

base = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/")
API = base + "/api"

# restore prod_01 variants exactly as seeded
requests.put(f"{API}/products/prod_01/variants", timeout=60, json={
    "variant_options": [{"name": "Renk", "values": ["Gece Siyahı", "Kutup Beyazı"]}],
    "variants": [
        {"variant_id": "v1", "name": "Gece Siyahı", "sku": "NX-BT-PRO-BLK", "barcode": "8680001234012",
         "stock": 82, "price": 1899.0, "attributes": {"Renk": "Gece Siyahı"}},
        {"variant_id": "v2", "name": "Kutup Beyazı", "sku": "NX-BT-PRO-WHT", "barcode": "8680001234013",
         "stock": 60, "price": 1899.0, "attributes": {"Renk": "Kutup Beyazı"}},
    ]})

# remove TEST products
for p in requests.get(f"{API}/products", timeout=60).json():
    if str(p.get("sku") or "").startswith("TEST-") or str(p.get("name") or "").startswith("TEST "):
        requests.delete(f"{API}/products/{p['id']}", timeout=30)
# remove TEST contacts
for c in requests.get(f"{API}/contacts", timeout=60).json():
    if str(c.get("name") or "").startswith("TEST"):
        requests.delete(f"{API}/contacts/{c['id']}", timeout=30)
# remove all bank connections created by tests
for c in requests.get(f"{API}/banking/connections", timeout=60).json():
    requests.delete(f"{API}/banking/connections/{c['id']}", timeout=30)
# remove TEST match rules
for r in requests.get(f"{API}/banking/match-rules", timeout=60).json():
    if "test_" in (r.get("pattern") or "") or (r.get("category") or "").startswith("TEST_"):
        requests.delete(f"{API}/banking/match-rules/{r['id']}", timeout=30)
# remove bogus mail account left by tests
requests.delete(f"{API}/comm/mail/account", timeout=30)
print("cleanup done")
