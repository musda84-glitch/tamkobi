"""Text-only personal data ZIP (no live DB)."""
import io
import os
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import data_export as de


def test_sanitize_strips_secrets_and_data_uris():
    raw = {
        "_id": "u1",
        "email": "a@b.com",
        "password_hash": "SECRET",
        "smtp_password": "x",
        "token": "nope",
        "name": "Ali",
        "photo": "data:image/png;base64,AAAA",
        "logo_url": "/api/files/logo.png",
        "items": [{"name": "Kalem", "total": 10, "password": "x"}],
    }
    out = de.sanitize(raw)
    assert out["id"] == "u1"
    assert "password_hash" not in out
    assert "smtp_password" not in out
    assert "token" not in out
    assert out["name"] == "Ali"
    assert out["logo_url"] == "/api/files/logo.png"
    assert "photo" not in out
    assert out["items"][0]["name"] == "Kalem"
    assert "password" not in out["items"][0]


def test_build_zip_only_text_entries():
    blob = de.build_zip({"README.txt": "merhaba", "profil.json": "{\"a\":1}", "faturalar.csv": "id;no\n"})
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = set(zf.namelist())
    assert names == {"README.txt", "profil.json", "faturalar.csv"}
    try:
        de.build_zip({"scan.pdf": "not-allowed"})
        assert False, "pdf should be rejected"
    except ValueError:
        pass


def test_invoice_csv_rows():
    inv = {
        "_id": "inv1",
        "invoice_number": "SAT-1",
        "contact_name": "Acme",
        "grand_total": 120,
        "password_hash": "no",
        "items": [
            {"name": "Hizmet", "quantity": 1, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "total": 120},
        ],
    }
    h = de.invoice_header_row(inv)
    assert h["id"] == "inv1" and h["invoice_number"] == "SAT-1"
    assert "password_hash" not in h
    lines = de.invoice_line_rows(inv)
    assert len(lines) == 1 and lines[0]["name"] == "Hizmet"
    csv = de.csv_text([h], ["id", "invoice_number", "grand_total"])
    assert "SAT-1" in csv and csv.startswith("\ufeff")
