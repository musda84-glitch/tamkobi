"""Mali müşavir e-belge yedekleme: 62 gün sınırı, XML/PDF ZIP, hatırlatma."""
import io
import os
import sys
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from fastapi import HTTPException

for _p in ("/app/backend", "/workspace/backend"):
    if _p not in sys.path:
        sys.path.insert(0, _p)

frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
backend_env = dotenv_values("/app/backend/.env") or dotenv_values("/workspace/backend/.env") or {}
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL") or backend_env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
API = BASE_URL + "/api"
COMPANY = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _mk(client, **extra):
    payload = {
        "company_id": COMPANY,
        "invoice_type": "sales",
        "e_type": "e_archive",
        "invoice_number": f"BK-{uuid.uuid4().hex[:10].upper()}",
        "contact_id": "cnt_01",
        "contact_name": "TEST Backup Cari",
        "contact_tax_id": "1234567890",
        "status": "draft",
        "issue_date": "2026-09-05",
        "items": [{"name": "TEST Backup Kalem", "quantity": 1, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "total": 100}],
    }
    payload.update(extra)
    r = client.post(f"{API}/invoices", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


class TestParseRange:
    def test_max_62_days(self):
        import edoc_backup
        d0, d1, days = edoc_backup.parse_range("2026-08-01", "2026-10-01")
        assert days == 62
        assert d0 == "2026-08-01" and d1 == "2026-10-01"
        with pytest.raises(HTTPException) as ei:
            edoc_backup.parse_range("2026-08-01", "2026-10-02")
        assert ei.value.status_code == 400
        assert "62" in ei.value.detail

    def test_inverted_and_bad(self):
        import edoc_backup
        with pytest.raises(HTTPException) as ei:
            edoc_backup.parse_range("2026-09-10", "2026-09-01")
        assert ei.value.status_code == 400
        with pytest.raises(HTTPException):
            edoc_backup.parse_range("nope", "2026-09-01")

    def test_invoice_query_skips_cancelled(self):
        import edoc_backup
        q = edoc_backup.invoice_query("comp_1", "2026-10-01", "2026-10-31")
        assert q["company_id"] == "comp_1"
        assert "e_invoice" in q["e_type"]["$in"] and "e_archive" in q["e_type"]["$in"] and "e_export" in q["e_type"]["$in"]
        assert "dispatch" in q["invoice_type"]["$nin"]
        assert "proforma" in q["invoice_type"]["$nin"]
        assert "expense_slip" in q["invoice_type"]["$nin"]
        assert "draft" in q["status"]["$nin"]
        assert "cancelled" in q["status"]["$nin"]
        assert "canceled" in q["status"]["$nin"]
        assert "void" in q["status"]["$nin"]
        assert {"einvoice_state": "sent"} in q["$or"]
        assert {"source": "edoc_inbox"} in q["$or"]
        assert {"direction": "incoming"} in q["$or"]

    def test_reminder_due(self):
        import edoc_backup
        now = datetime(2026, 9, 8, tzinfo=timezone.utc)
        assert edoc_backup.reminder_due(None, now) is True
        fresh = {"created_at": "2026-09-01T10:00:00"}
        assert edoc_backup.reminder_due(fresh, now) is False
        stale = {"created_at": "2026-07-01T10:00:00"}
        assert edoc_backup.reminder_due(stale, now) is True


class TestEdocBackupApi:
    def test_range_rejected(self, client):
        r = client.get(f"{API}/accountant/edocs", params={"company_id": COMPANY, "date_from": "2026-08-01", "date_to": "2026-10-02"}, timeout=20)
        assert r.status_code == 400
        r2 = client.get(f"{API}/accountant/edocs/export", params={"company_id": COMPANY, "date_from": "2026-09-10", "date_to": "2026-09-01"}, timeout=20)
        assert r2.status_code == 400

    def test_preview_and_zip(self, client):
        draft = _mk(client, e_type="e_archive", status="draft", einvoice_state="draft", issue_date="2020-01-15")
        paper = _mk(client, e_type="paper", status="draft", issue_date="2020-01-15")
        proforma = _mk(client, invoice_type="proforma", e_type="e_archive", status="draft", issue_date="2020-01-15")
        try:
            params = {"company_id": COMPANY, "date_from": "2020-01-15", "date_to": "2020-01-15"}
            prev = client.get(f"{API}/accountant/edocs", params=params, timeout=20)
            assert prev.status_code == 200, prev.text
            body = prev.json()
            assert body["days"] == 1
            assert body["max_days"] == 62
            assert body["xml_count"] == body["invoice_count"]
            assert body["pdf_count"] == body["invoice_count"]
            assert body["integrator_count"] + body["local_count"] == body["invoice_count"]
            z = client.get(f"{API}/accountant/edocs/export", params=params, timeout=60)
            assert z.status_code == 200, z.text[:400]
            assert "zip" in (z.headers.get("content-type") or "")
            assert z.content[:2] == b"PK"
            assert z.headers.get("X-Xml-Count") is not None
            assert z.headers.get("X-Pdf-Count") is not None
            assert z.headers.get("X-Integrator-Count") is not None
            assert z.headers.get("X-Local-Count") is not None
            zf = zipfile.ZipFile(io.BytesIO(z.content))
            names = zf.namelist()
            assert "MANIFEST.txt" in names
            manifest = zf.read("MANIFEST.txt").decode("utf-8")
            assert "integrator=" in manifest and "local=" in manifest
            blob_names = [n for n in names if n != "MANIFEST.txt"]
            assert all(n.startswith(("giden/", "gelen/")) for n in blob_names)
            joined = "\n".join(names)
            for doc in (draft, paper, proforma):
                assert doc["invoice_number"] not in joined
            if int(z.headers.get("X-Invoice-Count") or "0"):
                last = client.get(f"{API}/accountant/edocs/last-backup", params={"company_id": COMPANY}, timeout=20)
                assert last.status_code == 200
                lb = last.json()["last_backup"]
                assert lb and "integrator_count" in lb and "local_count" in lb
                assert last.json()["reminder_due"] is False
        finally:
            client.delete(f"{API}/invoices/{draft['id']}", timeout=20)
            client.delete(f"{API}/invoices/{paper['id']}", timeout=20)
            client.delete(f"{API}/invoices/{proforma['id']}", timeout=20)

    def test_reminders_run(self, client):
        r = client.post(f"{API}/accountant/edocs/reminders/run", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "count" in d and "sent" in d
        assert isinstance(d["sent"], list)
