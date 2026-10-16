"""Bildirim e-posta şablonu: sipariş HTML'i birebir, diğer olaylar aynı gönderim yolu."""
from __future__ import annotations

import asyncio
from contextlib import ExitStack
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

import event_notify
import mail_service
import notify
import notify_email_layout
import public_url
from test_event_notify import _db, _iso, _mail_patch, _ok_send

FIXTURES = Path(__file__).parent / "fixtures"
APP = "https://app.tamkobi.com"


def _snapshot_inputs():
    products = {
        "p1": {
            "_id": "p1", "company_id": "c1", "name": "Kalem", "sku": "KLM",
            "stock_quantity": 2,
            "thumbnail_url": "/api/files/c1/kalem.webp",
            "variants": [{
                "variant_id": "v1", "sku": "KLM-K", "name": "Kırmızı", "stock": 1,
                "image_url": "/api/files/c1/kirmizi.webp",
            }],
        },
    }
    items = []
    for i in range(16):
        items.append({
            "product_id": "p1",
            "product_name": f"Kalem {i}",
            "variant_id": "v1" if i == 0 else "",
            "sku": "KLM-K" if i == 0 else f"SKU-{i}",
            "quantity": 3,
            "unit_price": 10,
            "total": 30,
            "image_url": "/api/files/c1/kalem.webp" if i == 1 else "",
        })
    orders = [
        {
            "_id": "o1",
            "order_number": "B2B-100",
            "channel": "b2b",
            "customer_name": "Bayi <script>x</script>",
            "order_status": "pending",
            "currency": "TRY",
            "order_date": "2026-10-15T12:00:00+00:00",
            "notes": "Kapıda bırak",
            "subtotal": 480,
            "vat_total": 96,
            "grand_total": 576,
            "items": items,
        },
        {
            "_id": "o2",
            "order_number": "POS-2",
            "channel": "pos",
            "customer_name": "Kasa",
            "order_status": "approved",
            "currency": "USD",
            "fx_rate": 40.5,
            "grand_total": 10,
            "local_total": 405,
            "order_date": "2026-10-15T12:30:00+00:00",
            "subtotal": 10,
            "vat_total": 0,
            "items": [{"product_name": "Dolarlı", "quantity": 1, "unit_price": 10, "total": 10}],
        },
    ]
    links = {
        "o1": "https://app.tamkobi.com/orders?open=o1",
        "o2": "https://app.tamkobi.com/orders?open=o2",
    }
    return orders, links, products


def test_order_batch_html_matches_prerefactor_fixture():
    orders, links, products = _snapshot_inputs()
    html_logo = event_notify._order_batch_html(
        "Demo A.Ş.", orders, links, APP, products,
        logo_url="/api/files/c1/logo.png",
        settings_link="https://app.tamkobi.com/settings?tab=notifications",
    )
    html_nologo = event_notify._order_batch_html(
        "Demo A.Ş.", orders, links, APP, products, logo_url="",
    )
    text = event_notify._order_batch_text(
        "Demo A.Ş.", orders, links, products, settings_link="ignored",
    )
    assert html_logo == (FIXTURES / "order_batch_html_logo.html").read_text(encoding="utf-8")
    assert html_nologo == (FIXTURES / "order_batch_html_nologo.html").read_text(encoding="utf-8")
    assert text == (FIXTURES / "order_batch_text.txt").read_text(encoding="utf-8")
    assert 'width="40"' in html_logo and 'width="40"' not in html_nologo


def test_layout_button_rejects_javascript_and_escapes_quotes():
    html = notify_email_layout.render_layout(
        company_name='Firma <script>alert("x")</script>',
        title="Başlık <script>'q'</script>",
        summary='Özet "etiket"',
        body_html=notify_email_layout.message_body_html('Satır <script>\n"iki"'),
        button_link="javascript:alert(1)",
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "&quot;x&quot;" in html
    assert "&#x27;q&#x27;" in html
    assert "javascript:" not in html.lower()
    assert "Uygulamada aç" not in html
    assert "<a " not in html
    assert "tk-card" in html and "tk-bar" in html
    assert "prefers-color-scheme:dark" in html
    text = notify_email_layout.render_layout_text(
        company_name="Firma",
        title="Başlık",
        summary="Özet",
        lines=['Satır <script>'],
        link="javascript:alert(1)",
    )
    assert "javascript:" not in text.lower()
    assert "Satır <script>" in text


@pytest.fixture
def setup_en():
    db = _db()
    send = AsyncMock(side_effect=_ok_send)
    mail_acc = AsyncMock(return_value={"email": "firma@demo.com"})
    event_notify.init(db, {"mail_account": mail_acc}, get_current_user=AsyncMock())
    mail_service.init(db)
    return db, send


def _patched(send):
    stack = ExitStack()
    stack.enter_context(_mail_patch(send))
    stack.enter_context(patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})))
    stack.enter_context(patch.object(public_url, "public_base_url_for", AsyncMock(return_value=APP)))
    return stack


_INSTANT = (
    ("einvoice_incoming", "Gelen e-belge: Tedarikçi", "Tutar 10 ₺", "/edoc-inbox",
     ["admin@demo.com", "muhasebe@demo.com"]),
    ("gib_credits_low", "GİB kontör düşük (5)", "Kalan kontör: 5", "/account",
     ["admin@demo.com"]),
    ("receivable_overdue", "1 vadesi geçmiş alacak", "Toplam 500,00 ₺", "/invoices",
     ["admin@demo.com", "muhasebe@demo.com"]),
)


@pytest.mark.parametrize("event,title,message,path,recipients", _INSTANT)
def test_instant_event_uses_shared_layout(setup_en, event, title, message, path, recipients):
    db, send = setup_en
    db.companies.docs["c1"]["logo_url"] = "/api/files/c1/logo.png"

    async def _run():
        with _patched(send):
            return await event_notify.notify_event(
                "c1", event, title, message, link=path,
                dedupe_key=f"layout:{event}",
            )

    res = asyncio.run(_run())
    assert res.get("status") == "ok"
    assert send.await_count == 1
    call = send.await_args
    assert list(call.args[0]) == recipients
    assert call.args[1] == f"[TamKobi] Demo A.Ş.: {title}"
    assert call.kwargs["purpose"] == "transactional"
    assert call.kwargs["company_id"] == "c1"
    assert call.kwargs["reply_to"] is None
    assert call.kwargs["from_name"] == "Demo A.Ş."
    html = call.kwargs["html"]
    body = call.args[2]
    label = event_notify.EVENT_LABELS[event]
    link = f"{APP}{path}"
    assert "Demo A.Ş." in html and title in html and label in html
    assert link in html and "Uygulamada aç →" in html
    assert "tk-card" in html and "tk-bar" in html
    assert "prefers-color-scheme:dark" in html
    assert f'{APP}/api/files/c1/logo.png' in html
    assert 'width="40"' in html and "w=128" not in html
    assert message in body and label in body and link in body
    assert "Ayarlar Platform Yönetimi'nden yapılır" in body


def test_instant_email_omits_logo_cell_when_missing(setup_en):
    _db_obj, send = setup_en

    async def _run():
        with _patched(send):
            await event_notify.notify_event(
                "c1", "gib_credits_low", "GİB kontör düşük (3)", "Kalan 3",
                link="/account", dedupe_key="layout:nologo",
            )

    asyncio.run(_run())
    html = send.await_args.kwargs["html"]
    assert "<img" not in html
    assert 'width="40"' not in html
    assert "GİB kontör düşük" in html
    assert f"{APP}/account" in html


def test_send_email_escapes_user_text_and_drops_javascript_button(setup_en):
    db, send = setup_en
    db.companies.docs["c1"]["name"] = 'Firma <script>alert("x")</script>'

    async def _run():
        with _patched(send):
            await event_notify._send_email_now(
                "c1", {}, ["admin@demo.com"],
                "Başlık <script>'q'</script>",
                'Mesaj <script>alert("y")</script>\n"satır"',
                "javascript:alert(1)",
                "einvoice_incoming",
            )

    asyncio.run(_run())
    call = send.await_args
    assert call.args[0] == ["admin@demo.com"]
    assert call.args[1] == '[TamKobi] Firma <script>alert("x")</script>: Başlık <script>\'q\'</script>'
    assert call.kwargs["purpose"] == "transactional"
    assert call.kwargs["company_id"] == "c1"
    assert call.kwargs["from_name"] == 'Firma <script>alert("x")</script>'
    assert call.kwargs["reply_to"] is None
    html = call.kwargs["html"]
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "&quot;x&quot;" in html
    assert "&quot;y&quot;" in html
    assert "&#x27;q&#x27;" in html
    assert "javascript:" not in html.lower()
    assert "Uygulamada aç" not in html
    assert "Gelen e-Fatura" in html
    assert "<br>" in html
    body = call.args[2]
    assert 'Mesaj <script>alert("y")</script>' in body
    assert "javascript:" not in body.lower()


def test_digest_lists_rows_escaped_without_changing_subject(setup_en):
    db, send = setup_en
    past = _iso(timedelta(minutes=-5))
    rows = [
        ("h0", "hourly", "einvoice_incoming", '<script>alert("a")</script>', 'Mesaj "bir"'),
        ("h1", "hourly", "einvoice_incoming", "İkinci", "Mesaj iki"),
        ("d0", "daily", "gib_credits_low", "Kontör <b>az</b>", "Kalan 4"),
        ("d1", "daily", "gib_credits_low", "Kontör yine", "Kalan 2"),
    ]
    for _id, digest, event, title, message in rows:
        db.notify_outbox.docs[_id] = {
            "_id": _id, "company_id": "c1", "event": event,
            "digest": digest, "due_at": past, "status": "pending", "attempts": 0,
            "title": title, "message": message, "link": f"{APP}/edoc-inbox",
            "channels": {"email": True, "sms": False}, "created_at": past,
        }

    async def _run():
        with _patched(send):
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    assert send.await_count == 2
    by_subject = {call.args[1]: call for call in send.await_args_list}
    hourly_subject = '[TamKobi] Demo A.Ş.: Gelen e-Fatura: 2 bildirim'
    daily_subject = "[TamKobi] Demo A.Ş.: GİB kontör düşük: 2 bildirim"
    assert set(by_subject) == {hourly_subject, daily_subject}
    for call in by_subject.values():
        assert call.kwargs["purpose"] == "transactional"
        assert call.kwargs["company_id"] == "c1"
        assert call.kwargs["from_name"] == "Demo A.Ş."
        assert call.kwargs["reply_to"] is None
        html = call.kwargs["html"]
        assert "<ul" in html and "<li" in html
        assert "<script>" not in html
        assert "2 bildirim" in html
        assert "tk-bar" in html and "prefers-color-scheme:dark" in html
    hourly = by_subject[hourly_subject].kwargs["html"]
    assert "&lt;script&gt;alert(&quot;a&quot;)&lt;/script&gt;" in hourly
    assert "Mesaj &quot;bir&quot;" in hourly
    assert "İkinci" in hourly and "Mesaj iki" in hourly
    assert hourly.count("<li") == 2
    daily = by_subject[daily_subject].kwargs["html"]
    assert "Kontör &lt;b&gt;az&lt;/b&gt;" in daily
    assert daily.count("<li") == 2
    assert all(r["status"] == "sent" for r in db.notify_outbox.docs.values())
