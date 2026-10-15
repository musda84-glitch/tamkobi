"""event_notify: e-fatura / sipariş / kontör / vade + tercihler + tenant izolasyonu."""
from __future__ import annotations

import asyncio
import inspect
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import event_notify
import mail_service
import notify
import public_url


class FakeColl:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, q, *args, **kwargs):
        if not q:
            return next(iter(self.docs.values()), None)
        for d in self.docs.values():
            if self._match(d, q):
                return dict(d)
        return None

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise Exception("duplicate key")
        self.docs[doc["_id"]] = dict(doc)
        return MagicMock(inserted_id=doc["_id"])

    async def update_one(self, filt, upd, upsert=False):
        doc = None
        for d in self.docs.values():
            if self._match(d, filt or {}):
                doc = d
                break
        if doc is None:
            if not upsert:
                return MagicMock(modified_count=0)
            doc = {"_id": filt.get("_id") or filt.get("company_id") or "x"}
            if "company_id" in filt:
                doc["company_id"] = filt["company_id"]
            self.docs[doc["_id"]] = doc
        if "$set" in upd:
            doc.update(upd["$set"])
        if "$setOnInsert" in upd and upsert:
            for k, v in upd["$setOnInsert"].items():
                doc.setdefault(k, v)
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                doc[k] = int(doc.get(k) or 0) + int(v)
        return MagicMock(modified_count=1)

    async def update_one_atomic(self, query, update):
        return await self.update_one(query, update)

    async def update_many(self, filt, upd):
        n = 0
        for d in list(self.docs.values()):
            if not self._match(d, filt or {}):
                continue
            if "$set" in upd:
                d.update(upd["$set"])
                n += 1
        return MagicMock(modified_count=n)

    def _match(self, d, q):
        for k, v in (q or {}).items():
            if k == "$or":
                if not any(self._match(d, clause) for clause in v):
                    return False
                continue
            if str(k).startswith("$"):
                continue
            if isinstance(v, dict):
                if "$in" in v and d.get(k) not in v["$in"]:
                    return False
                if "$nin" in v and d.get(k) in v["$nin"]:
                    return False
                if "$ne" in v and d.get(k) == v["$ne"]:
                    return False
                if "$lt" in v and not (d.get(k) is not None and d.get(k) < v["$lt"]):
                    return False
                if "$lte" in v and not (d.get(k) is not None and d.get(k) <= v["$lte"]):
                    return False
                continue
            if k == "company_ids":
                ids = d.get("company_ids") or []
                if v not in ids and d.get("company_ids") != v:
                    return False
                continue
            if d.get(k) != v:
                return False
        return True

    def find(self, q=None, *args, **kwargs):
        rows = [dict(d) for d in self.docs.values() if self._match(d, q or {})]

        class C:
            def sort(self, *a, **k):
                return self

            async def to_list(self, n):
                return rows[:n]

            def __aiter__(self):
                self._i = 0
                return self

            async def __anext__(self):
                if self._i >= len(rows):
                    raise StopAsyncIteration
                r = rows[self._i]
                self._i += 1
                return r

        return C()


def _db():
    db = MagicMock()
    db.company_notify_prefs = FakeColl([])
    db.notify_event_dedupe = FakeColl([])
    db.notify_outbox = FakeColl([])
    db.notify_sms_daily = FakeColl([])
    db.notifications = FakeColl([])
    db.companies = FakeColl([
        {"_id": "c1", "name": "Demo A.Ş.", "email": "info@demo.com"},
        {"_id": "c2", "name": "Other"},
    ])
    db.users = FakeColl([
        {"_id": "u_admin", "email": "admin@demo.com", "phone": "05321111111", "role": "admin",
         "is_active": True, "active_company_id": "c1", "company_ids": ["c1"]},
        {"_id": "u_acc", "email": "muhasebe@demo.com", "phone": "05322222222", "role": "accountant",
         "is_active": True, "active_company_id": "c1", "company_ids": ["c1"]},
        {"_id": "u_sales", "email": "satis@demo.com", "role": "sales",
         "is_active": True, "active_company_id": "c1", "company_ids": ["c1"]},
        {"_id": "u_other", "email": "x@other.com", "role": "admin",
         "is_active": True, "active_company_id": "c2", "company_ids": ["c2"]},
    ])
    db.invoices = FakeColl([])
    db.orders = FakeColl([])
    db.platform_settings = FakeColl([{"_id": "platform"}])
    db.push_tokens = FakeColl([])
    db.mail_logs = FakeColl([])
    db.mail_suppressions = FakeColl([])
    return db


async def _ok_send(*args, **kwargs):
    to = args[0] if args else kwargs.get("to")
    if isinstance(to, str):
        to = [to]
    return {"status": "sent", "to": list(to or []), "driver": "platform_smtp"}


@pytest.fixture
def setup_en():
    db = _db()
    send = AsyncMock(side_effect=_ok_send)
    mail_acc = AsyncMock(return_value={
        "email": "firma@demo.com", "smtp_host": "smtp.firma.com", "smtp_port": 587,
        "smtp_user": "firma@demo.com", "password": "secret",
    })
    event_notify.init(db, {"mail_account": mail_acc}, get_current_user=AsyncMock())
    mail_service.init(db)
    return db, send, mail_acc


def _mail_patch(send):
    return patch.object(event_notify.mail_service, "send_mail", send)


def test_type_roles_include_new_events():
    assert notify.roles_for_type("einvoice_incoming") == ["admin", "manager", "accountant"]
    assert notify.roles_for_type("order_new") == ["admin", "manager", "sales"]
    assert notify.roles_for_type("gib_credits_low") == ["admin"]
    assert notify.roles_for_type("receivable_overdue") == ["admin", "accountant"]


def test_new_einvoice_notifies_once_and_emails(setup_en):
    db, send, _ = setup_en

    async def _run():
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            doc = {
                "id": "ed1", "uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "supplier": {"name": "Tedarikçi X", "tax_id": "1234567890"},
                "grand_total": 1500.5,
            }
            r1 = await event_notify.notify_einvoice_batch("c1", [doc])
            r2 = await event_notify.notify_einvoice_batch("c1", [doc])
            return r1, r2

    r1, r2 = asyncio.run(_run())
    assert r1.get("last", r1).get("status") == "ok" or r1.get("status") == "ok"
    assert r2.get("last", r2).get("status") == "duplicate" or r2.get("status") == "duplicate"
    notes = [n for n in db.notifications.docs.values() if n.get("type") == "einvoice_incoming"]
    assert len(notes) == 1
    assert send.await_count == 1
    args = send.await_args
    to = args.args[0]
    assert "admin@demo.com" in to or "muhasebe@demo.com" in to
    body = " ".join(str(a) for a in args.args) + str(args.kwargs)
    assert "127.0.0.1" not in body and "localhost" not in body


def test_orders_two_vs_summary(setup_en):
    db, send, _ = setup_en

    async def _run():
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            two = [
                {"_id": "o1", "channel": "trendyol", "order_number": "T1", "grand_total": 100},
                {"_id": "o2", "channel": "trendyol", "order_number": "T2", "grand_total": 200},
            ]
            await event_notify.notify_orders_batch("c1", two)
            ten = [
                {"_id": f"o{i}", "channel": "trendyol", "order_number": f"N{i}", "grand_total": 10}
                for i in range(10)
            ]
            await event_notify.notify_orders_batch("c1", ten)

    asyncio.run(_run())
    order_notes = [n for n in db.notifications.docs.values() if n.get("type") == "order_new"]
    assert len(order_notes) == 3
    assert any("10 yeni sipariş" in (n.get("title") or "") for n in order_notes)


def test_prefs_email_off_no_email(setup_en):
    db, send, _ = setup_en

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"inapp": True, "email": False, "sms": False, "digest": "instant"}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                dedupe_key="order:t:1",
            )

    asyncio.run(_run())
    assert send.await_count == 0
    assert any(n.get("type") == "order_new" for n in db.notifications.docs.values())


def test_company_email_from_sets_reply_to(setup_en):
    """email_from=company → Reply-To şirket; gönderim kuyruk sonrası, yine send_mail."""
    db, send, mail_acc = setup_en
    mail_acc.side_effect = HTTPException(status_code=409, detail="reauth")
    db.orders.docs["o1"] = {
        "_id": "o1", "company_id": "c1", "channel": "b2b", "order_number": "B2B-1",
        "customer_name": "Demo", "grand_total": 10, "currency": "TRY", "order_status": "pending",
        "items": [],
    }

    async def _run():
        await event_notify.save_prefs("c1", {
            "email_from": "company",
            "events": {"order_new": {"inapp": True, "email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            res = await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                ref_type="order", ref_id="o1", dedupe_key="order:o1",
            )
            assert send.await_count == 0
            assert res.get("queued") is True
            await event_notify.flush_notify_outbox()
            return res

    asyncio.run(_run())
    assert send.await_count >= 1
    assert send.await_args.kwargs.get("reply_to") == "info@demo.com"
    assert send.await_args.kwargs.get("from_name") == "Demo A.Ş."
    assert send.await_args.kwargs.get("company_id") == "c1"


def test_kontor_warning_once_per_day(setup_en):
    db, send, _ = setup_en

    async def _run():
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            r1 = await event_notify.maybe_gib_credits_low("c1", 5, threshold=20)
            r2 = await event_notify.maybe_gib_credits_low("c1", 3, threshold=20)
            return r1, r2

    r1, r2 = asyncio.run(_run())
    assert r1.get("status") == "ok"
    assert r2.get("status") == "duplicate"
    assert sum(1 for n in db.notifications.docs.values() if n.get("type") == "gib_credits_low") == 1


def test_overdue_summary_admin_accountant_roles(setup_en):
    db, send, _ = setup_en
    today = date.today().isoformat()
    db.invoices.docs["inv1"] = {
        "_id": "inv1", "company_id": "c1", "invoice_type": "sales",
        "payment_status": "unpaid", "status": "approved",
        "due_date": "2020-01-01", "grand_total": 500, "paid_amount": 0,
        "invoice_number": "SF-1",
    }

    async def _run():
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            return await event_notify.run_receivable_overdue()

    res = asyncio.run(_run())
    assert res["sent"] >= 1
    notes = [n for n in db.notifications.docs.values() if n.get("type") == "receivable_overdue"]
    assert notes
    assert set(notes[0].get("roles") or []) == {"admin", "accountant"}
    assert "sales" not in (notes[0].get("roles") or [])
    assert send.await_count >= 1
    emailed = send.await_args.args[0]
    assert "admin@demo.com" in emailed
    assert "muhasebe@demo.com" in emailed
    assert "satis@demo.com" not in emailed
    _ = today


def test_links_no_localhost(setup_en):
    _, send, _ = setup_en

    async def _run():
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event(
                "c1", "einvoice_incoming", "Belge", "msg", link="/edoc-inbox",
                dedupe_key="einv:linktest",
            )
            link = await event_notify.app_link("/orders")
            assert "127.0.0.1" not in link
            assert "localhost" not in link
            assert link.startswith("https://")

    asyncio.run(_run())
    body = str(send.await_args)
    assert "127.0.0.1" not in body
    assert "localhost" not in body
    assert "app.tamkobi.com" in body


def test_prefs_api_tenant_isolation(setup_en):
    db, _, _ = setup_en

    async def _run():
        user_c1 = {"_id": "u_admin", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}
        with pytest.raises(HTTPException) as ei:
            from tenant_access import resolve_company_id
            resolve_company_id(user_c1, "c2")
        assert ei.value.status_code == 403
        saved = await event_notify.save_prefs("c1", {"extra_emails": ["extra@demo.com"]})
        assert saved["company_id"] == "c1"
        assert "extra@demo.com" in saved["extra_emails"]
        other = await event_notify.get_prefs("c2")
        assert other["company_id"] == "c2"
        assert other.get("extra_emails") == []

    asyncio.run(_run())


def test_put_notify_prefs_requires_company_admin(setup_en):
    async def _run():
        sales = {"_id": "u_sales", "company_ids": ["c1"], "active_company_id": "c1", "role": "sales"}
        with pytest.raises(HTTPException) as ei:
            await event_notify.put_notify_prefs_route(
                {"company_id": "c1", "extra_emails": ["x@y.com"]}, user=sales,
            )
        assert ei.value.status_code == 403
        admin = {"_id": "u_admin", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}
        out = await event_notify.put_notify_prefs_route(
            {"company_id": "c1", "extra_emails": ["ok@demo.com"]}, user=admin,
        )
        assert "ok@demo.com" in out.get("extra_emails", [])

    asyncio.run(_run())


def test_send_mail_failure_reported(setup_en):
    db, send, _mail_acc = setup_en

    async def _fail(*_a, **_k):
        return {"status": "failed", "error": "smtp fail", "driver": "platform_smtp"}

    send.side_effect = _fail
    db.orders.docs["o1"] = {
        "_id": "o1", "company_id": "c1", "channel": "b2b", "order_number": "B2B-9",
        "customer_name": "Demo", "grand_total": 10, "currency": "TRY", "order_status": "pending",
        "items": [],
    }

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"inapp": True, "email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            res = await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                ref_type="order", ref_id="o1", dedupe_key="order:o1",
            )
            assert res.get("queued") is True
            assert send.await_count == 0
            await event_notify.flush_notify_outbox()
            return res

    asyncio.run(_run())
    assert send.await_count >= 1
    row = next(iter(db.notify_outbox.docs.values()))
    assert row["status"] == "pending"
    assert int(row["attempts"]) == 1
    assert row.get("next_try_at")


def _iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def _order(oid, **extra):
    doc = {
        "_id": oid,
        "company_id": "c1",
        "channel": "b2b",
        "order_number": f"B2B-{oid}",
        "customer_name": "Bayi",
        "grand_total": 100,
        "currency": "TRY",
        "order_status": "pending",
        "items": [{
            "product_name": "Ürün",
            "quantity": 2,
            "unit_price_incl": 50,
            "total_incl": 100,
            "image_url": "/api/files/c1/p.webp",
        }],
    }
    doc.update(extra)
    return doc


def _backdate(db, when: str) -> None:
    for doc in db.notify_outbox.docs.values():
        doc["created_at"] = when


def test_digest_loop_interval_and_batch_default():
    assert inspect.signature(event_notify.digest_loop).parameters["interval_s"].default == 60
    assert "batch" in event_notify.DIGEST_MODES
    prefs = event_notify.default_prefs("c1")
    assert prefs["events"]["order_new"]["digest"] == "batch"
    assert "batch_minutes" not in prefs["events"]["order_new"]


def test_invalid_batch_minutes_400(setup_en):
    async def _run():
        with pytest.raises(HTTPException) as ei:
            await event_notify.save_prefs("c1", {"events": {"order_new": {"batch_minutes": 7}}})
        assert ei.value.status_code == 400
        with pytest.raises(HTTPException) as ei2:
            event_notify._norm_event_prefs({"order_new": {"batch_minutes": "abc"}})
        assert ei2.value.status_code == 400
        import saas_billing
        with pytest.raises(HTTPException) as ei3:
            await saas_billing.put_settings({"notify_order_batch_minutes_default": 12}, {})
        assert ei3.value.status_code == 400

    asyncio.run(_run())


def test_platform_default_then_company_override(setup_en):
    db, _send, _ = setup_en

    async def _run():
        db.platform_settings.docs["platform"] = {
            "_id": "platform", "notify_order_batch_minutes_default": 30,
        }
        assert await event_notify.resolve_order_batch_minutes("c1") == 30
        await event_notify.save_prefs("c1", {"events": {"order_new": {"batch_minutes": 5, "digest": "batch"}}})
        assert await event_notify.resolve_order_batch_minutes("c1") == 5
        db.platform_settings.docs["platform"]["notify_order_batch_minutes_default"] = 60
        assert await event_notify.resolve_order_batch_minutes("c1") == 5
        await event_notify.save_prefs("c1", {"events": {"order_new": {"batch_minutes": 0, "digest": "batch"}}})
        assert await event_notify.resolve_order_batch_minutes("c1") == 0
        stored = next(iter(db.company_notify_prefs.docs.values()))
        stored["events"]["order_new"].pop("batch_minutes", None)
        assert await event_notify.resolve_order_batch_minutes("c1") == 60
        db.platform_settings.docs.clear()
        stored["events"]["order_new"].pop("batch_minutes", None)
        assert await event_notify.resolve_order_batch_minutes("c1") == 10

    asyncio.run(_run())


def test_three_orders_within_10_minutes_one_mail_per_recipient(setup_en):
    db, send, _ = setup_en
    for i in range(1, 4):
        db.orders.docs[f"o{i}"] = _order(f"o{i}", order_number=f"B2B-{i}", customer_name=f"Müşteri {i}")

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"inapp": True, "email": True, "sms": True, "digest": "batch", "batch_minutes": 10}},
        })
        orders = [db.orders.docs[f"o{i}"] for i in range(1, 4)]
        sms = AsyncMock(return_value={"ok": True})
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")), \
             patch("platform_sms.send_platform_sms", sms):
            await event_notify.notify_orders_batch("c1", orders)
            assert send.await_count == 0
            rows = list(db.notify_outbox.docs.values())
            assert len(rows) == 3
            assert {r["dedupe_key"] for r in rows} == {"order:o1", "order:o2", "order:o3"}
            assert all(r["status"] == "pending" for r in rows)
            assert all("due_at" not in r for r in rows)
            assert all(r["ref_id"] == r["dedupe_key"].split(":", 1)[1] for r in rows)
            _backdate(db, _iso(timedelta(minutes=-9)))
            await event_notify.flush_notify_outbox()
            assert send.await_count == 0
            _backdate(db, _iso(timedelta(minutes=-10, seconds=-1)))
            await event_notify.flush_notify_outbox()
            return sms

    sms = asyncio.run(_run())
    assert send.await_count == 2
    subjects = [c.args[1] for c in send.await_args_list]
    assert subjects == ["3 yeni sipariş", "3 yeni sipariş"]
    html = send.await_args.kwargs["html"]
    text = send.await_args.args[2]
    for no in ("B2B-1", "B2B-2", "B2B-3"):
        assert no in html and no in text
    assert "/orders?open=o1" in html
    assert "https://app.tamkobi.com/api/files/c1/p.webp?w=128&amp;fmt=jpg" in html
    assert "cid:" not in html and "data:image" not in html
    assert "100,00 ₺" in html
    assert sms.await_count == 1
    assert "3 yeni sipariş" in sms.await_args.kwargs["message"]
    assert all(r["status"] == "sent" for r in db.notify_outbox.docs.values())


def test_lowering_batch_window_sends_waiting_rows(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1")

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 60}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_orders_batch("c1", [db.orders.docs["o1"]])
            _backdate(db, _iso(timedelta(minutes=-6)))
            await event_notify.flush_notify_outbox()
            assert send.await_count == 0
            assert next(iter(db.notify_outbox.docs.values()))["status"] == "pending"
            await event_notify.save_prefs("c1", {
                "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 5}},
            })
            await event_notify.flush_notify_outbox()
            assert send.await_count == 2
            await event_notify.save_prefs("c2", {
                "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 5}},
            })

    asyncio.run(_run())


def test_raising_batch_window_holds_rows(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1", order_number="B2B-HOLD")

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 5}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_orders_batch("c1", [db.orders.docs["o1"]])
            _backdate(db, _iso(timedelta(minutes=-6)))
            await event_notify.save_prefs("c1", {
                "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 60}},
            })
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    assert send.await_count == 0
    row = next(iter(db.notify_outbox.docs.values()))
    assert row["status"] == "pending"
    assert row["dedupe_key"] == "order:o1"


def test_concurrent_flush_sends_once(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1", order_number="B2B-RACE")

    class Racing(FakeColl):
        def __init__(self):
            super().__init__([])
            self.lock = asyncio.Lock()

        async def update_one_atomic(self, query, update):
            await asyncio.sleep(0)
            async with self.lock:
                await asyncio.sleep(0)
                return await super().update_one(query, update)

    db.notify_outbox = Racing()

    async def _slow(*args, **kwargs):
        await asyncio.sleep(0.05)
        return {"status": "sent", "to": list(args[0]), "driver": "platform_smtp"}

    send.side_effect = _slow

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_orders_batch("c1", [db.orders.docs["o1"]])
            await asyncio.gather(
                event_notify.flush_notify_outbox(),
                event_notify.flush_notify_outbox(),
            )

    asyncio.run(_run())
    assert send.await_count == 2
    assert {c.args[1] for c in send.await_args_list} == {"Yeni B2B siparişi B2B-RACE"}
    assert next(iter(db.notify_outbox.docs.values()))["status"] == "sent"


def test_failed_send_retries_without_duplicate(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1", order_number="B2B-RETRY")
    state = {"n": 0}

    async def _flaky(*args, **kwargs):
        state["n"] += 1
        if state["n"] <= 2:
            return {"status": "failed", "error": "smtp fail", "driver": "platform_smtp"}
        return {"status": "sent", "to": list(args[0]), "driver": "platform_smtp"}

    send.side_effect = _flaky

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event(
                "c1", "order_new", "Yeni", "msg", ref_type="order", ref_id="o1",
            )
            await event_notify.flush_notify_outbox()
            assert send.await_count == 2
            row = next(iter(db.notify_outbox.docs.values()))
            assert row["status"] == "pending" and row["attempts"] == 1
            await event_notify.flush_notify_outbox()
            assert send.await_count == 2
            row["next_try_at"] = _iso(timedelta(seconds=-5))
            await event_notify.flush_notify_outbox()
            assert send.await_count == 4
            await event_notify.flush_notify_outbox()
            assert send.await_count == 4

    asyncio.run(_run())
    row = next(iter(db.notify_outbox.docs.values()))
    assert row["status"] == "sent"
    subjects = [c.args[1] for c in send.await_args_list]
    assert subjects.count("Yeni B2B siparişi B2B-RETRY") == 4


def test_order_mail_escapes_script_and_extra_lines(setup_en):
    db, send, _ = setup_en
    items = [{
        "product_name": f"<script>alert({i})</script>",
        "quantity": 1,
        "unit_price": 10,
        "total": 10,
        "image_url": "/api/files/c1/p.webp" if i == 0 else "",
    } for i in range(16)]
    db.orders.docs["fat"] = _order(
        "fat", order_number="B2B-FAT", customer_name="<script>x</script>", items=items, grand_total=160,
    )
    for i in range(20):
        db.orders.docs[f"x{i}"] = _order(f"x{i}", order_number=f"B2B-X{i}", items=[{
            "product_name": "Ek", "quantity": 1, "unit_price": 1, "total": 1,
        }], grand_total=1)

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        orders = [db.orders.docs["fat"]] + [db.orders.docs[f"x{i}"] for i in range(20)]
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_orders_batch("c1", orders)
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    html = send.await_args.kwargs["html"]
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "ve 1 kalem daha" in html
    assert "ve 1 sipariş daha" in html
    assert "https://app.tamkobi.com/brand/tamkobi-icon-192.png" in html
    text = send.await_args.args[2]
    assert "ve 1 kalem daha" in text
    assert "ve 1 sipariş daha" in text


def test_email_off_skips_queue_and_queued_rows(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1")

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"inapp": True, "email": False, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_orders_batch("c1", [db.orders.docs["o1"]])
            assert db.notify_outbox.docs == {}
            assert any(n.get("type") == "order_new" for n in db.notifications.docs.values())
            db.notify_outbox.docs["q1"] = {
                "_id": "q1", "company_id": "c1", "event": "order_new", "ref_id": "o1",
                "dedupe_key": "order:o1", "status": "pending", "digest": "batch",
                "created_at": _iso(timedelta(minutes=-30)), "attempts": 0,
                "channels": {"email": True, "sms": False},
            }
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    assert send.await_count == 0
    assert db.notify_outbox.docs["q1"]["status"] == "skipped"


def test_cancelled_deleted_fx_bad_base_and_tenant(setup_en):
    db, send, _ = setup_en
    db.orders.docs["ok"] = _order(
        "ok", order_number="B2B-OK", customer_name="Açık",
        currency="USD", fx_rate=40.5, grand_total=10, local_total=405,
        items=[{
            "product_name": "Dolarlı", "quantity": 1, "unit_price": 10, "total": 10,
            "image_url": "/api/files/c1/usd.webp",
        }],
    )
    db.orders.docs["gone"] = _order("gone", order_number="B2B-GONE", order_status="cancelled", customer_name="İptal")
    db.orders.docs["c2order"] = _order("c2order", company_id="c2", order_number="B2B-SECRET", customer_name="GIZLI")
    db.users.docs["u_c2"] = {
        "_id": "u_c2", "email": "c2@other.com", "role": "admin", "is_active": True,
        "active_company_id": "c2", "company_ids": ["c2"],
    }

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        await event_notify.save_prefs("c2", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="http://127.0.0.1:3000")):
            await event_notify.notify_orders_batch("c1", [db.orders.docs["ok"], db.orders.docs["gone"]])
            db.notify_event_dedupe.docs.clear()
            await event_notify.notify_event(
                "c2", "order_new", "Yeni", "msg", ref_type="order", ref_id="c2order",
            )
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    assert send.await_count >= 1
    bodies = []
    for call in send.await_args_list:
        bodies.append(call.kwargs["html"] + call.args[2])
    joined = "\n".join(bodies)
    assert "127.0.0.1" not in joined
    assert "localhost" not in joined
    assert "B2B-GONE" not in joined
    assert "İptal" not in joined
    assert "10,00 USD" in joined
    assert "kur 40,50" in joined
    assert "405,00 ₺" in joined
    c1_mails = [b for b in bodies if "B2B-OK" in b]
    assert c1_mails and all("GIZLI" not in b for b in c1_mails)
    assert any("GIZLI" in b for b in bodies)
    gone = db.notify_outbox.docs["out:c1:order:gone"]
    assert gone["status"] == "skipped"


def test_hourly_digest_claim_sends_once(setup_en):
    db, send, _ = setup_en

    async def _run():
        past = _iso(timedelta(minutes=-5))
        for i, title in enumerate(("<script>x</script>", "İki")):
            db.notify_outbox.docs[f"h{i}"] = {
                "_id": f"h{i}", "company_id": "c1", "event": "einvoice_incoming",
                "digest": "hourly", "due_at": past, "status": "pending", "attempts": 0,
                "title": title, "message": "m", "link": "https://app.tamkobi.com/edoc-inbox",
                "channels": {"email": True, "sms": False}, "created_at": past,
            }
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.flush_notify_outbox()
            n = send.await_count
            await event_notify.flush_notify_outbox()
            return n

    n = asyncio.run(_run())
    assert n == 1
    assert send.await_count == 1
    assert all(r["status"] == "sent" for r in db.notify_outbox.docs.values())
    assert "<script>" not in send.await_args.kwargs["html"]


def test_stale_sending_is_reclaimed(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1", order_number="B2B-STALE")
    old = _iso(timedelta(minutes=-20))
    db.notify_outbox.docs["s1"] = {
        "_id": "s1", "company_id": "c1", "event": "order_new", "ref_id": "o1",
        "dedupe_key": "order:o1", "status": "sending", "digest": "batch",
        "claim_id": "old-claim", "claimed_at": old, "created_at": old, "attempts": 0,
        "channels": {"email": True, "sms": False},
    }

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 10}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    assert send.await_count == 2
    assert db.notify_outbox.docs["s1"]["status"] == "sent"


def test_empty_recipients_skipped(setup_en):
    db, send, _ = setup_en
    for u in list(db.users.docs.values()):
        u["email"] = ""
    db.orders.docs["o1"] = _order("o1")

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
            "extra_emails": [],
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event("c1", "order_new", "Yeni", "m", ref_type="order", ref_id="o1")
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    assert send.await_count == 0
    assert next(iter(db.notify_outbox.docs.values()))["status"] == "skipped"
