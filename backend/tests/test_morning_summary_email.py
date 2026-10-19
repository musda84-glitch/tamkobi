"""Sabah özeti HTML e-postası ve notify_outbox kuyruğu."""
from __future__ import annotations

import asyncio
import copy
import re
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

import comm_service
import event_notify
import morning_summary_email
import pricing
from mysql_store import match_query
from test_event_notify import _db, _mail_patch, _ok_send

LINK = "https://panel.example.test/stock"


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, docs, limits):
        self._docs = docs
        self._limits = limits
        self._limit = None

    def limit(self, n):
        self._limit = int(n)
        self._limits.append(self._limit)
        return self

    def _rows(self, length=None):
        rows = list(self._docs)
        cap = self._limit
        if length is not None:
            cap = int(length) if cap is None else min(cap, int(length))
        if cap is not None:
            rows = rows[:cap]
        return copy.deepcopy(rows)

    async def to_list(self, length=None):
        return self._rows(length)

    def __aiter__(self):
        rows = self._rows()

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class _Coll:
    def __init__(self, db):
        self.docs = []
        self.db = db

    def find(self, query=None, projection=None):
        matched = [doc for doc in self.docs if match_query(doc, query or {})]
        return _Cursor(matched, self.db.limits)

    async def find_one(self, query=None, projection=None, sort=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def insert_one(self, doc):
        if any(row.get("_id") == doc.get("_id") for row in self.docs):
            raise Exception("duplicate key")
        self.docs.append(copy.deepcopy(doc))

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if not match_query(doc, query or {}):
                continue
            if "$set" in update:
                doc.update(update["$set"])
            return
        if not upsert:
            return
        doc = {}
        if isinstance(query, dict):
            for key, value in query.items():
                if not str(key).startswith("$") and not isinstance(value, dict):
                    doc[key] = value
        if "$setOnInsert" in update:
            doc.update(update["$setOnInsert"])
        if "$set" in update:
            doc.update(update["$set"])
        self.docs.append(doc)


class _Mem:
    def __init__(self):
        self._cols = {}
        self.limits = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(self)
            self._cols[name] = coll
        return coll

    async def list_collection_names(self):
        return list(self._cols)


def _item(name, qty, minimum, sku=None):
    return {"name": name, "sku": sku or name, "qty": qty, "min": minimum}


def _rich():
    products = [
        _item("Son", 9, 1, "SON"),
        _item("Orta", 3.0, 5, "ORT"),
        _item("Az", 0, 10, "AZ"),
    ]
    for index in range(9):
        products.append(_item(f"P{index}", 8, 1, f"S{index}"))
    products.append(_item("Sifir", 1, 0, "SIF"))
    products.append(_item("Yok", 4, None, "YOK"))
    return {
        "date": "18.10.2026",
        "orders_total": 1,
        "orders_amount": 5208.33,
        "orders_by_channel": {"b2b": {"count": 1, "total": 5208.33}},
        "pending_shipments": 4,
        "low_stock_count": 14,
        "low_stock": products,
        "overdue_count": 2,
        "overdue_total": 1234.50,
        "open_claims": 0,
    }


def _empty():
    return {
        "date": "18.10.2026",
        "orders_total": 0,
        "orders_amount": 0,
        "orders_by_channel": {"b2b": {"count": 1, "total": 10}},
        "pending_shipments": 0,
        "low_stock_count": 0,
        "low_stock": [_item("Gizli", 1, 1, "GIZ")],
        "overdue_count": 0,
        "overdue_total": 99,
        "open_claims": 0,
    }


def _stock_rows(html: str):
    return re.findall(r'<tr class="tk-stock-row">.*?</tr>', html, flags=re.S)


def _enable_morning_email(db, company_id="c1", *, email=True, cap=None, tenant_email=None):
    """Platform tercihi: Sabah özeti e-postası. Varsayılan kapalı olduğu için kuyruk testleri açar."""
    doc = {
        "_id": f"cnp_{company_id}",
        "company_id": company_id,
        "events": {
            "morning_summary": {"inapp": True, "email": email, "sms": False, "digest": "instant"},
        },
    }
    if cap is not None:
        doc["daily_email_cap"] = cap
    prefs = db.company_notify_prefs.docs
    if isinstance(prefs, dict):
        prefs[doc["_id"]] = doc
    else:
        prefs.append(doc)
    if tenant_email is None:
        return
    tenant = {
        "_id": f"cnt_{company_id}",
        "company_id": company_id,
        "events": {"morning_summary": {"inapp": True, "email": tenant_email}},
    }
    stored = db.company_notify_tenant.docs
    if isinstance(stored, dict):
        stored[tenant["_id"]] = tenant
    else:
        stored.append(tenant)


def _summary_settings(company_id="c1", **extra):
    doc = {
        "_id": f"ms_{company_id}",
        "company_id": company_id,
        "enabled": True,
        "time": "08:00",
        "emails": ["a@firma.test"],
        "whatsapp_numbers": [],
        "include": {"orders": True, "low_stock": True, "shipments": True, "receivables": True},
    }
    doc.update(extra)
    return doc


@pytest.fixture(autouse=True)
def _restore_bindings():
    saved_deps = dict(pricing._deps)
    saved_ev_deps = dict(event_notify._deps)
    saved = (pricing._db, event_notify._db, event_notify._current_user)
    yield
    pricing._db, event_notify._db, event_notify._current_user = saved
    pricing._deps.clear()
    pricing._deps.update(saved_deps)
    event_notify._deps.clear()
    event_notify._deps.update(saved_ev_deps)


def test_fmt_tr_numbers():
    assert morning_summary_email.fmt_int(3.0) == "3"
    assert morning_summary_email.fmt_int(5) == "5"
    assert morning_summary_email.fmt_int(1234) == "1.234"
    assert morning_summary_email.fmt_try(5208.33) == "5.208,33 ₺"
    assert morning_summary_email.fmt_try(1234.50) == "1.234,50 ₺"
    assert morning_summary_email.fmt_min(None) == "—"
    assert morning_summary_email.fmt_min("") == "—"
    assert morning_summary_email.fmt_min(5.0) == "5"


def test_summary_html_kpis_and_lowest_stock_first():
    summary = _rich()
    summary["open_claims"] = 3
    html = morning_summary_email.render_summary_html(summary, "Firma A", LINK)
    assert "Açık iade/talep: 3" in html
    assert "1 adet" in html
    assert "5.208,33 ₺" in html
    assert "b2b" in html
    assert "1.234,50 ₺" in html
    assert "max-width:600px" in html
    assert "tk-stack" in html
    kargo = html.index("Kargo bekleyen")
    assert ">4</div>" in html[kargo:kargo + 500]
    kritik = html.index("Kritik stok")
    assert ">14</div>" in html[kritik:kritik + 500]
    rows = _stock_rows(html)
    assert len(rows) == 10
    assert "Az" in rows[0]
    assert "Orta" in rows[1]
    assert ">3</td>" in rows[1]
    assert ">5</td>" in rows[1]
    assert "P0" in rows[2]
    assert ">1</td>" in rows[2]
    assert "Yok" not in html
    assert "Sifir" not in html
    assert "(SON)" not in html
    assert "ve 4 ürün daha" in html
    assert LINK in html
    assert "Stok sayfasında gör →" in html
    assert "3.0" not in html
    assert "5,208.33" not in html
    assert "5208.33" not in html


def test_claims_card_stands_alone_without_overdue():
    summary = _empty()
    summary["open_claims"] = 2
    html = morning_summary_email.render_summary_html(summary, "Firma A", LINK)
    assert "Açık iade/talep" in html
    assert "Vadesi geçen" not in html
    assert ">2</div>" in html


def test_empty_sections_are_omitted():
    html = morning_summary_email.render_summary_html(_empty(), "Firma A", LINK)
    assert "Sabah Özeti" in html
    assert "Yeni siparişler" not in html
    assert "b2b" not in html
    assert "Kargo bekleyen" not in html
    assert "Kritik stok" not in html
    assert "tk-stock-row" not in html
    assert "Stok sayfasında gör" not in html
    assert LINK not in html
    assert "Vadesi geçen" not in html
    assert "Gizli" not in html
    assert "Açık iade" not in html


def test_names_are_escaped():
    name = "<b>Kalem & Co</b>"
    summary = _empty()
    summary["orders_total"] = 1
    summary["orders_amount"] = 10
    summary["orders_by_channel"] = {name: {"count": 1, "total": 10}}
    summary["low_stock_count"] = 1
    summary["low_stock"] = [_item(name, 1, 5, "X&Y")]
    html = morning_summary_email.render_summary_html(summary, name, LINK)
    escaped = "&lt;b&gt;Kalem &amp; Co&lt;/b&gt;"
    assert escaped in html
    assert html.count(escaped) >= 3
    assert "<b>" not in html
    assert "Kalem & Co" not in html
    assert "X&amp;Y" in html


def test_render_text_keeps_emoji_lines_and_tr_numbers():
    text = pricing.render_text(_rich(), "Firma")
    assert text.startswith("☀️ Firma — Sabah Özeti 18.10.2026")
    assert "🛒 Yeni siparişler (son 24s+): 1 adet · 5.208,33 ₺" in text
    assert "   • b2b: 1 sipariş · 5.208,33 ₺" in text
    assert "📦 Kargo bekleyen sipariş: 4" in text
    assert "⚠️ Kritik stok: 14 ürün" in text
    assert "💸 Vadesi geçen alacak: 2 fatura · 1.234,50 ₺" in text
    product_lines = [line for line in text.splitlines() if " / min " in line]
    assert len(product_lines) == 8
    assert product_lines[0].startswith("   • Son ")
    assert "3 / min 5" in text
    assert "3.0" not in text
    assert "5,208.33" not in text
    plain = morning_summary_email.render_summary_text(_rich(), "Firma", LINK)
    assert plain.count(" / min ") == 10
    assert plain.index("Az") < plain.index("Orta")
    assert "ve 4 ürün daha" in plain
    assert LINK in plain
    assert "Sifir" not in plain
    assert "(SON)" not in plain


def test_build_summary_sorts_ratio_and_keeps_full_count():
    db = _Mem()
    for index in range(10, -1, -1):
        db.products.docs.append({
            "_id": f"m{index}",
            "company_id": "c1",
            "name": f"M{index:02d}",
            "sku": f"M{index:02d}",
            "stock_quantity": index,
            "min_stock_alert": 20,
            "track_stock": True,
        })
    db.products.docs.append({
        "_id": "sifir",
        "company_id": "c1",
        "name": "Sifir",
        "sku": "SIF",
        "stock_quantity": 0,
        "min_stock_alert": 0,
        "track_stock": True,
    })
    db.products.docs.append({
        "_id": "yok",
        "company_id": "c1",
        "name": "Yok",
        "sku": "YOK",
        "stock_quantity": 1,
        "min_stock_alert": None,
        "track_stock": True,
    })
    db.products.docs.append({
        "_id": "ok",
        "company_id": "c1",
        "name": "Saglikli",
        "sku": "OK",
        "stock_quantity": 40,
        "min_stock_alert": 5,
        "track_stock": True,
    })
    db.products.docs.append({
        "_id": "svc",
        "company_id": "c1",
        "name": "Servis",
        "sku": "SVC",
        "stock_quantity": 0,
        "min_stock_alert": 1,
        "track_stock": False,
    })
    pricing._db = db
    summary = _run(pricing.build_summary("c1"))
    assert db.limits == [morning_summary_email.LOW_STOCK_FETCH]
    assert morning_summary_email.LOW_STOCK_FETCH == 500
    assert summary["low_stock_count"] == 11
    assert len(summary["low_stock"]) == 10
    assert summary["low_stock"][0]["name"] == "M00"
    names = [row["name"] for row in summary["low_stock"]]
    assert "Sifir" not in names
    assert "Yok" not in names
    assert "Saglikli" not in names
    assert "Servis" not in names
    assert names[-1] == "M09"
    assert set(summary) == {
        "date", "orders_total", "orders_amount", "orders_by_channel",
        "pending_shipments", "low_stock_count", "low_stock",
        "overdue_count", "overdue_total", "open_claims",
    }


def test_pricing_source_does_not_smtp_send():
    text = Path(pricing.__file__).read_text(encoding="utf-8")
    assert "smtp_send" not in text
    assert "enqueue_morning_summary_email" in text
    assert ".limit(15)" not in text


def test_send_summary_queues_one_row_per_day_and_skips_smtp():
    db = _Mem()
    now = datetime.now(timezone.utc).isoformat()
    db.companies.docs.append({"_id": "c1", "name": "Firma A"})
    db.morning_summary_settings.docs.append({
        "_id": "ms1",
        "company_id": "c1",
        "enabled": True,
        "time": "08:00",
        "emails": ["a@firma.test"],
        "whatsapp_numbers": ["5551112233"],
        "include": {"orders": True, "low_stock": True, "shipments": True, "receivables": True},
    })
    db.orders.docs.append({
        "_id": "o1",
        "company_id": "c1",
        "created_at": now,
        "order_date": now,
        "channel": "b2b",
        "total_amount": 5208.33,
        "order_status": "approved",
    })
    db.products.docs.append({
        "_id": "p1",
        "company_id": "c1",
        "name": "Kalem",
        "sku": "KLM",
        "stock_quantity": 3.0,
        "min_stock_alert": 5,
        "track_stock": True,
    })
    wa_calls = []

    async def wa_send(payload):
        wa_calls.append(payload)
        return {"simulated": True}

    _enable_morning_email(db)
    mail = AsyncMock(side_effect=AssertionError("mail account"))
    smtp = AsyncMock(side_effect=AssertionError("smtp"))
    pricing.init(db, {"wa_send": wa_send, "mail_account": mail})
    event_notify.init(db, {}, get_current_user=AsyncMock())
    day = datetime.now(pricing.TR_TZ).strftime("%Y-%m-%d")

    async def _go():
        with patch.object(comm_service, "smtp_send", smtp):
            first = await pricing.send_summary("c1", manual=False)
            second = await pricing.send_summary("c1", manual=False)
            manual = await pricing.send_summary("c1", manual=True)
            return first, second, manual

    first, second, manual = _run(_go())
    smtp.assert_not_called()
    mail.assert_not_called()
    for result in (first, second, manual):
        assert result["result"]["email"] == {"ok": True, "queued": True, "to": ["a@firma.test"]}
    rows = [doc for doc in db.notify_outbox.docs if doc.get("event") == "morning_summary"]
    assert len(rows) == 2
    scheduled = next(doc for doc in rows if doc["_id"].endswith(":s"))
    assert scheduled["_id"] == f"out:c1:morning_summary:{day}:s"
    assert scheduled["channels"] == {"email": True, "sms": False}
    assert scheduled["digest"] == "instant"
    assert scheduled["status"] == "pending"
    assert scheduled["attempts"] == 0
    assert scheduled["to"] == ["a@firma.test"]
    assert scheduled["html"] and scheduled["text"]
    assert "5.208,33 ₺" in scheduled["html"]
    assert "b2b" in scheduled["html"]
    assert "<pre" not in scheduled["html"]
    assert "3.0" not in scheduled["html"]
    manual_row = next(doc for doc in rows if ":m:" in doc["_id"])
    assert manual_row["html"] and manual_row["text"]
    assert len(wa_calls) == 3
    message = wa_calls[0]["message"]
    assert "☀️" in message and "🛒" in message and "📦" in message and "⚠️" in message
    assert "5.208,33 ₺" in message
    assert "Kalem (KLM): 3 / min 5" in message
    assert "<table" not in message
    assert "3.0" not in message
    assert "5,208.33" not in message
    assert wa_calls[0]["to"] == "5551112233"


def test_flush_morning_summary_sends_html_and_retries():
    db = _db()
    event_notify.init(db, {}, get_current_user=AsyncMock())
    _enable_morning_email(db)
    send = AsyncMock(side_effect=_ok_send)

    async def _ok():
        with _mail_patch(send):
            queued = await event_notify.enqueue_morning_summary_email(
                "c1",
                emails=["ops@firma.test"],
                subject="Sabah Özeti 18.10.2026",
                html="<p>html-govde</p>",
                text="duz metin",
                day="2026-10-18",
            )
            await event_notify.flush_notify_outbox()
            return queued

    assert _run(_ok()) == "queued"
    assert send.await_count == 1
    call = send.await_args
    assert call.args[0] == ["ops@firma.test"]
    assert call.args[1] == "Sabah Özeti 18.10.2026"
    assert call.args[2] == "duz metin"
    assert call.kwargs["html"] == "<p>html-govde</p>"
    assert call.kwargs["purpose"] == "transactional"
    assert call.kwargs["company_id"] == "c1"
    assert call.kwargs["from_name"] == "Demo A.Ş."
    assert call.kwargs["reply_to"] is None
    row = next(iter(db.notify_outbox.docs.values()))
    assert row["status"] == "sent"
    assert "admin@demo.com" not in call.args[0]

    fail = AsyncMock(return_value={"status": "failed", "error": "smtp down", "to": []})

    async def _fail():
        with _mail_patch(fail):
            await event_notify.enqueue_morning_summary_email(
                "c1",
                emails=["ops@firma.test"],
                subject="Sabah Özeti",
                html="<p>ikinci</p>",
                text="ikinci metin",
                day="2026-10-18",
                manual=True,
            )
            await event_notify.flush_notify_outbox()

    _run(_fail())
    failed = next(doc for doc in db.notify_outbox.docs.values() if doc.get("html") == "<p>ikinci</p>")
    assert failed["status"] == "pending"
    assert failed["attempts"] == 1
    assert failed.get("next_try_at")
    assert fail.await_count == 1
    assert fail.await_args.kwargs["html"] == "<p>ikinci</p>"
    assert fail.await_args.args[2] == "ikinci metin"


def test_flush_defers_when_email_cap_is_zero():
    db = _db()
    event_notify.init(db, {}, get_current_user=AsyncMock())
    _enable_morning_email(db, cap=0)
    send = AsyncMock(side_effect=_ok_send)

    async def _go():
        with _mail_patch(send):
            await event_notify.enqueue_morning_summary_email(
                "c1",
                emails=["ops@firma.test"],
                subject="Sabah Özeti",
                html="<p>kap</p>",
                text="kap",
                day="2026-10-18",
            )
            await event_notify.flush_notify_outbox()

    _run(_go())
    send.assert_not_called()
    row = next(iter(db.notify_outbox.docs.values()))
    assert row["status"] == "deferred"
    assert row.get("next_try_at")


def _bind_summary(db):
    pricing.init(db, {"wa_send": AsyncMock(return_value={"simulated": True})})
    event_notify.init(db, {}, get_current_user=AsyncMock())
    db.companies.docs.append({"_id": "c1", "name": "Firma A"})
    db.morning_summary_settings.docs.append(_summary_settings())


def test_morning_summary_defaults_keep_email_off():
    assert "morning_summary" in event_notify.NEW_EVENTS
    assert event_notify.EVENT_GROUPS["morning_summary"] == "sales_invoice"
    assert event_notify.EVENT_LABELS["morning_summary"] == "Sabah özeti"
    prefs = event_notify.default_prefs("c1")
    assert prefs["events"]["morning_summary"]["email"] is False
    assert prefs["events"]["morning_summary"]["inapp"] is True
    assert event_notify.EVENT_DEFAULT_CHANNEL["morning_summary"] == {
        "inapp": True, "email": False, "sms": False, "digest": "instant",
    }


def test_send_summary_default_prefs_skips_queue_and_smtp():
    db = _Mem()
    _bind_summary(db)
    send = AsyncMock(side_effect=AssertionError("smtp"))

    async def _go():
        with patch.object(event_notify.mail_service, "send_mail", send), \
             patch.object(comm_service, "smtp_send", send):
            return await pricing.send_summary("c1", manual=False)

    result = _run(_go())
    send.assert_not_called()
    assert db.notify_outbox.docs == []
    assert result["result"]["email"] == {
        "ok": False,
        "disabled": True,
        "error": "Sabah özeti e-postası yönetim panelinde (ynt) kapalı.",
    }


def test_send_summary_tenant_email_off_skips_queue():
    db = _Mem()
    _bind_summary(db)
    _enable_morning_email(db, email=True, tenant_email=False)
    send = AsyncMock(side_effect=AssertionError("smtp"))

    async def _go():
        with patch.object(event_notify.mail_service, "send_mail", send):
            return await pricing.send_summary("c1", manual=False)

    result = _run(_go())
    send.assert_not_called()
    assert db.notify_outbox.docs == []
    assert result["result"]["email"]["disabled"] is True
    assert result["result"]["email"]["ok"] is False


def test_open_platform_and_tenant_queue_one_scheduled_row():
    db = _Mem()
    _bind_summary(db)
    _enable_morning_email(db, email=True, tenant_email=True)
    day = datetime.now(pricing.TR_TZ).strftime("%Y-%m-%d")

    async def _go():
        first = await pricing.send_summary("c1", manual=False)
        second = await pricing.send_summary("c1", manual=False)
        return first, second

    first, second = _run(_go())
    rows = [doc for doc in db.notify_outbox.docs if doc.get("event") == "morning_summary"]
    assert len(rows) == 1
    assert rows[0]["_id"] == f"out:c1:morning_summary:{day}:s"
    assert first["result"]["email"]["ok"] is True
    assert second["result"]["email"] == {"ok": True, "queued": True, "to": ["a@firma.test"]}


def test_flush_skips_queued_row_when_ynt_closes_email():
    db = _db()
    event_notify.init(db, {}, get_current_user=AsyncMock())
    _enable_morning_email(db, email=True)
    send = AsyncMock(side_effect=_ok_send)

    async def _go():
        with _mail_patch(send):
            queued = await event_notify.enqueue_morning_summary_email(
                "c1",
                emails=["ops@firma.test"],
                subject="Sabah Özeti",
                html="<p>bekleyen</p>",
                text="bekleyen",
                day="2026-10-18",
            )
            db.company_notify_prefs.docs["cnp_c1"]["events"]["morning_summary"]["email"] = False
            await event_notify.flush_notify_outbox()
            return queued

    assert _run(_go()) == "queued"
    send.assert_not_called()
    assert len(db.notify_outbox.docs) == 1
    row = next(iter(db.notify_outbox.docs.values()))
    assert row["status"] == "skipped"
    assert row["html"] == "<p>bekleyen</p>"


def test_scheduled_queue_failure_does_not_stamp_last_sent_day():
    db = _Mem()
    _bind_summary(db)
    db.morning_summary_settings.docs[0]["last_sent_day"] = "2000-01-01"
    db.morning_summary_settings.docs[0]["whatsapp_numbers"] = ["5551112233"]
    _enable_morning_email(db, email=True)
    wa = AsyncMock(return_value={"simulated": True})
    pricing.init(db, {"wa_send": wa})
    day = datetime.now(pricing.TR_TZ).strftime("%Y-%m-%d")
    original = db.notify_outbox.insert_one

    async def boom(_doc):
        raise RuntimeError("db down")

    async def _go():
        db.notify_outbox.insert_one = boom
        failed = await pricing.send_summary("c1", manual=False)
        after_fail = await db.morning_summary_settings.find_one({"company_id": "c1"})
        pending_after_fail = list(db.notify_outbox.docs)
        db.notify_outbox.insert_one = original
        queued = await pricing.send_summary("c1", manual=False)
        after_ok = await db.morning_summary_settings.find_one({"company_id": "c1"})
        db.morning_summary_settings.docs[0]["last_sent_day"] = "2000-01-01"
        db.notify_outbox.insert_one = boom
        manual = await pricing.send_summary("c1", manual=True)
        after_manual = await db.morning_summary_settings.find_one({"company_id": "c1"})
        return failed, after_fail, pending_after_fail, queued, after_ok, manual, after_manual

    failed, after_fail, pending_after_fail, queued, after_ok, manual, after_manual = _run(_go())
    assert failed["result"]["email"] == {"ok": False, "error": "Sabah özeti kuyruğa yazılamadı."}
    assert failed["result"]["whatsapp"][0]["ok"] is True
    assert failed["result"]["whatsapp"][0]["to"] == "5551112233"
    assert after_fail.get("last_sent_day") == "2000-01-01"
    assert pending_after_fail == []
    assert queued["result"]["email"] == {"ok": True, "queued": True, "to": ["a@firma.test"]}
    assert after_ok.get("last_sent_day") == day
    rows = [doc for doc in db.notify_outbox.docs if doc.get("event") == "morning_summary"]
    assert len(rows) == 1
    assert rows[0]["_id"] == f"out:c1:morning_summary:{day}:s"
    assert manual["result"]["email"]["ok"] is False
    assert after_manual.get("last_sent_day") == day
