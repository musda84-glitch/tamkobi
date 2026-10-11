"""Gerçek HTTP: tokensız 401, public 200, kiracı IDOR 403/404.

Çalışan API + SUPER_ADMIN gerekir. Yoksa skip.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE + "/api"


def _api_up() -> bool:
    try:
        r = requests.get(f"{API}/version", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _api_up(), reason="API /api/version yok — HTTP P0 testleri atlandı")


def _super_session():
    email = (os.environ.get("SUPER_ADMIN_EMAIL") or "").strip().lower()
    password = os.environ.get("SUPER_ADMIN_PASSWORD") or ""
    # Geriye dönük: eski demo veya yeni seed
    candidates = []
    if email and password:
        candidates.append((email, password))
    candidates.extend([
        ("admin@tamkobi.local", "admin123"),
        ("admin@nexus.com", "admin123"),
    ])
    for em, pw in candidates:
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": em, "password": pw}, timeout=20)
        if r.status_code == 200 and r.json().get("user", {}).get("is_super_admin"):
            return s
    pytest.skip("Süper admin girişi yok (SUPER_ADMIN_EMAIL/PASSWORD)")


def _create_tenant(admin: requests.Session, tag: str):
    suffix = uuid.uuid4().hex[:8]
    email = f"{tag}_{suffix}@p0sec.test"
    password = "p0-pass-1"
    r = admin.post(
        f"{API}/system/companies",
        json={
            "name": f"P0 {tag} {suffix}",
            "admin_email": email,
            "admin_password": password,
            "admin_name": f"{tag} Admin",
            "plan_id": "plan_starter",
            "trial_days": 0,
            "city": "Istanbul",
            "tax_number": suffix,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json(), email, password


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return s, r.json()


class TestSecurityP0Http:
    def test_tokensuz_korumali_401(self):
        r = requests.get(f"{API}/contacts", timeout=15)
        assert r.status_code == 401

    def test_public_uclar_200(self):
        assert requests.get(f"{API}/version", timeout=10).status_code == 200
        me = requests.get(f"{API}/auth/me", timeout=10)
        assert me.status_code == 200
        assert me.json().get("authenticated") is False
        notices = requests.get(f"{API}/platform/notices", timeout=10)
        assert notices.status_code == 200

    def test_cross_tenant_contact_invoice_user_404(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "alpha")
        b, b_email, b_pass = _create_tenant(admin, "beta")
        a_id, b_id = a["id"], b["id"]

        sa, _ = _login(a_email, a_pass)
        sb, login_b = _login(b_email, b_pass)

        # A şirketinde cari + fatura
        c = sa.post(
            f"{API}/contacts",
            json={
                "company_id": a_id,
                "type": "customer",
                "name": f"P0 Cari {uuid.uuid4().hex[:6]}",
                "tax_number_or_id": uuid.uuid4().hex[:10],
            },
            timeout=20,
        )
        assert c.status_code == 200, c.text
        contact_id = c.json().get("id") or c.json().get("_id")

        inv = sa.post(
            f"{API}/invoices",
            json={
                "company_id": a_id,
                "invoice_type": "sales",
                "e_type": "paper",
                "contact_id": contact_id,
                "contact_name": "P0",
                "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20, "unit": "Adet"}],
                "status": "draft",
            },
            timeout=30,
        )
        assert inv.status_code == 200, inv.text
        invoice_id = inv.json().get("id") or inv.json().get("_id")

        # B başka şirketin carisine / faturasına erişemesin
        leaked_c = sb.get(f"{API}/contacts/{contact_id}", timeout=15)
        assert leaked_c.status_code in (403, 404), leaked_c.text

        leaked_i = sb.get(f"{API}/invoices/{invoice_id}", timeout=15)
        assert leaked_i.status_code in (403, 404), leaked_i.text

        # B, A kullanıcısını silemesin
        a_user_id = None
        users = sa.get(f"{API}/users", params={"company_id": a_id}, timeout=15)
        if users.status_code == 200:
            for u in users.json().get("users") or []:
                if (u.get("email") or "").lower() == a_email:
                    a_user_id = u.get("id") or u.get("_id")
                    break
        if a_user_id:
            del_u = sb.delete(f"{API}/users/{a_user_id}", timeout=15)
            assert del_u.status_code in (403, 404), del_u.text

        # company_id kaçırma
        leak_list = sb.get(f"{API}/contacts", params={"company_id": a_id}, timeout=15)
        assert leak_list.status_code == 403, leak_list.text

        # imzalı PDF: tokensız + t yok → 401
        bare = requests.get(f"{API}/invoices/{invoice_id}/pdf", timeout=15)
        assert bare.status_code == 401

        # share-link + t ile açılır
        share = sa.get(f"{API}/invoices/{invoice_id}/share-link", params={"kind": "pdf"}, timeout=15)
        assert share.status_code == 200, share.text
        url = share.json()["url"]
        assert "t=" in url
        opened = requests.get(url, timeout=30)
        assert opened.status_code == 200
        assert "pdf" in (opened.headers.get("content-type") or "").lower() or opened.content[:4] == b"%PDF"

        # B share-link üretemez
        deny_share = sb.get(f"{API}/invoices/{invoice_id}/share-link", timeout=15)
        assert deny_share.status_code in (403, 404)
