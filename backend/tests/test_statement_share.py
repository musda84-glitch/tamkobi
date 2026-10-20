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


def test_statement_rows_cheques_follow_detail_and_skip_linked():
    rows = ss.statement_rows(
        [{"invoice_number": "SF-1", "invoice_type": "sales", "grand_total": 1000, "issue_date": "2026-10-01", "status": "issued"}],
        [{"type": "inflow", "amount": 300, "date": "2026-10-02", "account_name": "Çek Portföyü", "cheque_id": "ch1"}],
        [
            {"_id": "ch1", "instrument": "cheque", "direction": "received", "amount": 300, "due_date": "2026-11-01", "serial_no": "SN1"},
            {"_id": "ch2", "instrument": "cheque", "direction": "received", "amount": 50, "due_date": "2026-10-03", "serial_no": "SN2", "bank_name": "Ziraat"},
            {"_id": "ch3", "instrument": "promissory", "direction": "issued", "amount": 25, "due_date": "2026-10-04", "serial_no": "S1"},
        ],
    )
    assert [r["doc"] for r in rows] == [
        "SF-1 • Satış Faturası",
        "Tahsilat • Çek Portföyü",
        "Alınan Çek • SN2 • Ziraat",
        "Verilen Senet • S1",
    ]
    assert rows[1]["credit"] == 300 and rows[1]["balance"] == 700
    assert rows[2]["credit"] == 50 and rows[2]["kind"] == "cheque"
    assert rows[3]["debit"] == 25 and rows[3]["balance"] == 675
    assert all(r["doc"] != "Alınan Çek • SN1" for r in rows)


def test_statement_rows_gib_fields_do_not_change_balance_or_leak_ettn():
    base = {
        "invoice_number": "SF-1",
        "invoice_type": "sales",
        "grand_total": 80,
        "issue_date": "2026-05-01",
        "status": "issued",
    }
    plain = ss.statement_rows([dict(base)], [{"type": "inflow", "amount": 30, "date": "2026-05-02", "account_name": "Kasa"}])
    cases = [
        ("sent", "e_invoice", "sent"),
        ("accepted", "e_invoice", "sent"),
        ("received", "e_archive", "sent"),
        ("draft", "e_archive", "none"),
        ("", "e_invoice", "none"),
        ("queued", "e_invoice", "pending"),
        ("pending", "e_invoice", "pending"),
        ("error", "e_invoice", "error"),
        ("paper", "paper", "paper"),
        ("sent", "paper", "paper"),
    ]
    for state, e_type, gib in cases:
        inv = dict(base, einvoice_state=state, e_type=e_type, gib_uuid="ettn-secret", gib_status="Gizli durum")
        rows = ss.statement_rows([inv], [{"type": "inflow", "amount": 30, "date": "2026-05-02", "account_name": "Kasa"}])
        assert rows[0]["gib"] == gib
        assert rows[0]["e_type"] == e_type
        assert rows[0]["balance"] == plain[0]["balance"] == 80
        assert rows[1]["balance"] == plain[1]["balance"] == 50
        assert "gib" not in rows[1] and "e_type" not in rows[1]
        assert "gib_uuid" not in rows[0] and "gib_status" not in rows[0]
        blob = str(rows)
        assert "ettn-secret" not in blob and "Gizli durum" not in blob
        view = ss.public_statement_view({"name": "Ada"}, {"name": "TamKobi"}, rows)
        invoice = view["rows"][0]
        payment = view["rows"][1]
        assert set(invoice) == {"date", "doc", "debit", "credit", "balance", "kind", "gib", "e_type"}
        assert invoice["gib"] == gib and invoice["balance"] == 80
        assert set(payment) == {"date", "doc", "debit", "credit", "balance", "kind"}
        assert "ettn-secret" not in str(view) and "Gizli durum" not in str(view)
    missing = ss.statement_rows([dict(base)], [])
    assert missing[0]["gib"] == "none" and missing[0]["e_type"] == ""
    assert missing[0]["balance"] == 80


def test_public_statement_row_drops_foreign_ids():
    view = ss.public_statement_view(
        {"_id": "cnt", "company_id": "co", "name": "Hatice"},
        {"_id": "co", "name": "TamKobi"},
        [{
            "date": "2026-01-02",
            "doc": "SF • Satış Faturası",
            "debit": 10,
            "credit": 0,
            "balance": 10,
            "kind": "invoice",
            "gib": "sent",
            "e_type": "e_invoice",
            "gib_uuid": "ettn-secret",
            "gib_status": "İletildi",
            "company_id": "co-other",
            "_id": "inv-secret",
        }],
    )
    row = view["rows"][0]
    assert row["gib"] == "sent" and row["e_type"] == "e_invoice" and row["balance"] == 10
    blob = str(view)
    assert "ettn-secret" not in blob and "inv-secret" not in blob and "co-other" not in blob
    assert "cnt" not in blob


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


def test_stage_photos_drop_error_pages():
    groups = pp.group_stage_photos(
        [{"url": "<html><h1>413 Request Entity Too Large</h1></html>", "stage": "planning"}],
        ["<!DOCTYPE html><title>413</title>"],
        [{"key": "planning", "label": "Planlama"}],
    )
    assert groups == []
    assert pp.is_photo_url("/api/files/tamkobi/project/a.jpg")
    assert not pp.is_photo_url("<html>413 Request Entity Too Large</html>")


def test_sanitize_stage_photos_drops_foreign_urls():
    clean = pp.sanitize_stage_photos([
        {"url": "/api/files/ok.jpg", "stage": "active!", "stage_label": "Devam"},
        {"url": "https://evil.example/x.jpg", "stage": "active"},
        "nope",
    ])
    assert clean[0]["url"] == "/api/files/ok.jpg"
    assert clean[0]["stage"] == "active"
    assert clean[0]["visibility"] == "show"
