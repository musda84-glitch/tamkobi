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

    def test_pay_installment_via_record_payment_core(self):
        """POST /installments/{id}/pay → _record_invoice_payment_core (Depends kırılmaz)."""
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "instpay")
        sa, _ = _login(a_email, a_pass)
        cid = _mk_contact(sa, a["id"])
        inv_id, _ = _mk_invoice(sa, a["id"], cid)
        plan = sa.post(
            f"{API}/invoices/{inv_id}/installments",
            json={"count": 2, "interval": "month", "start_date": "2026-10-01"},
            timeout=30,
        )
        assert plan.status_code == 200, plan.text
        rows = plan.json() if isinstance(plan.json(), list) else plan.json().get("installments") or []
        assert rows, plan.text
        inst_id = rows[0].get("id") or rows[0].get("_id")
        pay = sa.post(f"{API}/installments/{inst_id}/pay", json={"amount": 1}, timeout=30)
        assert pay.status_code == 200, pay.text
        assert pay.json().get("status") == "success"

    def test_delete_installments_cancels_promissory_core(self):
        """Taksit silince senet iptali _cancel_cheque_core üzerinden (kullanıcısız)."""
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "promc")
        sa, _ = _login(a_email, a_pass)
        cid = _mk_contact(sa, a["id"])
        inv_id, _ = _mk_invoice(sa, a["id"], cid)
        plan = sa.post(
            f"{API}/invoices/{inv_id}/installments",
            json={
                "count": 2,
                "interval": "month",
                "start_date": "2026-10-01",
                "create_promissory": True,
            },
            timeout=30,
        )
        assert plan.status_code == 200, plan.text
        body = plan.json()
        notes = body.get("promissory_notes") if isinstance(body, dict) else None
        assert notes, body
        chid = notes[0].get("id") or notes[0].get("_id")
        deleted = sa.delete(f"{API}/invoices/{inv_id}/installments", timeout=30)
        assert deleted.status_code == 200, deleted.text
        ch = sa.get(f"{API}/cheques/{chid}", timeout=15)
        assert ch.status_code == 200, ch.text
        assert ch.json().get("status") == "cancelled"

    def test_accept_match_rule_suggestion_core(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "mrule")
        sa, _ = _login(a_email, a_pass)
        cid = _mk_contact(sa, a["id"])
        r = sa.post(
            f"{API}/banking/match-rule-suggestions/accept",
            json={
                "company_id": a["id"],
                "pattern": f"p0rule{uuid.uuid4().hex[:6]}",
                "contact_id": cid,
                "apply_now": False,
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("rule") or r.json().get("status") == "success"

    def test_bulk_delete_orders_core(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "bdel")
        sa, _ = _login(a_email, a_pass)
        # Kalemsiz sipariş → taslak fatura yok → silinebilir
        o = sa.post(
            f"{API}/orders",
            json={
                "company_id": a["id"],
                "customer_name": "P0 Bulk",
                "shipping_address": "Adres",
                "city": "Istanbul",
                "total_amount": 0,
                "items": [],
                "channel": "manual",
            },
            timeout=30,
        )
        assert o.status_code == 200, o.text
        oid = o.json().get("id") or o.json().get("_id")
        r = sa.post(f"{API}/orders/bulk-delete", json={"ids": [oid]}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("deleted", 0) >= 1, r.text

    def test_installments_cross_tenant_404(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "insta")
        b, b_email, b_pass = _create_tenant(admin, "instb")
        sa, _ = _login(a_email, a_pass)
        sb, _ = _login(b_email, b_pass)
        cid = _mk_contact(sa, a["id"])
        inv_id, _ = _mk_invoice(sa, a["id"], cid)
        sa.post(
            f"{API}/invoices/{inv_id}/installments",
            json={"count": 2, "interval": "month", "start_date": "2026-10-01"},
            timeout=30,
        )
        for method, path in (
            ("get", f"{API}/invoices/{inv_id}/installments"),
            ("post", f"{API}/invoices/{inv_id}/installments"),
            ("delete", f"{API}/invoices/{inv_id}/installments"),
            ("get", f"{API}/contacts/{cid}/installments"),
            ("post", f"{API}/contacts/{cid}/installments"),
            ("delete", f"{API}/contacts/{cid}/installments"),
        ):
            if method == "get":
                r = sb.get(path, timeout=15)
            elif method == "post":
                r = sb.post(path, json={"count": 2, "total": 100, "interval": "month", "start_date": "2026-10-01"}, timeout=15)
            else:
                r = sb.delete(path, timeout=15)
            assert r.status_code in (403, 404), f"{method} {path}: {r.status_code} {r.text}"

    def test_create_project_survey_po_tax_resolve_company(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "rsc")
        b, b_email, b_pass = _create_tenant(admin, "rsd")
        sa, _ = _login(a_email, a_pass)
        sb, _ = _login(b_email, b_pass)
        cid = _mk_contact(sa, a["id"])

        # Başka şirketin company_id'si gövdede → 403
        for path, payload in (
            (f"{API}/projects", {"company_id": b["id"], "name": "P0 Proje"}),
            (f"{API}/surveys", {"company_id": b["id"], "contact_id": cid, "contact_name": "X"}),
            (
                f"{API}/purchase-orders",
                {
                    "company_id": b["id"],
                    "supplier_name": "Tedarik",
                    "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10}],
                },
            ),
            (
                f"{API}/tax-obligations/import",
                {
                    "company_id": b["id"],
                    "draft": {
                        "source_kind": "tahakkuk",
                        "period": "2026-10",
                        "title": "P0",
                        "obligations": [{"kind": "kdv", "title": "KDV", "amount": 10, "period": "2026-10"}],
                    },
                    "selected": [0],
                },
            ),
        ):
            r = sa.post(path, json=payload, timeout=30)
            assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"

        # Kendi company_id ile başarılı
        pr = sa.post(f"{API}/projects", json={"company_id": a["id"], "name": "P0 Proje OK"}, timeout=30)
        assert pr.status_code == 200, pr.text
        assert pr.json().get("company_id") == a["id"]

        sv = sa.post(
            f"{API}/surveys",
            json={"company_id": a["id"], "contact_id": cid, "contact_name": "C"},
            timeout=30,
        )
        assert sv.status_code == 200, sv.text
        assert sv.json().get("company_id") == a["id"]

        po = sa.post(
            f"{API}/purchase-orders",
            json={
                "company_id": a["id"],
                "supplier_name": "Tedarik OK",
                "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10}],
            },
            timeout=30,
        )
        assert po.status_code == 200, po.text
        assert po.json().get("company_id") == a["id"]

        tx = sa.post(
            f"{API}/tax-obligations/import",
            json={
                "company_id": a["id"],
                "draft": {
                    "source_kind": "tahakkuk",
                    "period": "2026-10",
                    "title": "P0 vergi",
                    "obligations": [
                        {"kind": "kdv", "title": "KDV", "amount": 100, "period": "2026-10", "due_date": "2026-10-26"}
                    ],
                },
                "selected": [0],
            },
            timeout=30,
        )
        assert tx.status_code == 200, tx.text
