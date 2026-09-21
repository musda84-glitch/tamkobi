"""Ekstre paylaşımı ve proje aşama fotoğrafları."""
import statement_share as ss
import project_photos as pp


def test_statement_rows_debit_credit_and_skip_noise():
    rows = ss.statement_rows(
        [
            {"invoice_number": "F-1", "invoice_type": "sales", "grand_total": 100, "issue_date": "2026-01-02", "status": "issued"},
            {"invoice_number": "F-X", "invoice_type": "sales", "grand_total": 9, "issue_date": "2026-01-01", "status": "cancelled"},
            {"invoice_number": "A-1", "invoice_type": "purchase", "grand_total": 40, "issue_date": "2026-01-03", "status": "issued"},
        ],
        [
            {"type": "inflow", "amount": 30, "date": "2026-01-04", "account_name": "Kasa", "description": "Nakit"},
            {"type": "transfer", "amount": 999, "date": "2026-01-05", "account_name": "Virman"},
        ],
    )
    assert [r["doc"] for r in rows] == [
        "F-1 • Satış Faturası",
        "A-1 • Alış Faturası",
        "Tahsilat • Kasa • Nakit",
    ]
    assert rows[0]["debit"] == 100 and rows[0]["balance"] == 100
    assert rows[1]["credit"] == 40 and rows[1]["balance"] == 60
    assert rows[2]["credit"] == 30 and rows[2]["balance"] == 30


def test_public_statement_hides_internal_ids():
    view = ss.public_statement_view(
        {"_id": "cnt", "company_id": "co", "name": "Hatice", "balance": 10, "tax_number_or_id": "111"},
        {"_id": "co", "name": "TamKobi", "phone": "0212"},
        [],
    )
    blob = str(view)
    assert "cnt" not in blob
    assert "company_id" not in view and "company_id" not in view["company"]
    assert view["contact"]["name"] == "Hatice"
    assert view["balance"] == 10
    assert view["rows"] == []


def test_statement_pdf_is_a_pdf():
    view = ss.public_statement_view(
        {"name": "Mustafa Bal", "tax_number_or_id": "11111111111"},
        {"name": "Aa Planlama", "city": "İstanbul"},
        ss.statement_rows(
            [{"invoice_number": "SF-1", "invoice_type": "sales", "grand_total": 1500.5, "issue_date": "2026-09-21", "status": "issued"}],
            [],
        ),
    )
    pdf = ss.statement_pdf_bytes(view)
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 800
    assert ss.pdf_filename("Mustafa Bal") == "ekstre-Mustafa-Bal.pdf"


def test_stage_photos_group_by_stage_and_keep_loose_images():
    groups = pp.group_stage_photos(
        [
            {"url": "/api/files/a.jpg", "stage": "active", "stage_label": "Devam Ediyor"},
            {"url": "/api/files/b.jpg", "stage": "planning"},
        ],
        ["/api/files/a.jpg", "/api/files/b.jpg", "/api/files/eski.jpg"],
        [
            {"key": "planning", "label": "Planlama"},
            {"key": "active", "label": "Uygulama"},
            {"key": "completed", "label": "Tamamlandı"},
        ],
    )
    assert [g["stage"] for g in groups] == ["planning", "active", "other"]
    assert groups[0]["label"] == "Planlama"
    assert groups[1]["label"] == "Uygulama"
    assert groups[1]["images"] == ["/api/files/a.jpg"]
    assert groups[2]["images"] == ["/api/files/eski.jpg"]
    assert groups[2]["label"] == "Keşif fotoğrafı"


def test_sanitize_stage_photos_drops_foreign_urls():
    clean = pp.sanitize_stage_photos([
        {"url": "/api/files/ok.jpg", "stage": "active!", "stage_label": "Devam"},
        {"url": "https://evil.example/x.jpg", "stage": "active"},
        "nope",
    ])
    assert clean == [{
        "url": "/api/files/ok.jpg",
        "stage": "active",
        "stage_label": "Devam",
        "created_at": "",
    }]
