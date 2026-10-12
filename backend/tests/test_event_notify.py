"""event_notify: e-fatura / sipariş / kontör / vade + tercihler + tenant izolasyonu."""
from __future__ import annotations

import asyncio
from datetime import date
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
            if all(d.get(k) == v for k, v in filt.items() if not str(k).startswith("$")):
                doc = d
                break
        if doc is None and filt.get("_id") in self.docs:
            doc = self.docs[filt["_id"]]
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

    async def update_many(self, filt, upd):
        n = 0
        ids = (filt.get("_id") or {}).get("$in") if isinstance(filt.get("_id"), dict) else None
        for d in self.docs.values():
            if ids is not None and d["_id"] not in ids:
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
    """email_from=company → Reply-To şirket; gönderim yine send_mail (SES/platform)."""
    db, send, mail_acc = setup_en
    mail_acc.side_effect = HTTPException(status_code=409, detail="reauth")

    async def _run():
        await event_notify.save_prefs("c1", {"email_from": "company"})
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            res = await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                dedupe_key="order:fb:1",
            )
            return res

    res = asyncio.run(_run())
    assert res.get("email", {}).get("status") == "sent"
    assert send.await_count == 1
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
    db, send, mail_acc = setup_en
    send.side_effect = AsyncMock(return_value={"status": "failed", "error": "smtp fail", "driver": "platform_smtp"})

    async def _run():
        await event_notify.save_prefs("c1", {"email_from": "company"})
        with _mail_patch(send), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            return await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                dedupe_key="order:sendfail:1",
            )

    res = asyncio.run(_run())
    assert res.get("email", {}).get("status") == "failed"
    assert "smtp fail" in (res.get("email", {}).get("detail") or "")
    assert send.await_count == 1
