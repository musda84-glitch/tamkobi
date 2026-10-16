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
import saas


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
        if "$unset" in upd:
            for k in upd["$unset"]:
                doc.pop(k, None)
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
                if "$gt" in v and not (d.get(k) is not None and d.get(k) > v["$gt"]):
                    return False
                if "$gte" in v and not (d.get(k) is not None and d.get(k) >= v["$gte"]):
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
    db.company_notify_tenant = FakeColl([])
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
    db.products = FakeColl([])
    db.platform_settings = FakeColl([{"_id": "platform"}])
    db.push_tokens = FakeColl([])
    db.mail_logs = FakeColl([])
    db.mail_suppressions = FakeColl([])
    db.company_audit_log = FakeColl([])
    db.__getitem__.side_effect = lambda key: getattr(db, key)
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


def test_put_notify_prefs_forbidden_for_company_admin(setup_en):
    async def _run():
        sales = {"_id": "u_sales", "company_ids": ["c1"], "active_company_id": "c1", "role": "sales"}
        with pytest.raises(HTTPException) as ei:
            await event_notify.put_notify_prefs_route(
                {"company_id": "c1", "extra_emails": ["x@y.com"]}, user=sales,
            )
        assert ei.value.status_code == 403
        assert "Platform Yönetimi" in str(ei.value.detail)
        admin = {"_id": "u_admin", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}
        with pytest.raises(HTTPException) as ei2:
            await event_notify.put_notify_prefs_route(
                {"company_id": "c1", "extra_emails": ["ok@demo.com"]}, user=admin,
            )
        assert ei2.value.status_code == 403
        assert ei2.value.detail == event_notify.COMPANY_NOTIFY_FORBIDDEN
        req = MagicMock()
        req.query_params = {"company_id": "c1"}
        got = await event_notify.get_notify_prefs_route(req, company_id="c1", user=admin)
        assert got["company_id"] == "c1"
        sa = {"_id": "u_sa", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin", "is_super_admin": True}
        out = await event_notify.put_notify_prefs_route(
            {"company_id": "c1", "extra_emails": ["ok@demo.com"]}, user=sa,
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
    assert "tamkobi-icon" not in html
    assert "https://app.tamkobi.com/api/files/c1/p.webp?w=128&amp;fmt=jpg" in html
    assert "B2B Portal" in html
    assert "Görsel" in html and "Siparişi aç" in html
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


def test_channel_and_line_image_priority():
    from models import OrderItem
    from line_totals import ORDER_ITEM_FIELDS, pick_fields

    assert event_notify.channel_label("b2b") == "B2B Portal"
    assert event_notify.channel_label("pos") == "Kasa"
    assert event_notify.channel_label("manual") == "Manuel"
    assert event_notify.channel_label("trendyol") == "Trendyol"
    assert event_notify.channel_label("OzelKanal") == "OzelKanal"

    product = {
        "sku": "RAF",
        "thumbnail_url": "/t.webp",
        "image_url": "/full.webp",
        "images": [{"url": "/gal.webp"}],
        "variants": [{"variant_id": "v1", "sku": "VAR-1", "name": "Kırmızı", "image_url": "/var.webp"}],
    }
    assert event_notify.resolve_line_image({"image_url": "https://cdn.example/mp.jpg"}, product) == "https://cdn.example/mp.jpg"
    assert event_notify.resolve_line_image({"product_id": "p", "variant_id": "v1"}, product) == "/var.webp"
    assert event_notify.resolve_line_image({"sku": "VAR-1"}, product) == "/var.webp"
    assert event_notify.resolve_line_image({}, product) == "/t.webp"
    assert event_notify.resolve_line_image({}, {"image_url": "/full.webp"}) == "/full.webp"
    assert event_notify.resolve_line_image({}, {"images": [{"image_url": "/obj.webp"}]}) == "/obj.webp"
    assert event_notify.order_line_card_image({"variant_id": "v1"}, product) == "/var.webp"
    assert event_notify.order_line_card_image({}, product) == "/full.webp"
    assert event_notify.order_line_card_image({}, {"thumbnail_url": "/t.webp"}) == "/t.webp"
    assert event_notify.order_image_url("/api/files/c1/p.webp", "https://app.tamkobi.com") == (
        "https://app.tamkobi.com/api/files/c1/p.webp?w=128&fmt=jpg"
    )
    assert event_notify.order_image_url("https://cdn.example/a.jpg", "https://app.tamkobi.com") == "https://cdn.example/a.jpg"
    assert event_notify.order_image_url("/api/files/c1/p.webp", "") == ""
    assert event_notify.order_image_url("data:image/png;base64,aaa", "https://app.tamkobi.com") == ""
    assert event_notify.order_image_url("cid:img", "https://app.tamkobi.com") == ""
    item = OrderItem(product_name="Raf", image_url="/api/files/a.webp")
    assert item.image_url == "/api/files/a.webp"
    assert "image_url" in ORDER_ITEM_FIELDS
    assert pick_fields(item.model_dump(), ORDER_ITEM_FIELDS)["image_url"] == "/api/files/a.webp"


def test_private_file_image_uses_share_token(monkeypatch):
    import signed_links
    monkeypatch.setattr(event_notify, "_file_get_is_public", lambda _path: False)
    monkeypatch.setattr(signed_links, "make_doc_share_token", lambda *_a, **_k: "9.sig")
    url = event_notify.order_image_url("/api/files/c1/p.webp", "https://app.tamkobi.com")
    assert url == "https://app.tamkobi.com/api/files/c1/p.webp?w=128&fmt=jpg&t=9.sig"
    assert not url.startswith("data:") and "cid:" not in url


def test_order_mail_layout_resolves_product_images_once(setup_en):
    db, send, _ = setup_en
    db.companies.docs["c1"]["logo_url"] = "/api/files/c1/logo.png"
    db.products.docs.update({
        "p-var": {
            "_id": "p-var", "company_id": "c1", "name": "Raf", "sku": "RAF",
            "thumbnail_url": "/api/files/c1/thumb.webp",
            "image_url": "/api/files/c1/full.webp",
            "variants": [{"variant_id": "v1", "sku": "VAR-1", "name": "Kırmızı", "image_url": "/api/files/c1/var.webp"}],
        },
        "p-thumb": {
            "_id": "p-thumb", "company_id": "c1", "sku": "MASA",
            "thumbnail_url": "/api/files/c1/thumb-only.webp",
            "image_url": "/api/files/c1/full-only.webp",
        },
        "p-gal": {
            "_id": "p-gal", "company_id": "c1",
            "images": [{"url": "/api/files/c1/gal.webp"}],
        },
        "p-none": {"_id": "p-none", "company_id": "c1", "name": "Yalın Ürün"},
    })
    db.orders.docs["o1"] = _order(
        "o1",
        order_number="B2B-1",
        channel="b2b",
        customer_name="<script>x</script>",
        notes="Kapıda bırak",
        order_date="2026-10-15T12:00:00+00:00",
        subtotal=80,
        vat_total=20,
        grand_total=100,
        items=[
            {"product_id": "p-var", "product_name": "Raf", "variant_id": "v1", "sku": "VAR-1", "quantity": 1, "unit_price": 40, "total": 40},
            {"product_id": "p-thumb", "product_name": "Masa", "sku": "MASA", "quantity": 1, "unit_price": 20, "total": 20},
            {"product_id": "p-gal", "product_name": "Galeri", "quantity": 1, "unit_price": 10, "total": 10},
            {"product_id": "p-none", "product_name": "Yalın Ürün", "quantity": 1, "unit_price": 10, "total": 10},
            {"product_id": "p-var", "product_name": "Pazar", "image_url": "https://cdn.example/mp.jpg", "quantity": 1, "unit_price": 10, "total": 10},
            {"product_name": "Gömülü", "image_url": "data:image/png;base64,AAAA", "quantity": 1, "unit_price": 0, "total": 0},
        ],
    )
    db.orders.docs["o2"] = _order(
        "o2",
        order_number="POS-1",
        channel="pos",
        customer_name="Kasa Müşteri",
        currency="USD",
        fx_rate=40.5,
        grand_total=10,
        local_total=405,
        order_date="2026-10-15T12:30:00+00:00",
        subtotal=10,
        vat_total=0,
        items=[{"product_name": "Dolarlı", "quantity": 1, "unit_price": 10, "total": 10}],
    )
    calls = []
    orig = db.products.find

    def _find(q=None, *args, **kwargs):
        calls.append(q)
        return orig(q, *args, **kwargs)

    db.products.find = _find

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_orders_batch("c1", [db.orders.docs["o1"], db.orders.docs["o2"]])
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    html = send.await_args.kwargs["html"]
    text = send.await_args.args[2]
    assert len(calls) == 1
    assert set(calls[0]["_id"]["$in"]) == {"p-var", "p-thumb", "p-gal", "p-none"}
    assert calls[0]["company_id"] == "c1"
    base = "https://app.tamkobi.com/api/files/c1/"
    assert f"{base}var.webp?w=128&amp;fmt=jpg" in html
    assert f"{base}thumb.webp" not in html
    assert f"{base}full.webp" not in html
    assert f"{base}thumb-only.webp?w=128&amp;fmt=jpg" in html
    assert f"{base}full-only.webp" not in html
    assert f"{base}gal.webp?w=128&amp;fmt=jpg" in html
    assert "https://cdn.example/mp.jpg" in html
    assert "data:image" not in html and "cid:" not in html
    assert "tamkobi-icon" not in html
    assert ">YÜ</td>" in html
    assert 'alt="Yalın Ürün"' not in html
    assert 'alt="Raf"' in html
    assert 'width="64"' in html and 'height="64"' in html
    assert 'alt="Demo A.Ş."' in html
    assert f"{base}logo.png" in html
    assert "B2B Portal" in html and "B2B Portal" in text
    assert "Kasa" in html
    assert "Sipariş No" in html and "Kanal" in html and "Müşteri" in html and "Tarih/saat" in html
    assert "Not" in html and "Kapıda bırak" in html
    assert "Görsel" in html and "Ürün" in html and "Adet" in html and "Birim" in html and "Tutar" in html
    assert "Siparişi aç" in html
    assert "/orders?open=o1" in html
    assert "/settings?tab=notifications" not in html
    assert "Ayarlar Platform Yönetimi&#x27;nden yapılır" in html
    assert "Ayarlar Platform Yönetimi'nden yapılır" in text
    assert 'name="color-scheme"' in html
    assert "@media" in html and "width:100%" in html
    assert 'role="presentation"' in html
    assert "object-fit" not in html
    assert "display:flex" not in html and "display:grid" not in html
    assert "position:" not in html
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "15:00–15:30" in html and "15.10.2026 15:00" in html
    assert "2 sipariş" in html and "Toplam 100,00 ₺" in html and "Toplam 10,00 USD" in html
    for label in ("Ara toplam", "KDV", "Genel toplam", "100,00 ₺", "10,00 USD", "kur 40,50", "405,00 ₺"):
        assert label in text
    assert "VAR-1" in html and "Kırmızı" in html


def _sa():
    return {"id": "sa1", "name": "Süper Admin", "is_super_admin": True, "email": "sa@tamkobi.com"}


def test_saas_notify_prefs_get_put_and_audit(setup_en):
    db, _send, _ = setup_en

    async def _run():
        with pytest.raises(HTTPException) as e404:
            await event_notify.get_saas_notify_prefs("missing", _sa())
        assert e404.value.status_code == 404
        got = await event_notify.get_saas_notify_prefs("c1", _sa())
        assert got["company_id"] == "c1"
        assert got["events"]["order_new"]["digest"] == "batch"
        assert "email_usage" in got
        saved = await event_notify.put_saas_notify_prefs(
            "c1",
            {
                "extra_emails": ["audit@demo.com"],
                "events": {"order_new": {"inapp": True, "email": True, "sms": False, "digest": "batch", "batch_minutes": 15}},
                "daily_email_cap": 12,
            },
            _sa(),
        )
        assert "audit@demo.com" in saved["extra_emails"]
        assert saved["events"]["order_new"]["batch_minutes"] == 15
        assert saved["daily_email_cap"] == 12
        assert saved["daily_email_cap_resolved"] == 12
        audits = list(db.company_audit_log.docs.values())
        assert len(audits) == 1
        row = audits[0]
        assert row["company_id"] == "c1"
        assert row["user_id"] == "sa1"
        assert row["action"] == "update"
        assert "Bildirim" in (row.get("record_label") or "") or "bildirim" in (row.get("summary") or "").lower() or row.get("summary")
        again = await event_notify.get_saas_notify_prefs("c1", _sa())
        assert again["daily_email_cap"] == 12
        assert again["events"]["order_new"]["batch_minutes"] == 15
        with pytest.raises(HTTPException) as e400:
            await event_notify.put_saas_notify_prefs(
                "c1",
                {"events": {"order_new": {"batch_minutes": 7}}},
                _sa(),
            )
        assert e400.value.status_code == 400

    asyncio.run(_run())


def test_saas_notify_prefs_requires_super_admin_dep():
    from fastapi.testclient import TestClient
    from fastapi import FastAPI

    wanted = {
        ("/api/saas/companies/{company_id}/notify-prefs", "GET"),
        ("/api/saas/companies/{company_id}/notify-prefs", "PUT"),
        ("/api/saas/companies/{company_id}/notify-mail-log", "GET"),
    }
    seen = set()
    for route in event_notify.router.routes:
        methods = getattr(route, "methods", None) or set()
        for method in methods:
            seen.add((route.path, method))
            if (route.path, method) not in wanted:
                continue
            calls = []

            def walk(dep):
                calls.append(dep.call)
                for sub in getattr(dep, "dependencies", []) or []:
                    walk(sub)

            for dep in route.dependant.dependencies:
                walk(dep)
            assert saas.require_super_admin in calls
    assert wanted <= seen

    app = FastAPI()
    app.include_router(event_notify.router)
    client = TestClient(app)
    r = client.get("/api/saas/companies/c1/notify-prefs")
    assert r.status_code in (401, 403)
    r2 = client.put("/api/saas/companies/c1/notify-prefs", json={})
    assert r2.status_code in (401, 403)
    r3 = client.get("/api/saas/companies/c1/notify-mail-log")
    assert r3.status_code in (401, 403)


def test_existing_notify_prefs_read_unchanged(setup_en):
    db, _send, _ = setup_en
    db.company_notify_prefs.docs["cnp_c1"] = {
        "_id": "cnp_c1",
        "company_id": "c1",
        "events": {
            "einvoice_incoming": {"inapp": True, "email": False, "sms": False, "digest": "instant"},
            "order_new": {"inapp": True, "email": False, "sms": True, "digest": "hourly", "batch_minutes": 30},
            "gib_credits_low": {"inapp": True, "email": True, "sms": False, "digest": "instant"},
            "receivable_overdue": {"inapp": True, "email": True, "sms": False, "digest": "daily"},
        },
        "extra_emails": ["keep@demo.com"],
        "email_from": "company",
        "gib_credits_threshold": 7,
    }

    async def _run():
        out = await event_notify.get_saas_notify_prefs("c1", _sa())
        assert out["extra_emails"] == ["keep@demo.com"]
        assert out["email_from"] == "company"
        assert out["gib_credits_threshold"] == 7
        assert out["events"]["order_new"]["batch_minutes"] == 30
        assert out["events"]["order_new"]["email"] is False
        assert out["events"]["order_new"]["sms"] is True
        assert out["events"]["einvoice_incoming"]["email"] is False
        assert out["daily_email_cap"] is None
        assert out["events"]["order_new"]["quiet_hours"] == {
            "enabled": False, "start": "22:00", "end": "08:00",
        }
        stored = db.company_notify_prefs.docs["cnp_c1"]
        assert "daily_email_cap" not in stored
        assert "quiet_hours" not in (stored.get("events") or {}).get("order_new", {})

    asyncio.run(_run())


def test_daily_email_cap_defers_email_inapp_goes_next_day_sends(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1")
    db.orders.docs["o2"] = _order("o2")

    async def _run():
        await event_notify.save_prefs("c1", {
            "daily_email_cap": 1,
            "events": {"order_new": {"inapp": True, "email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            r1 = await event_notify.notify_event(
                "c1", "order_new", "Sipariş 1", "m1", link="/orders",
                ref_type="order", ref_id="o1",
            )
            assert r1.get("inapp") is True
            await event_notify.flush_notify_outbox()
            first_sends = send.await_count
            assert first_sends >= 1
            r2 = await event_notify.notify_event(
                "c1", "order_new", "Sipariş 2", "m2", link="/orders",
                ref_type="order", ref_id="o2",
            )
            assert r2.get("inapp") is True
            await event_notify.flush_notify_outbox()
            sent = [d for d in db.notify_outbox.docs.values() if d.get("status") == "sent"]
            deferred = [d for d in db.notify_outbox.docs.values() if d.get("status") == "deferred"]
            assert len(sent) == 1
            assert len(deferred) == 1
            assert send.await_count == first_sends
            inapps = [d for d in db.notifications.docs.values() if d.get("company_id") == "c1"]
            assert len(inapps) >= 2
            usage = await event_notify.notify_email_usage("c1")
            assert usage["sent_24h"] == 1
            assert usage["sent_30d"] == 1
            assert usage["deferred"] == 1
            yesterday = (event_notify._istanbul_day_start() - timedelta(hours=1)).isoformat()
            for d in db.mail_logs.docs.values():
                if d.get("context") == "event_notify":
                    d["created_at"] = yesterday
            for d in sent:
                d["sent_at"] = yesterday
            past = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
            for d in deferred:
                d["next_try_at"] = past
                d["due_at"] = past
            await event_notify.flush_notify_outbox()
            assert send.await_count > first_sends
            leftover = [d for d in db.notify_outbox.docs.values() if d.get("status") == "deferred"]
            assert leftover == []
            usage2 = await event_notify.notify_email_usage("c1")
            assert usage2["deferred"] == 0
            assert usage2["sent_30d"] >= 2

    asyncio.run(_run())


def test_unlimited_email_cap_unchanged(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1")
    db.orders.docs["o2"] = _order("o2")

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"inapp": True, "email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event(
                "c1", "order_new", "S1", "m", link="/orders", ref_type="order", ref_id="o1",
            )
            await event_notify.notify_event(
                "c1", "order_new", "S2", "m", link="/orders", ref_type="order", ref_id="o2",
            )
            await event_notify.flush_notify_outbox()
        assert send.await_count >= 1
        assert not any(d.get("status") == "deferred" for d in db.notify_outbox.docs.values())
        assert all(d.get("status") == "sent" for d in db.notify_outbox.docs.values())

    asyncio.run(_run())


def test_instant_email_defers_when_cap_zero_inapp_still_sent(setup_en):
    db, send, _ = setup_en

    async def _run():
        await event_notify.save_prefs("c1", {
            "daily_email_cap": 0,
            "events": {"einvoice_incoming": {"inapp": True, "email": True, "sms": False, "digest": "instant"}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            res = await event_notify.notify_event(
                "c1", "einvoice_incoming", "Gelen", "msg", link="/edoc-inbox",
                ref_type="edoc", ref_id="e1",
            )
        assert res.get("inapp") is True
        assert (res.get("email") or {}).get("status") == "deferred"
        assert send.await_count == 0
        deferred = [d for d in db.notify_outbox.docs.values() if d.get("status") == "deferred"]
        assert len(deferred) == 1
        inapps = list(db.notifications.docs.values())
        assert inapps

    asyncio.run(_run())


def test_platform_default_email_cap_used_when_company_empty(setup_en):
    db, send, _ = setup_en
    db.platform_settings.docs["platform"] = {
        "_id": "platform", "notify_daily_email_cap_default": 1,
    }
    db.orders.docs["o1"] = _order("o1")
    db.orders.docs["o2"] = _order("o2")

    async def _run():
        assert await event_notify.resolve_daily_email_cap("c1") == 1
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"inapp": True, "email": True, "sms": False, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event(
                "c1", "order_new", "S1", "m", link="/orders", ref_type="order", ref_id="o1",
            )
            await event_notify.flush_notify_outbox()
            await event_notify.notify_event(
                "c1", "order_new", "S2", "m", link="/orders", ref_type="order", ref_id="o2",
            )
            await event_notify.flush_notify_outbox()
        assert any(d.get("status") == "deferred" for d in db.notify_outbox.docs.values())

    asyncio.run(_run())


def test_invalid_daily_email_cap_400(setup_en):
    async def _run():
        with pytest.raises(HTTPException) as ei:
            await event_notify.save_prefs("c1", {"daily_email_cap": -3})
        assert ei.value.status_code == 400
        import saas_billing
        with pytest.raises(HTTPException) as ei2:
            await saas_billing.put_settings({"notify_daily_email_cap_default": "abc"}, {})
        assert ei2.value.status_code == 400

    asyncio.run(_run())


def test_pending_order_card_status_and_summary_escape():
    pending = _order("o1", order_status="pending", customer_name="<script>x</script>")
    approved = _order("o2", order_status="approved")
    preparing = _order("o3", order_status="preparing")
    html = event_notify._order_card_html(pending, "https://app.tamkobi.com/orders?open=o1", "https://app.tamkobi.com", {})
    assert "Onay bekliyor" in html
    assert 'bgcolor="#fef3c7"' in html
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "Onaylı" in event_notify._order_card_html(approved, "", "https://app.tamkobi.com", {})
    assert "Onaylı" in event_notify._order_card_html(preparing, "", "https://app.tamkobi.com", {})
    summary = event_notify._summary_line([pending, approved, preparing])
    assert "1 onay bekliyor" in summary
    assert "onay bekliyor" not in event_notify._summary_line([approved, preparing])
    text = event_notify._order_batch_text("Demo", [pending, approved], {}, {})
    assert "Durum: Onay bekliyor" in text
    assert "Durum: Onaylı" in text
    assert "1 onay bekliyor" in text


def test_stock_warning_uses_loaded_products_no_warning_without_field():
    products = {
        "p1": {"_id": "p1", "company_id": "c1", "name": "Kalem", "stock_quantity": 2},
        "p2": {"_id": "p2", "company_id": "c1", "name": "Yok"},
        "p3": {
            "_id": "p3", "company_id": "c1", "name": "Varyantlı", "stock_quantity": 99,
            "variants": [{"variant_id": "v1", "name": "Kırmızı", "stock": 1}],
        },
    }
    order = _order("o1", items=[
        {"product_id": "p1", "product_name": "Kalem", "quantity": 5, "unit_price": 1, "total": 5},
        {"product_id": "p2", "product_name": "Yok", "quantity": 9, "unit_price": 1, "total": 9},
        {"product_id": "p3", "product_name": "Varyantlı", "variant_id": "v1", "quantity": 2, "unit_price": 1, "total": 2},
    ])
    html = event_notify._order_card_html(order, "", "https://app.tamkobi.com", products)
    assert "Stok yetersiz (mevcut 2)" in html
    assert "Stok yetersiz (mevcut 1)" in html
    assert html.count("Stok yetersiz") == 2
    assert "color:#b91c1c" in html
    summary = event_notify._summary_line([order], products)
    assert "2 kalemde stok yetersiz" in summary
    no_stock = _order("o2", items=[
        {"product_id": "p2", "product_name": "Yok", "quantity": 9, "unit_price": 1, "total": 9},
    ])
    html2 = event_notify._order_card_html(no_stock, "", "https://app.tamkobi.com", products)
    assert "Stok yetersiz" not in html2
    assert "stok yetersiz" not in event_notify._summary_line([no_stock], products)
    text = event_notify._order_batch_text("Demo", [order], {}, products)
    assert "Stok yetersiz (mevcut 2)" in text
    assert "2 kalemde stok yetersiz" in text


def test_quiet_hours_window_overnight_and_same_day():
    qh = {"enabled": True, "start": "22:00", "end": "08:00"}
    night = datetime(2026, 10, 15, 23, 0, tzinfo=event_notify.IST)
    until = event_notify._quiet_hours_until(qh, night)
    local = until.astimezone(event_notify.IST)
    assert (local.hour, local.minute) == (8, 0)
    assert local.date() == date(2026, 10, 16)
    morning = datetime(2026, 10, 16, 7, 0, tzinfo=event_notify.IST)
    until_m = event_notify._quiet_hours_until(qh, morning)
    local_m = until_m.astimezone(event_notify.IST)
    assert local_m.date() == date(2026, 10, 16)
    assert (local_m.hour, local_m.minute) == (8, 0)
    assert event_notify._quiet_hours_until(qh, datetime(2026, 10, 16, 10, 0, tzinfo=event_notify.IST)) is None
    assert event_notify._quiet_hours_until(
        {"enabled": False, "start": "22:00", "end": "08:00"}, night,
    ) is None
    same = {"enabled": True, "start": "12:00", "end": "14:00"}
    until_s = event_notify._quiet_hours_until(same, datetime(2026, 10, 16, 13, 0, tzinfo=event_notify.IST))
    local_s = until_s.astimezone(event_notify.IST)
    assert local_s.date() == date(2026, 10, 16)
    assert (local_s.hour, local_s.minute) == (14, 0)


def _flush_at(send, when_utc, oid="o1"):
    async def _run():
        with patch.object(event_notify, "_now_utc", return_value=when_utc), \
             _mail_patch(send), \
             patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "m", link="/orders",
                ref_type="order", ref_id=oid,
            )
            inapps = list(event_notify._db.notifications.docs.values())
            await event_notify.flush_notify_outbox()
            return inapps
    return asyncio.run(_run())


def test_quiet_hours_flush_defers_overnight_and_morning(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1")

    async def _prep():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {
                "inapp": True, "email": True, "sms": False, "digest": "batch", "batch_minutes": 0,
                "quiet_hours": {"enabled": True, "start": "22:00", "end": "08:00"},
            }},
        })
    asyncio.run(_prep())

    night_utc = datetime(2026, 10, 15, 20, 0, tzinfo=timezone.utc)  # 23:00 IST
    inapps = _flush_at(send, night_utc, "o1")
    assert inapps
    assert send.await_count == 0
    row = next(iter(db.notify_outbox.docs.values()))
    assert row["status"] == "deferred"
    nxt = event_notify._parse_ts(row["next_try_at"]).astimezone(event_notify.IST)
    assert (nxt.year, nxt.month, nxt.day, nxt.hour, nxt.minute) == (2026, 10, 16, 8, 0)

    db.notify_outbox.docs.clear()
    db.notifications.docs.clear()
    db.notify_event_dedupe.docs.clear()
    send.reset_mock()
    db.orders.docs["o2"] = _order("o2")
    morning_utc = datetime(2026, 10, 16, 4, 0, tzinfo=timezone.utc)  # 07:00 IST
    _flush_at(send, morning_utc, "o2")
    assert send.await_count == 0
    row2 = next(iter(db.notify_outbox.docs.values()))
    assert row2["status"] == "deferred"
    nxt2 = event_notify._parse_ts(row2["next_try_at"]).astimezone(event_notify.IST)
    assert (nxt2.year, nxt2.month, nxt2.day, nxt2.hour, nxt2.minute) == (2026, 10, 16, 8, 0)


def test_quiet_hours_outside_sends_and_disabled_unchanged(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1")
    db.orders.docs["o2"] = _order("o2")

    async def _prep_on():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {
                "email": True, "sms": False, "digest": "batch", "batch_minutes": 0,
                "quiet_hours": {"enabled": True, "start": "22:00", "end": "08:00"},
            }},
        })
    asyncio.run(_prep_on())
    day_utc = datetime(2026, 10, 16, 7, 0, tzinfo=timezone.utc)  # 10:00 IST
    _flush_at(send, day_utc, "o1")
    assert send.await_count >= 1
    assert next(iter(db.notify_outbox.docs.values()))["status"] == "sent"

    db.notify_outbox.docs.clear()
    db.notifications.docs.clear()
    db.notify_event_dedupe.docs.clear()
    send.reset_mock()

    async def _prep_off():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {
                "email": True, "sms": False, "digest": "batch", "batch_minutes": 0,
                "quiet_hours": {"enabled": False, "start": "22:00", "end": "08:00"},
            }},
        })
    asyncio.run(_prep_off())
    night_utc = datetime(2026, 10, 15, 20, 0, tzinfo=timezone.utc)
    _flush_at(send, night_utc, "o2")
    assert send.await_count >= 1
    assert next(iter(db.notify_outbox.docs.values()))["status"] == "sent"


def test_invalid_quiet_hours_400(setup_en):
    async def _run():
        with pytest.raises(HTTPException) as ei:
            await event_notify.save_prefs("c1", {
                "events": {"order_new": {"quiet_hours": {"enabled": True, "start": "25:00", "end": "08:00"}}},
            })
        assert ei.value.status_code == 400
        with pytest.raises(HTTPException) as ei2:
            event_notify._norm_event_prefs({
                "order_new": {"quiet_hours": {"enabled": True, "start": "22:00", "end": "8:00"}},
            })
        assert ei2.value.status_code == 400
        with pytest.raises(HTTPException) as ei3:
            event_notify._norm_event_prefs({"order_new": {"quiet_hours": "gece"}})
        assert ei3.value.status_code == 400

    asyncio.run(_run())


def test_company_admin_cannot_write_quiet_hours(setup_en):
    async def _run():
        admin = {"_id": "u_admin", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}
        with pytest.raises(HTTPException) as ei:
            await event_notify.put_notify_prefs_route(
                {"company_id": "c1", "events": {"order_new": {
                    "quiet_hours": {"enabled": True, "start": "22:00", "end": "08:00"},
                }}},
                user=admin,
            )
        assert ei.value.status_code == 403
        assert ei.value.detail == event_notify.COMPANY_NOTIFY_FORBIDDEN
        saved = await event_notify.put_saas_notify_prefs(
            "c1",
            {"events": {"order_new": {
                "inapp": True, "email": True, "sms": False, "digest": "batch",
                "quiet_hours": {"enabled": True, "start": "22:00", "end": "08:00"},
            }}},
            _sa(),
        )
        assert saved["events"]["order_new"]["quiet_hours"]["enabled"] is True
        assert saved["events"]["order_new"]["quiet_hours"]["start"] == "22:00"

    asyncio.run(_run())


def test_notify_mail_log_super_admin_scoped(setup_en):
    db, _send, _ = setup_en
    db.mail_logs.docs["nl1"] = {
        "_id": "nl1", "company_id": "c1", "context": "event_notify", "status": "sent",
        "to": ["admin@demo.com"], "subject": "Sipariş A",
        "created_at": "2026-10-15T12:00:00+00:00",
    }
    db.mail_logs.docs["nl2"] = {
        "_id": "nl2", "company_id": "c2", "context": "event_notify", "status": "sent",
        "to": ["x@other.com"], "subject": "Başka firma",
        "created_at": "2026-10-15T13:00:00+00:00",
    }
    db.mail_logs.docs["nl3"] = {
        "_id": "nl3", "company_id": "c1", "context": "invoice", "status": "sent",
        "to": ["admin@demo.com"], "subject": "Fatura",
        "created_at": "2026-10-15T14:00:00+00:00",
    }
    db.notify_outbox.docs["d1"] = {
        "_id": "d1", "company_id": "c1", "status": "deferred", "event": "order_new",
        "title": "Yeni sipariş", "next_try_at": "2026-10-16T05:00:00+00:00",
        "created_at": "2026-10-15T20:00:00+00:00",
    }
    db.notify_outbox.docs["d2"] = {
        "_id": "d2", "company_id": "c2", "status": "deferred", "event": "order_new",
        "next_try_at": "2026-10-16T05:00:00+00:00",
        "created_at": "2026-10-15T20:00:00+00:00",
    }

    async def _run():
        with pytest.raises(HTTPException) as e404:
            await event_notify.get_saas_notify_mail_log("missing", 50, _sa())
        assert e404.value.status_code == 404
        out = await event_notify.get_saas_notify_mail_log("c1", 50, _sa())
        sent_ids = [r["id"] for r in out["sent"]]
        assert sent_ids == ["nl1"]
        assert out["sent"][0]["recipients"] == "admin@demo.com"
        assert out["sent"][0]["subject"] == "Sipariş A"
        assert out["sent"][0]["status"] == "sent"
        assert out["sent"][0]["date_tr"]
        def_ids = [r["id"] for r in out["deferred"]]
        assert def_ids == ["d1"]
        assert out["deferred"][0]["status"] == "deferred"
        assert out["deferred"][0]["next_try_at"]
        assert "08:00" in out["deferred"][0]["next_try_at_tr"]
        too_many = await event_notify.get_saas_notify_mail_log("c1", 999, _sa())
        assert len(too_many["sent"]) <= 200

    asyncio.run(_run())


def _admin_user():
    return {
        "_id": "u_admin", "id": "u_admin", "name": "Admin",
        "company_ids": ["c1"], "active_company_id": "c1", "role": "admin",
    }


def _sales_user():
    return {
        "_id": "u_sales", "id": "u_sales", "name": "Satış",
        "company_ids": ["c1"], "active_company_id": "c1", "role": "sales",
    }


def _req(company_id=None):
    req = MagicMock()
    req.query_params = {}
    if company_id:
        req.query_params["company_id"] = company_id
    return req


def test_effective_channel_ands_only_inapp_and_email():
    prefs = event_notify.default_prefs("c1")
    order = prefs["events"]["order_new"]
    order["sms"] = True
    order["digest"] = "batch"
    order["batch_minutes"] = 15
    order["quiet_hours"] = {"enabled": True, "start": "22:00", "end": "08:00"}
    tenant = event_notify.default_tenant("c1")
    tenant["events"]["order_new"]["email"] = False
    tenant["events"]["order_new"]["inapp"] = False
    ch = event_notify.effective_channel(prefs, tenant, "order_new")
    assert ch["email"] is False
    assert ch["inapp"] is False
    assert ch["sms"] is True
    assert ch["digest"] == "batch"
    assert ch["batch_minutes"] == 15
    assert ch["quiet_hours"]["enabled"] is True
    assert prefs["events"]["order_new"]["email"] is True
    assert prefs["events"]["order_new"]["inapp"] is True
    open_ch = event_notify.effective_channel(prefs, None, "order_new")
    assert open_ch["email"] is True
    assert open_ch["inapp"] is True
    assert open_ch["sms"] is True


def test_notify_event_without_tenant_record_matches_today(setup_en):
    db, send, _ = setup_en

    async def _run():
        assert db.company_notify_tenant.docs == {}
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            return await event_notify.notify_event(
                "c1", "einvoice_incoming", "Belge", "msg",
                link="/edoc-inbox", dedupe_key="einv:notenant",
            )

    res = asyncio.run(_run())
    assert res["status"] == "ok"
    assert res["inapp"] is True
    assert (res.get("email") or {}).get("status") == "sent"
    assert send.await_count == 1
    assert db.company_notify_tenant.docs == {}
    assert any(n.get("type") == "einvoice_incoming" for n in db.notifications.docs.values())


def test_tenant_email_off_skips_mail_and_queue_inapp_stays(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1")

    async def _run():
        await event_notify.save_tenant_prefs("c1", {
            "einvoice_incoming": {"email": False},
            "order_new": {"email": False},
        }, _admin_user())
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            einv = await event_notify.notify_event(
                "c1", "einvoice_incoming", "Belge", "msg", dedupe_key="einv:mailoff",
            )
            order = await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                ref_type="order", ref_id="o1", dedupe_key="order:o1",
            )
            return einv, order

    einv, order = asyncio.run(_run())
    assert einv["inapp"] is True
    assert einv.get("email") is None
    assert order["inapp"] is True
    assert order.get("queued") is False
    assert send.await_count == 0
    assert db.notify_outbox.docs == {}
    assert any(n.get("type") == "einvoice_incoming" for n in db.notifications.docs.values())
    assert any(n.get("type") == "order_new" for n in db.notifications.docs.values())


def test_tenant_inapp_off_writes_no_notification(setup_en):
    db, send, _ = setup_en

    async def _run():
        await event_notify.save_tenant_prefs(
            "c1", {"einvoice_incoming": {"inapp": False}}, _admin_user(),
        )
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            return await event_notify.notify_event(
                "c1", "einvoice_incoming", "Belge", "msg", dedupe_key="einv:inappoff",
            )

    res = asyncio.run(_run())
    assert res["inapp"] is False
    assert (res.get("email") or {}).get("status") == "sent"
    assert send.await_count == 1
    assert not any(n.get("type") == "einvoice_incoming" for n in db.notifications.docs.values())


def test_platform_email_off_tenant_true_does_not_send(setup_en):
    db, send, _ = setup_en

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"einvoice_incoming": {"inapp": True, "email": False, "sms": False}},
        })
        await event_notify.save_tenant_prefs(
            "c1", {"einvoice_incoming": {"email": True}}, _admin_user(),
        )
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            res = await event_notify.notify_event(
                "c1", "einvoice_incoming", "Belge", "msg", dedupe_key="einv:plat-off",
            )
            view = await event_notify.tenant_prefs_view("c1")
            return res, view

    res, view = asyncio.run(_run())
    assert res["inapp"] is True
    assert res.get("email") is None
    assert send.await_count == 0
    email = view["events"]["einvoice_incoming"]["email"]
    assert email == {"platform": False, "tenant": True, "effective": False}


def test_queued_order_skipped_when_tenant_closes_email(setup_en):
    db, send, _ = setup_en
    db.orders.docs["o1"] = _order("o1")

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"inapp": True, "email": True, "sms": True, "digest": "batch", "batch_minutes": 0}},
        })
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            res = await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                ref_type="order", ref_id="o1", dedupe_key="order:o1",
            )
            assert res.get("queued") is True
            assert send.await_count == 0
            await event_notify.save_tenant_prefs(
                "c1", {"order_new": {"email": False}}, _admin_user(),
            )
            await event_notify.flush_notify_outbox()

    asyncio.run(_run())
    assert send.await_count == 0
    row = next(iter(db.notify_outbox.docs.values()))
    assert row["status"] == "skipped"


def test_tenant_prefs_put_whitelist_and_access(setup_en):
    db, _, _ = setup_en
    admin = _admin_user()
    sales = _sales_user()

    async def _run():
        req = _req()
        for body in (
            {"events": {"order_new": {"sms": True}}},
            {"events": {"order_new": {"digest": "hourly"}}},
            {"extra_emails": ["a@b.com"]},
            {"events": {"order_new": {"email": False, "quiet_hours": {"enabled": True}}}},
            {"daily_email_cap": 3, "events": {"order_new": {"email": False}}},
        ):
            with pytest.raises(HTTPException) as ei:
                await event_notify.put_notify_tenant_prefs_route(body, req, admin)
            assert ei.value.status_code == 422
            assert ei.value.detail == event_notify.PLATFORM_ONLY_DETAIL
        for body in (
            {"events": {"order_new": {"email": "hayir"}}},
            {"events": {"order_new": {"inapp": 1}}},
            {"events": {"order_new": {"email": 0}}},
        ):
            with pytest.raises(HTTPException) as ei:
                await event_notify.put_notify_tenant_prefs_route(body, req, admin)
            assert ei.value.status_code == 422
            assert ei.value.detail == event_notify.TENANT_BOOL_DETAIL
        assert db.company_notify_tenant.docs == {}
        with pytest.raises(HTTPException) as denied:
            await event_notify.put_notify_tenant_prefs_route(
                {"events": {"order_new": {"email": False}}}, req, sales,
            )
        assert denied.value.status_code == 403
        with pytest.raises(HTTPException) as prefs_denied:
            await event_notify.put_notify_prefs_route(
                {"company_id": "c1", "extra_emails": ["x@y.com"]}, user=admin,
            )
        assert prefs_denied.value.status_code == 403
        assert prefs_denied.value.detail == event_notify.COMPANY_NOTIFY_FORBIDDEN
        with pytest.raises(HTTPException) as other:
            await event_notify.put_notify_tenant_prefs_route(
                {"company_id": "c2", "events": {"order_new": {"email": False}}}, req, admin,
            )
        assert other.value.status_code in (403, 404)
        sa = {
            "id": "sa1", "_id": "sa1", "name": "Süper", "is_super_admin": True,
            "company_ids": ["c1"], "active_company_id": "c1", "role": "admin",
        }
        with pytest.raises(HTTPException) as missing:
            await event_notify.put_notify_tenant_prefs_route(
                {"company_id": "missing", "events": {"order_new": {"email": False}}}, req, sa,
            )
        assert missing.value.status_code == 404
        with pytest.raises(HTTPException) as cross:
            await event_notify.get_notify_tenant_prefs_route(_req("c2"), company_id="c2", user=sales)
        assert cross.value.status_code in (403, 404)
        got = await event_notify.get_notify_tenant_prefs_route(_req("c1"), company_id="c1", user=sales)
        assert set(got) == {"events", "labels"}
        assert got["labels"]["order_new"] == "Yeni sipariş"
        assert got["events"]["gib_credits_low"]["inapp"]["effective"] is True
        saved = await event_notify.put_notify_tenant_prefs_route(
            {"events": {"order_new": {"email": False, "inapp": False}}}, req, admin,
        )
        assert saved["events"]["order_new"]["email"]["tenant"] is False
        assert saved["events"]["order_new"]["email"]["effective"] is False
        assert saved["events"]["order_new"]["inapp"]["tenant"] is False
        assert saved["events"]["einvoice_incoming"]["email"]["tenant"] is True
        doc = db.company_notify_tenant.docs["cnt_c1"]
        assert doc["company_id"] == "c1"
        assert doc["updated_by"] == "u_admin"
        assert doc["events"]["order_new"] == {"inapp": False, "email": False}
        assert set(doc["events"]) == set(event_notify.TENANT_EVENTS)
        assert db.company_notify_prefs.docs == {}
        audits = list(db.company_audit_log.docs.values())
        assert len(audits) == 1
        assert audits[0]["company_id"] == "c1"
        assert audits[0]["action"] == "update"
        assert audits[0]["path"] == "/api/notify/tenant-prefs"
        assert audits[0]["record_id"] == "cnt_c1"
        assert audits[0]["user_id"] == "u_admin"

    asyncio.run(_run())


def test_platform_put_keeps_tenant_prefs(setup_en):
    db, _, _ = setup_en

    async def _run():
        await event_notify.save_tenant_prefs(
            "c1", {"order_new": {"email": False, "inapp": True}}, _admin_user(),
        )
        before = dict(db.company_notify_tenant.docs["cnt_c1"]["events"])
        await event_notify.put_saas_notify_prefs(
            "c1",
            {
                "extra_emails": ["ynt@demo.com"],
                "events": {"order_new": {"inapp": True, "email": True, "sms": True, "digest": "batch", "batch_minutes": 5}},
            },
            _sa(),
        )
        await event_notify.save_prefs("c1", {"extra_emails": ["again@demo.com"]})
        stored = db.company_notify_tenant.docs["cnt_c1"]["events"]
        assert stored == before
        assert stored["order_new"]["email"] is False
        prefs = await event_notify.get_prefs("c1")
        assert "again@demo.com" in prefs["extra_emails"]
        assert prefs["events"]["order_new"]["sms"] is True
        assert "cnt_c1" in db.company_notify_tenant.docs

    asyncio.run(_run())


def test_order_batch_reads_tenant_once(setup_en):
    db, send, _ = setup_en
    calls = {"n": 0}
    orig = db.company_notify_tenant.find_one

    async def _wrapped(*args, **kwargs):
        calls["n"] += 1
        return await orig(*args, **kwargs)

    db.company_notify_tenant.find_one = _wrapped

    async def _run():
        three = [_order(f"o{i}") for i in range(1, 4)]
        for row in three:
            db.orders.docs[row["_id"]] = row
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            calls["n"] = 0
            await event_notify.notify_orders_batch("c1", three)
            assert calls["n"] == 1
            six = [_order(f"b{i}", order_number=f"N{i}") for i in range(6)]
            calls["n"] = 0
            await event_notify.notify_orders_batch("c1", six)
            assert calls["n"] == 1
            calls["n"] = 0
            await event_notify.notify_einvoice_batch("c1", [
                {"id": "e1", "uuid": "u1", "supplier": {"name": "A"}, "grand_total": 1},
                {"id": "e2", "uuid": "u2", "supplier": {"name": "B"}, "grand_total": 2},
            ])
            assert calls["n"] == 1

    asyncio.run(_run())

