"""Platform mail server: SMTP servers, known from-addresses, Send As ACL."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["user"].get("is_super_admin") is True
    return s


class TestPlatformMail:
    def test_requires_auth(self):
        r = requests.get(f"{API}/system/mail", timeout=20)
        assert r.status_code == 401

    def test_non_admin_forbidden(self):
        s = _admin()
        email = f"co_{uuid.uuid4().hex[:8]}@tenant.test"
        r = s.post(
            f"{API}/system/companies",
            json={"name": "Mail ACL Co", "admin_email": email, "admin_password": "tenant1", "admin_name": "Tenant Admin", "plan_id": "plan_standard", "trial_days": 0},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        t = requests.Session()
        login = t.post(f"{API}/auth/login", json={"email": email, "password": "tenant1"}, timeout=20)
        assert login.status_code == 200, login.text
        r = t.get(f"{API}/system/mail", timeout=20)
        assert r.status_code == 403

    def test_server_mailbox_acl_lifecycle(self):
        s = _admin()
        suffix = uuid.uuid4().hex[:8]
        r = s.get(f"{API}/system/mail", timeout=20)
        assert r.status_code == 200, r.text
        prior_boxes = r.json().get("mailboxes") or []
        prior_ids = {b["id"] for b in prior_boxes}
        prior_defaults = [b["id"] for b in prior_boxes if b.get("is_default")]
        body = r.json()
        assert "servers" in body and "mailboxes" in body and "admins" in body
        assert any(p["id"] == "transactional" for p in body["purposes"])
        admin = next(u for u in body["admins"] if u["email"] == ADMIN_EMAIL)

        r = s.post(f"{API}/system/mail/servers", json={"name": "Test SMTP", "provider": "custom", "smtp_host": f"smtp.{suffix}.invalid", "smtp_port": 587, "smtp_user": f"smtp@{suffix}.invalid", "password": "secret-pass"}, timeout=20)
        assert r.status_code == 200, r.text
        srv = r.json()
        assert srv["smtp_host"] == f"smtp.{suffix}.invalid"
        assert srv["has_password"] is True
        assert "password_enc" not in srv and "password" not in srv
        sid = srv["id"]

        r = s.post(f"{API}/system/mail/mailboxes", json={"email": "not-an-email", "server_id": sid}, timeout=20)
        assert r.status_code == 400

        r = s.post(f"{API}/system/mail/mailboxes", json={"email": f"destek@{suffix}.com", "display_name": "Destek", "server_id": sid, "purposes": ["support", "transactional"], "allow_all_admins": False, "allowed_user_ids": [admin["id"]], "is_default": True}, timeout=20)
        assert r.status_code == 200, r.text
        box = r.json()
        assert box["email"] == f"destek@{suffix}.com"
        assert box["allow_all_admins"] is False
        assert admin["id"] in box["allowed_user_ids"]
        assert box["is_default"] is True
        bid = box["id"]

        r = s.post(f"{API}/system/mail/mailboxes", json={"email": f"destek@{suffix}.com", "server_id": sid}, timeout=20)
        assert r.status_code == 409

        r = s.post(f"{API}/system/mail/mailboxes", json={"email": f"info@{suffix}.com", "display_name": "Info", "server_id": sid, "purposes": ["general"], "allow_all_admins": True, "is_default": False}, timeout=20)
        assert r.status_code == 200, r.text
        info = r.json()

        ov = s.get(f"{API}/system/mail", timeout=20).json()
        dest = next(b for b in ov["mailboxes"] if b["id"] == bid)
        assert dest["server_name"] == "Test SMTP"
        assert ov["default_from"] == f"destek@{suffix}.com"
        assert any(u["email"] == ADMIN_EMAIL for u in dest["allowed_users"])
        info_row = next(b for b in ov["mailboxes"] if b["id"] == info["id"])
        assert info_row["allow_all_admins"] is True

        mine = s.get(f"{API}/system/mail/my-mailboxes", timeout=20)
        assert mine.status_code == 200, mine.text
        emails = [b["email"] for b in mine.json()["mailboxes"]]
        assert f"destek@{suffix}.com" in emails
        assert f"info@{suffix}.com" in emails

        r = s.delete(f"{API}/system/mail/servers/{sid}", timeout=20)
        assert r.status_code == 400

        st = s.get(f"{API}/system/settings", timeout=20)
        assert st.status_code == 200
        assert st.json().get("platform_mail_from") == f"destek@{suffix}.com"

        r = s.put(f"{API}/system/mail/mailboxes/{info['id']}", json={"allow_all_admins": False, "allowed_user_ids": []}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["allow_all_admins"] is False
        mine2 = s.get(f"{API}/system/mail/my-mailboxes", timeout=20).json()["mailboxes"]
        assert f"info@{suffix}.com" not in [b["email"] for b in mine2]

        assert s.delete(f"{API}/system/mail/mailboxes/{bid}", timeout=20).status_code == 200
        assert s.delete(f"{API}/system/mail/mailboxes/{info['id']}", timeout=20).status_code == 200
        assert s.delete(f"{API}/system/mail/servers/{sid}", timeout=20).status_code == 200
        gone = s.get(f"{API}/system/mail", timeout=20).json()
        assert not any(x["id"] == sid for x in gone["servers"])
        assert prior_ids <= {b["id"] for b in gone["mailboxes"]}
        for bid in prior_defaults:
            s.put(f"{API}/system/mail/mailboxes/{bid}", json={"is_default": True}, timeout=20)

    def test_second_mailbox_appends_single_default_duplicate_409(self):
        """İkinci gönderen kutusu birincinin yerini almaz; varsayılan tek kalır; tekrar 409."""
        s = _admin()
        before = s.get(f"{API}/system/mail", timeout=20)
        assert before.status_code == 200, before.text
        prior = before.json().get("mailboxes") or []
        prior_ids = {b["id"] for b in prior}
        prior_defaults = [b["id"] for b in prior if b.get("is_default")]
        suffix = uuid.uuid4().hex[:8]
        sid = None
        created = []
        try:
            r = s.post(
                f"{API}/system/mail/servers",
                json={"name": "Append SMTP", "provider": "custom", "smtp_host": f"smtp.append.{suffix}.invalid", "smtp_port": 587, "smtp_user": f"smtp@{suffix}.invalid", "password": "secret-pass"},
                timeout=20,
            )
            assert r.status_code == 200, r.text
            sid = r.json()["id"]

            first = s.post(
                f"{API}/system/mail/mailboxes",
                json={"email": f"bildirim@{suffix}.com", "display_name": "Bildirim", "server_id": sid, "purposes": ["transactional"], "is_default": True},
                timeout=20,
            )
            assert first.status_code == 200, first.text
            created.append(first.json()["id"])

            second = s.post(
                f"{API}/system/mail/mailboxes",
                json={"email": f"destek@{suffix}.com", "display_name": "Destek", "server_id": sid, "purposes": ["support"], "is_default": True, "_id": created[0], "id": created[0]},
                timeout=20,
            )
            assert second.status_code == 200, second.text
            assert second.json()["id"] != created[0]
            created.append(second.json()["id"])

            ov = s.get(f"{API}/system/mail", timeout=20).json()
            by_email = {b["email"]: b for b in ov["mailboxes"]}
            assert f"bildirim@{suffix}.com" in by_email
            assert f"destek@{suffix}.com" in by_email
            assert by_email[f"bildirim@{suffix}.com"]["id"] == created[0]
            assert by_email[f"bildirim@{suffix}.com"]["is_default"] is False
            assert by_email[f"destek@{suffix}.com"]["is_default"] is True
            assert sum(1 for b in ov["mailboxes"] if b.get("is_default")) == 1
            assert prior_ids <= {b["id"] for b in ov["mailboxes"]}

            dup = s.post(
                f"{API}/system/mail/mailboxes",
                json={"email": f"Destek@{suffix}.com", "server_id": sid, "is_default": True},
                timeout=20,
            )
            assert dup.status_code == 409, dup.text
            after_dup = s.get(f"{API}/system/mail", timeout=20).json()["mailboxes"]
            assert {b["email"] for b in after_dup} >= {f"bildirim@{suffix}.com", f"destek@{suffix}.com"}
            assert prior_ids <= {b["id"] for b in after_dup}
            assert sum(1 for b in after_dup if b.get("is_default")) == 1

            missing = s.post(
                f"{API}/system/mail/mailboxes",
                json={"email": f"fatura@{suffix}.com", "server_id": "pms_deleted_not_real", "is_default": True},
                timeout=20,
            )
            assert missing.status_code == 404, missing.text
            after_miss = s.get(f"{API}/system/mail", timeout=20).json()["mailboxes"]
            assert {b["id"]: b.get("is_default") for b in after_miss} == {b["id"]: b.get("is_default") for b in after_dup}
        finally:
            for bid in reversed(created):
                s.delete(f"{API}/system/mail/mailboxes/{bid}", timeout=20)
            if sid:
                s.delete(f"{API}/system/mail/servers/{sid}", timeout=20)
            left = s.get(f"{API}/system/mail", timeout=20).json()["mailboxes"]
            assert prior_ids <= {b["id"] for b in left}
            assert not any(b["email"].endswith(f"@{suffix}.com") for b in left)
            for bid in prior_defaults:
                s.put(f"{API}/system/mail/mailboxes/{bid}", json={"is_default": True}, timeout=20)
