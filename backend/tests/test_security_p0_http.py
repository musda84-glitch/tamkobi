"""Gerçek HTTP: tokensız 401, public 200, kiracı IDOR 403/404, core akışlar.

Çalışan API + SUPER_ADMIN gerekir. API yoksa fail (sessiz skip yok).
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


def _require_api():
    if not _api_up():
        pytest.fail(f"API ayakta değil: {API}/version (REACT_APP_BACKEND_URL={BASE})")


def _super_session():
    _require_api()
    email = (os.environ.get("SUPER_ADMIN_EMAIL") or "").strip().lower()
    password = os.environ.get("SUPER_ADMIN_PASSWORD") or ""
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
    pytest.fail("Süper admin girişi yok (SUPER_ADMIN_EMAIL/PASSWORD veya seed admin)")


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
            "plan_id": "plan_enterprise",
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


def _mk_contact(s, company_id, name=None):
    r = s.post(
        f"{API}/contacts",
        json={
            "company_id": company_id,
            "type": "customer",
            "name": name or f"P0 Cari {uuid.uuid4().hex[:6]}",
            "tax_number_or_id": uuid.uuid4().hex[:10],
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json().get("id") or r.json().get("_id")


def _mk_invoice(s, company_id, contact_id, contact_name="P0"):
    r = s.post(
        f"{API}/invoices",
        json={
            "company_id": company_id,
            "invoice_type": "sales",
            "e_type": "paper",
            "contact_id": contact_id,
            "contact_name": contact_name,
            "items": [
                {
                    "name": "Kalem",
                    "quantity": 1,
                    "unit_price": 10,
                    "vat_rate": 20,
                    "unit": "Adet",
                    "total": 10,
                    "discount_rate": 0,
                }
            ],
            "status": "draft",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json().get("id") or r.json().get("_id"), r.json()


class TestSecurityP0Http:
    def test_tokensuz_korumali_401(self):
        _require_api()
        r = requests.get(f"{API}/contacts", timeout=15)
        assert r.status_code == 401

    def test_public_uclar_200(self):
        _require_api()
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

        contact_id = _mk_contact(sa, a_id)
        invoice_id, _ = _mk_invoice(sa, a_id, contact_id)

        leaked_c = sb.get(f"{API}/contacts/{contact_id}", timeout=15)
        assert leaked_c.status_code in (403, 404), leaked_c.text

        leaked_i = sb.get(f"{API}/invoices/{invoice_id}", timeout=15)
        assert leaked_i.status_code in (403, 404), leaked_i.text

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

        leak_list = sb.get(f"{API}/contacts", params={"company_id": a_id}, timeout=15)
        assert leak_list.status_code == 403, leak_list.text

        bare = requests.get(f"{API}/invoices/{invoice_id}/pdf", timeout=15)
        assert bare.status_code == 401

        share = sa.get(f"{API}/invoices/{invoice_id}/share-link", params={"kind": "pdf"}, timeout=15)
        assert share.status_code == 200, share.text
        url = share.json()["url"]
        assert "t=" in url
        assert share.json().get("expires_in", 0) >= 90 * 24 * 3600 - 60
        opened = requests.get(url, timeout=30)
        assert opened.status_code == 200
        assert "pdf" in (opened.headers.get("content-type") or "").lower() or opened.content[:4] == b"%PDF"

        deny_share = sb.get(f"{API}/invoices/{invoice_id}/share-link", timeout=15)
        assert deny_share.status_code in (403, 404)

    def test_invoice_copy_via_core(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "copy")
        sa, _ = _login(a_email, a_pass)
        cid = _mk_contact(sa, a["id"])
        inv_id, _ = _mk_invoice(sa, a["id"], cid)
        r = sa.post(f"{API}/invoices/{inv_id}/copy", json={"mode": "same_contact"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("invoice") or r.json().get("status") == "success"

    def test_create_quote_http(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "quote")
        # Kurumsal planda teklif açık; yoksa lisans modülünü aç
        en = admin.post(f"{API}/system/companies/{a['id']}/modules/quotes", json={"enabled": True}, timeout=20)
        if en.status_code not in (200, 201):
            admin.put(
                f"{API}/system/companies/{a['id']}/license",
                json={"plan_id": "plan_enterprise"},
                timeout=20,
            )
        sa, _ = _login(a_email, a_pass)
        cid = _mk_contact(sa, a["id"])
        r = sa.post(
            f"{API}/quotes",
            json={
                "company_id": a["id"],
                "contact_id": cid,
                "contact_name": "Q",
                "title": "P0 teklif",
                "items": [{"name": "Hizmet", "quantity": 1, "unit_price": 100, "vat_rate": 20, "unit": "Adet"}],
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("quote_number") or r.json().get("id")

    def test_trash_get_delete_company_guard(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "trasha")
        b, b_email, b_pass = _create_tenant(admin, "trashb")
        sa, _ = _login(a_email, a_pass)
        sb, _ = _login(b_email, b_pass)
        cid = _mk_contact(sa, a["id"])
        # soft-delete contact → trash
        d = sa.delete(f"{API}/contacts/{cid}", timeout=20)
        assert d.status_code == 200, d.text
        trash = sa.get(f"{API}/trash", params={"company_id": a["id"]}, timeout=20)
        assert trash.status_code == 200, trash.text
        items = trash.json().get("items") or []
        assert items, "çöp boş"
        tid = items[0].get("id") or items[0].get("_id")
        leaked = sb.get(f"{API}/trash/{tid}", timeout=15)
        assert leaked.status_code in (403, 404), leaked.text
        del_leak = sb.delete(f"{API}/trash/{tid}", timeout=15)
        assert del_leak.status_code in (403, 404), del_leak.text

    def test_cheque_get_company_guard(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "cheqa")
        b, b_email, b_pass = _create_tenant(admin, "cheqb")
        sa, _ = _login(a_email, a_pass)
        sb, _ = _login(b_email, b_pass)
        cid = _mk_contact(sa, a["id"])
        ch = sa.post(
            f"{API}/cheques",
            json={
                "company_id": a["id"],
                "direction": "received",
                "instrument": "cheque",
                "number": f"P0{uuid.uuid4().hex[:6]}",
                "amount": 100,
                "contact_id": cid,
                "issue_date": "2026-10-01",
                "due_date": "2026-11-01",
            },
            timeout=20,
        )
        assert ch.status_code == 200, ch.text
        chid = ch.json().get("id") or ch.json().get("_id")
        ok = sa.get(f"{API}/cheques/{chid}", timeout=15)
        assert ok.status_code == 200, ok.text
        leak = sb.get(f"{API}/cheques/{chid}", timeout=15)
        assert leak.status_code in (403, 404), leak.text

    def test_approve_invoice_company_guard(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "appr")
        b, b_email, b_pass = _create_tenant(admin, "apprb")
        sa, _ = _login(a_email, a_pass)
        sb, _ = _login(b_email, b_pass)
        cid = _mk_contact(sa, a["id"])
        inv_id, _ = _mk_invoice(sa, a["id"], cid)
        leak = sb.post(f"{API}/invoices/{inv_id}/approve", timeout=20)
        assert leak.status_code in (403, 404), leak.text
        ok = sa.post(f"{API}/invoices/{inv_id}/approve", timeout=20)
        assert ok.status_code == 200, ok.text
