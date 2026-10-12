"""Gerçek HTTP: tokensız 401, public 200, kiracı IDOR 403/404, core akışlar.

Çalışan API + SUPER_ADMIN gerekir. API yoksa fail (sessiz skip yok).
"""
from __future__ import annotations

import os
import uuid
from urllib.parse import urlparse

import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE + "/api"


def _open_signed_share(url: str, timeout: int = 30):
    """Share-link kanonik host döner; testi yerel API'ye yönlendir."""
    u = urlparse(url)
    assert u.path and "t=" in (u.query or "")
    host = (u.hostname or "").lower()
    assert host not in ("127.0.0.1", "localhost", "0.0.0.0"), url
    return requests.get(f"{BASE}{u.path}?{u.query}", timeout=timeout)


def _api_up() -> bool:
    try:
        r = requests.get(f"{API}/version", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def _require_api():
    if not _api_up():
        pytest.fail(f"API ayakta değil: {API}/version (REACT_APP_BACKEND_URL={BASE})")


def _clear_sa_2fa_for_login(email: str):
    """Paralel 2FA HTTP testleri SA hesabında TOTP bırakırsa şifre girişini geri aç."""
    import asyncio
    from datetime import datetime, timezone
    from pathlib import Path
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    except Exception:
        pass
    try:
        from setup_state import apply_saved_secrets
        apply_saved_secrets()
    except Exception:
        pass
    from mysql_store import MySQLClient, mysql_settings_from_env

    async def _run():
        client = MySQLClient()
        db = client[str(mysql_settings_from_env().get("db") or "tamkobi").strip()]
        try:
            await db._ensure()
            u = await db.users.find_one({"email": email.strip().lower(), "is_super_admin": True})
            if not u:
                return
            now = datetime.now(timezone.utc).isoformat()
            await db.users.update_one(
                {"_id": u["_id"]},
                {
                    "$set": {
                        "totp_enabled": False,
                        "totp_secret": "",
                        "totp_recovery_hashes": [],
                        "totp_last_counter": None,
                        "pending_2fa_jti": "",
                        "pending_2fa_attempts": 0,
                        "totp_reset_at": now,
                    },
                    "$unset": {"totp_setup_started_at": "", "totp_enabled_at": ""},
                },
            )
            await db.login_attempts.delete_one({"identifier": f"2fa:{u['_id']}"})
        finally:
            try:
                await client.close_async()
            except Exception:
                client.close()

    asyncio.run(_run())


def _super_session():
    import fcntl
    from pathlib import Path

    _require_api()
    # 2FA HTTP testleri aynı SA hesabını mutate eder — exclusive lock ile çakışma yok
    lock_path = Path("/tmp/tamkobi-sa-2fa-http.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_fh = open(lock_path, "a+", encoding="utf-8")
    fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
    try:
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
            if r.status_code != 200:
                continue
            body = r.json()
            if body.get("requires_2fa"):
                _clear_sa_2fa_for_login(em)
                s = requests.Session()
                r = s.post(f"{API}/auth/login", json={"email": em, "password": pw}, timeout=20)
                if r.status_code != 200:
                    continue
                body = r.json()
            if body.get("user", {}).get("is_super_admin") and not body.get("requires_2fa"):
                return s
        pytest.fail("Süper admin girişi yok (SUPER_ADMIN_EMAIL/PASSWORD veya seed admin)")
    finally:
        try:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass
        lock_fh.close()


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
        opened = _open_signed_share(url)
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

    def test_idor_employee_survey_quote_order(self):
        """B, A'nın personel/keşif/teklif/sipariş id'siyle PUT/DELETE/convert yapamaz (404)."""
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "idora")
        b, b_email, b_pass = _create_tenant(admin, "idorb")
        sa, _ = _login(a_email, a_pass)
        sb, _ = _login(b_email, b_pass)
        cid = _mk_contact(sa, a["id"])

        # --- Personel ---
        emp = sa.post(
            f"{API}/personnel/employees",
            json={
                "company_id": a["id"],
                "full_name": "P0 Personel",
                "tc_kimlik": "11111111110",
                "department": "Üretim",
                "position": "Operatör",
                "phone": "5550000000",
                "email": f"emp_{uuid.uuid4().hex[:6]}@p0.test",
                "salary": 1000,
                "start_date": "2026-01-01",
            },
            timeout=30,
        )
        assert emp.status_code == 200, emp.text
        eid = emp.json().get("id") or emp.json().get("_id")
        assert sb.put(f"{API}/personnel/employees/{eid}", json={"full_name": "HACK"}, timeout=15).status_code == 404
        assert sb.delete(f"{API}/personnel/employees/{eid}", timeout=15).status_code == 404
        ok = sa.put(f"{API}/personnel/employees/{eid}", json={"full_name": "P0 Personel OK"}, timeout=15)
        assert ok.status_code == 200, ok.text
        assert (ok.json().get("full_name") or "") == "P0 Personel OK"
        card = sa.get(f"{API}/personnel/employees/{eid}/card", timeout=15)
        assert card.status_code == 200, card.text

        # --- Keşif ---
        sv = sa.post(
            f"{API}/surveys",
            json={"company_id": a["id"], "contact_id": cid, "contact_name": "C", "address": "Adr"},
            timeout=30,
        )
        assert sv.status_code == 200, sv.text
        sid = sv.json().get("id") or sv.json().get("_id")
        assert sb.put(f"{API}/surveys/{sid}", json={"notes": "hack"}, timeout=15).status_code == 404
        assert sb.delete(f"{API}/surveys/{sid}", timeout=15).status_code == 404
        ok_sv = sa.put(f"{API}/surveys/{sid}", json={"notes": "ok"}, timeout=15)
        assert ok_sv.status_code == 200, ok_sv.text

        # --- Teklif → fatura (B A adına fatura açamaz) ---
        admin.post(f"{API}/system/companies/{a['id']}/modules/quotes", json={"enabled": True}, timeout=20)
        q = sa.post(
            f"{API}/quotes",
            json={
                "company_id": a["id"],
                "contact_id": cid,
                "contact_name": "Q",
                "title": "P0 IDOR teklif",
                "items": [{"name": "Hizmet", "quantity": 1, "unit_price": 50, "vat_rate": 20, "unit": "Adet"}],
            },
            timeout=30,
        )
        assert q.status_code == 200, q.text
        qid = q.json().get("id") or q.json().get("_id")
        before_inv = sa.get(f"{API}/invoices", params={"company_id": a["id"]}, timeout=20)
        before_n = len(before_inv.json() if isinstance(before_inv.json(), list) else before_inv.json().get("items") or [])
        assert sb.post(f"{API}/quotes/{qid}/convert-to-invoice", json={}, timeout=30).status_code == 404
        after_inv = sa.get(f"{API}/invoices", params={"company_id": a["id"]}, timeout=20)
        after_n = len(after_inv.json() if isinstance(after_inv.json(), list) else after_inv.json().get("items") or [])
        assert after_n == before_n, "B'nin convert denemesi A'da fatura oluşturmamalı"
        ok_q = sa.post(f"{API}/quotes/{qid}/convert-to-invoice", json={}, timeout=30)
        assert ok_q.status_code == 200, ok_q.text

        # --- Sipariş status (B A'nın taslak faturasını silemez) ---
        o = sa.post(
            f"{API}/orders",
            json={
                "company_id": a["id"],
                "customer_name": "P0 IDOR Sip",
                "shipping_address": "Adr",
                "city": "Istanbul",
                "total_amount": 10,
                "items": [{"product_name": "X", "quantity": 1, "unit_price": 10}],
                "channel": "manual",
                "contact_id": cid,
            },
            timeout=30,
        )
        assert o.status_code == 200, o.text
        oid = o.json().get("id") or o.json().get("_id")
        inv_id = o.json().get("invoice_id")
        leak = sb.put(f"{API}/orders/{oid}/status", json={"status": "pending"}, timeout=20)
        assert leak.status_code == 404, leak.text
        if inv_id:
            still = sa.get(f"{API}/invoices/{inv_id}", timeout=15)
            assert still.status_code == 200, still.text
        ok_o = sa.put(f"{API}/orders/{oid}/status", json={"status": "approved"}, timeout=20)
        assert ok_o.status_code == 200, ok_o.text

    def test_idor_product_and_regression_flows(self):
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "idorp")
        b, b_email, b_pass = _create_tenant(admin, "idorq")
        sa, _ = _login(a_email, a_pass)
        sb, _ = _login(b_email, b_pass)
        prod = sa.post(
            f"{API}/products",
            json={
                "company_id": a["id"],
                "name": f"P0 Ürün {uuid.uuid4().hex[:6]}",
                "sku": f"SKU{uuid.uuid4().hex[:6]}",
                "unit": "Adet",
                "sale_price": 10,
                "purchase_price": 5,
                "vat_rate": 20,
            },
            timeout=30,
        )
        assert prod.status_code == 200, prod.text
        pid = prod.json().get("id") or prod.json().get("_id")
        assert sb.get(f"{API}/products/{pid}", timeout=15).status_code == 404
        assert sb.put(f"{API}/products/{pid}", json={"name": "HACK"}, timeout=15).status_code == 404
        assert sb.delete(f"{API}/products/{pid}", timeout=15).status_code == 404
        ok = sa.get(f"{API}/products/{pid}", timeout=15)
        assert ok.status_code == 200, ok.text
        assert (sa.get(f"{API}/products/{pid}", timeout=15).json().get("name") or "").startswith("P0 Ürün")

        # Edocs / üretim path-id: B A'nın id'siyle okuyamaz
        fake = "missing_" + uuid.uuid4().hex[:12]
        for path in (
            f"/edocs/incoming/{fake}",
            f"/production/orders/{fake}",
            f"/work-orders/{fake}",
            f"/recipes/{fake}",
        ):
            assert sb.get(f"{API}{path}", timeout=15).status_code in (404, 405)

        # Regresyon: fatura kopyala + toplu sipariş silme + imzalı PDF
        cid = _mk_contact(sa, a["id"])
        inv_id, _ = _mk_invoice(sa, a["id"], cid)
        assert sb.get(f"{API}/invoices/{inv_id}", timeout=15).status_code == 404
        cp = sa.post(f"{API}/invoices/{inv_id}/copy", json={"mode": "same_contact"}, timeout=30)
        assert cp.status_code == 200, cp.text
        share = sa.get(f"{API}/invoices/{inv_id}/share-link", params={"kind": "pdf"}, timeout=15)
        assert share.status_code == 200, share.text
        assert "t=" in share.json().get("url", "")
        o = sa.post(
            f"{API}/orders",
            json={
                "company_id": a["id"],
                "customer_name": "Bulk",
                "shipping_address": "A",
                "city": "Istanbul",
                "total_amount": 0,
                "items": [],
                "channel": "manual",
            },
            timeout=30,
        )
        assert o.status_code == 200, o.text
        oid = o.json().get("id") or o.json().get("_id")
        # B'nin bulk-delete'i A'nın siparişini silmemeli
        bd_b = sb.post(f"{API}/orders/bulk-delete", json={"ids": [oid]}, timeout=30)
        assert bd_b.status_code == 200, bd_b.text
        assert (bd_b.json().get("deleted") or 0) == 0
        still_o = sa.get(f"{API}/orders/{oid}", timeout=15)
        assert still_o.status_code == 200, still_o.text
        bd = sa.post(f"{API}/orders/bulk-delete", json={"ids": [oid]}, timeout=30)
        assert bd.status_code == 200, bd.text
        assert bd.json().get("deleted", 0) >= 1

    def test_settle_employee_salary_and_bonus_core(self):
        """Depends regresyonu: settle → pay_payroll/update_bonus core ile 200."""
        admin = _super_session()
        a, a_email, a_pass = _create_tenant(admin, "settle")
        sa, _ = _login(a_email, a_pass)
        bank = sa.post(
            f"{API}/banking/accounts",
            json={
                "company_id": a["id"],
                "bank_name": "P0 Bank",
                "account_name": "P0 Maaş Hesabı",
                "type": "bank",
                "currency": "TRY",
                "current_balance": 50000,
            },
            timeout=20,
        )
        assert bank.status_code == 200, bank.text
        aid = bank.json().get("id") or bank.json().get("_id")
        emp = sa.post(
            f"{API}/personnel/employees",
            json={
                "company_id": a["id"],
                "full_name": "P0 Settle Personel",
                "tc_kimlik": "22222222220",
                "department": "Muhasebe",
                "position": "Uzman",
                "phone": "5551112233",
                "email": f"settle_{uuid.uuid4().hex[:6]}@p0.test",
                "salary": 12000,
                "start_date": "2026-01-01",
            },
            timeout=30,
        )
        assert emp.status_code == 200, emp.text
        eid = emp.json().get("id") or emp.json().get("_id")
        settle = sa.post(
            f"{API}/personnel/employees/{eid}/settle",
            json={"mode": "split", "kinds": ["salary"], "account_id": aid, "date": "2026-10-01"},
            timeout=40,
        )
        assert settle.status_code == 200, settle.text
        assert settle.json().get("status") == "success", settle.text
        assert "salary" in (settle.json().get("paid") or []), settle.json()

        bonus = sa.post(
            f"{API}/personnel/bonuses",
            json={
                "employee_id": eid,
                "type": "bonus",
                "amount": 250,
                "period": "2026-10",
                "note": "P0 prim",
            },
            timeout=20,
        )
        assert bonus.status_code == 200, bonus.text
        bid = bonus.json().get("id") or bonus.json().get("_id")
        settle_b = sa.post(
            f"{API}/personnel/employees/{eid}/settle",
            json={"mode": "split", "kinds": ["bonus"], "account_id": aid, "date": "2026-10-05"},
            timeout=40,
        )
        assert settle_b.status_code == 200, settle_b.text
        assert settle_b.json().get("status") == "success", settle_b.text
        assert "bonus" in (settle_b.json().get("paid") or []), settle_b.json()
        paid_bonus = sa.get(f"{API}/personnel/bonuses", params={"company_id": a["id"]}, timeout=20)
        assert paid_bonus.status_code == 200, paid_bonus.text
        rows = paid_bonus.json() if isinstance(paid_bonus.json(), list) else paid_bonus.json().get("items") or []
        match = next((r for r in rows if (r.get("id") or r.get("_id")) == bid), None)
        assert match is not None, paid_bonus.text
        assert match.get("status") == "paid", match

