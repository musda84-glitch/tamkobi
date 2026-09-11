"""Yasal metin sayfaları ve sipariş/kayıt onay kutusu zorunluluğu."""
import sys
from pathlib import Path

import pytest
import requests
from fastapi import HTTPException

from conftest import API, resolve_b2b_token, LEGAL_ACCEPT

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from legal_docs import require_acceptance, SLUGS, TITLES, text_to_html


class TestLegalDocsUnit:
    def test_require_acceptance_rejects_partial(self):
        with pytest.raises(HTTPException) as ex:
            require_acceptance({"accept_mss": True, "accept_obf": True})
        assert ex.value.status_code == 400
        require_acceptance(LEGAL_ACCEPT)

    def test_html_renders_headings(self):
        html = text_to_html("MADDE 1 — TARAFLAR\nSatıcı ve alıcı.\n\nMADDE 2 — KONU\nSipariş.")
        assert "<h2>" in html and "MADDE 1" in html


class TestLegalDocsApi:
    def test_platform_index_and_pages(self):
        r = requests.get(f"{API}/public/legal", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert {x["slug"] for x in d["docs"]} == set(SLUGS)
        for slug in SLUGS:
            g = requests.get(f"{API}/public/legal/{slug}", timeout=20)
            assert g.status_code == 200, g.text
            body = g.json()
            assert body["title"] == TITLES[slug]
            assert "html" in body and len(body["html"]) > 80
            assert body["seller"]["name"]

    def test_unknown_slug_404(self):
        r = requests.get(f"{API}/public/legal/yok-boyle-metin", timeout=20)
        assert r.status_code == 404

    def test_b2b_order_requires_checkboxes(self):
        token = resolve_b2b_token()
        portal = requests.get(f"{API}/public/b2b/{token}", timeout=20)
        assert portal.status_code == 200, portal.text
        assert portal.json().get("legal")
        prod = next(p for p in portal.json()["products"] if p.get("id"))
        blocked = requests.post(
            f"{API}/public/b2b/{token}/orders",
            json={"items": [{"product_id": prod["id"], "quantity": 1}], "note": "TEST_legal_no"},
            timeout=20,
        )
        assert blocked.status_code == 400, blocked.text
        assert "onay" in (blocked.json().get("detail") or "").lower() or "KVKK" in (blocked.json().get("detail") or "")
        ok = requests.post(
            f"{API}/public/b2b/{token}/orders",
            json={"items": [{"product_id": prod["id"], "quantity": 1}], "note": "TEST_legal_yes", **LEGAL_ACCEPT},
            timeout=20,
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["order"].get("legal_accept", {}).get("accept_kvkk") is True

    def test_signup_requires_checkboxes(self):
        import uuid
        email = f"legal_{uuid.uuid4().hex[:8]}@test.com"
        r = requests.post(
            f"{API}/public/signup",
            json={"company_name": "Legal Co", "name": "Ali", "email": email, "password": "abc12345"},
            timeout=20,
        )
        assert r.status_code == 400, r.text
        assert "onay" in (r.json().get("detail") or "").lower() or "KVKK" in (r.json().get("detail") or "")
