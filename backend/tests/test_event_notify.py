"""event_notify: e-fatura / sipariş / kontör / vade + tercihler + tenant izolasyonu."""
from __future__ import annotations

import asyncio
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import event_notify
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
            # company_ids: value in list
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
    db.companies = FakeColl([{"_id": "c1", "name": "Demo A.Ş."}, {"_id": "c2", "name": "Other"}])
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
    return db


@pytest.fixture
def setup_en():
    db = _db()
    smtp = AsyncMock()
    mail_acc = AsyncMock(return_value={
        "email": "firma@demo.com", "smtp_host": "smtp.firma.com", "smtp_port": 587,
        "smtp_user": "firma@demo.com", "password": "secret",
    })
    event_notify.init(db, {"mail_account": mail_acc, "smtp_send": smtp}, get_current_user=AsyncMock())
    return db, smtp, mail_acc


def test_type_roles_include_new_events():
    assert notify.roles_for_type("einvoice_incoming") == ["admin", "manager", "accountant"]
    assert notify.roles_for_type("order_new") == ["admin", "manager", "sales"]
    assert notify.roles_for_type("gib_credits_low") == ["admin"]
    assert notify.roles_for_type("receivable_overdue") == ["admin", "accountant"]


def test_new_einvoice_notifies_once_and_emails(setup_en):
    db, smtp, _ = setup_en

    async def _run():
        with patch.object(event_notify.platform_mail, "resolve_smtp_account", AsyncMock(return_value={
            "email": "sys@tamkobi.com", "smtp_host": "smtp.platform", "password": "p",
        })), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
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
    assert smtp.await_count == 1
    args = smtp.await_args
    assert "admin@demo.com" in args.args[1] or "muhasebe@demo.com" in args.args[1]
    body = " ".join(str(a) for a in args.args) + str(args.kwargs)
    assert "127.0.0.1" not in body and "localhost" not in body


def test_orders_two_vs_summary(setup_en):
    db, smtp, _ = setup_en

    async def _run():
        with patch.object(event_notify.platform_mail, "resolve_smtp_account", AsyncMock(return_value={
            "email": "sys@tamkobi.com", "smtp_host": "s", "password": "p",
        })), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
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
    # 2 individual + 1 summary
    assert len(order_notes) == 3
    assert any("10 yeni sipariş" in (n.get("title") or "") for n in order_notes)


def test_prefs_email_off_no_email(setup_en):
    db, smtp, _ = setup_en

    async def _run():
        await event_notify.save_prefs("c1", {
            "events": {"order_new": {"inapp": True, "email": False, "sms": False, "digest": "instant"}},
        })
        with patch.object(event_notify.platform_mail, "resolve_smtp_account", AsyncMock(return_value={
            "email": "sys@tamkobi.com", "smtp_host": "s", "password": "p",
        })), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                dedupe_key="order:t:1",
            )

    asyncio.run(_run())
    assert smtp.await_count == 0
    assert any(n.get("type") == "order_new" for n in db.notifications.docs.values())


def test_company_smtp_decrypt_fail_falls_back_platform(setup_en):
    db, smtp, mail_acc = setup_en
    mail_acc.side_effect = HTTPException(status_code=409, detail="reauth")

    async def _run():
        await event_notify.save_prefs("c1", {"email_from": "company"})
        with patch.object(event_notify.platform_mail, "resolve_smtp_account", AsyncMock(return_value={
            "email": "sys@tamkobi.com", "smtp_host": "s", "password": "p",
        })), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            res = await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                dedupe_key="order:fb:1",
            )
            return res

    res = asyncio.run(_run())
    assert res.get("email", {}).get("status") == "sent"
    assert res.get("email", {}).get("via") == "platform"
    assert smtp.await_count == 1
    assert smtp.await_args.args[0]["email"] == "sys@tamkobi.com"


def test_kontor_warning_once_per_day(setup_en):
    db, smtp, _ = setup_en

    async def _run():
        with patch.object(event_notify.platform_mail, "resolve_smtp_account", AsyncMock(return_value={
            "email": "sys@tamkobi.com", "smtp_host": "s", "password": "p",
        })), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            r1 = await event_notify.maybe_gib_credits_low("c1", 5, threshold=20)
            r2 = await event_notify.maybe_gib_credits_low("c1", 3, threshold=20)
            return r1, r2

    r1, r2 = asyncio.run(_run())
    assert r1.get("status") == "ok"
    assert r2.get("status") == "duplicate"
    assert sum(1 for n in db.notifications.docs.values() if n.get("type") == "gib_credits_low") == 1


def test_overdue_summary_admin_accountant_roles(setup_en):
    db, smtp, _ = setup_en
    today = date.today().isoformat()
    db.invoices.docs["inv1"] = {
        "_id": "inv1", "company_id": "c1", "invoice_type": "sales",
        "payment_status": "unpaid", "status": "approved",
        "due_date": "2020-01-01", "grand_total": 500, "paid_amount": 0,
        "invoice_number": "SF-1",
    }

    async def _run():
        with patch.object(event_notify.platform_mail, "resolve_smtp_account", AsyncMock(return_value={
            "email": "sys@tamkobi.com", "smtp_host": "s", "password": "p",
        })), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            return await event_notify.run_receivable_overdue()

    res = asyncio.run(_run())
    assert res["sent"] >= 1
    notes = [n for n in db.notifications.docs.values() if n.get("type") == "receivable_overdue"]
    assert notes
    assert set(notes[0].get("roles") or []) == {"admin", "accountant"}
    # sales role not in TYPE_ROLES for this event
    assert "sales" not in (notes[0].get("roles") or [])
    assert smtp.await_count >= 1
    emailed = smtp.await_args.args[1]
    assert "admin@demo.com" in emailed
    assert "muhasebe@demo.com" in emailed
    assert "satis@demo.com" not in emailed
    _ = today  # silence unused in some runners


def test_links_no_localhost(setup_en):
    _, smtp, _ = setup_en

    async def _run():
        with patch.object(event_notify.platform_mail, "resolve_smtp_account", AsyncMock(return_value={
            "email": "sys@tamkobi.com", "smtp_host": "s", "password": "p",
        })), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            await event_notify.notify_event(
                "c1", "einvoice_incoming", "Belge", "msg", link="/edoc-inbox",
                dedupe_key="einv:linktest",
            )
            # Even if env is bad, absolute link must not be localhost
            link = await event_notify.app_link("/orders")
            assert "127.0.0.1" not in link
            assert "localhost" not in link
            assert link.startswith("https://")

    asyncio.run(_run())
    body = str(smtp.await_args)
    assert "127.0.0.1" not in body
    assert "localhost" not in body
    assert "app.tamkobi.com" in body


def test_prefs_api_tenant_isolation(setup_en):
    db, _, _ = setup_en

    async def _run():
        user_c1 = {"_id": "u_admin", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}
        # resolve_company_id raises 403 for foreign company
        with pytest.raises(HTTPException) as ei:
            from tenant_access import resolve_company_id
            resolve_company_id(user_c1, "c2")
        assert ei.value.status_code == 403
        # save for own company ok
        saved = await event_notify.save_prefs("c1", {"extra_emails": ["extra@demo.com"]})
        assert saved["company_id"] == "c1"
        assert "extra@demo.com" in saved["extra_emails"]
        # get prefs for c2 is empty defaults, not c1's
        other = await event_notify.get_prefs("c2")
        assert other["company_id"] == "c2"
        assert other.get("extra_emails") == []

    asyncio.run(_run())


def test_company_smtp_send_error_falls_back(setup_en):
    db, smtp, mail_acc = setup_en
    mail_acc.return_value = {
        "email": "firma@demo.com", "smtp_host": "smtp.firma.com", "password": "x",
    }
    # first call (company) fails, second (platform) ok
    smtp.side_effect = [Exception("smtp fail"), None]

    async def _run():
        await event_notify.save_prefs("c1", {"email_from": "company"})
        with patch.object(event_notify.platform_mail, "resolve_smtp_account", AsyncMock(return_value={
            "email": "sys@tamkobi.com", "smtp_host": "s", "password": "p",
        })), patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})), \
             patch.object(public_url, "public_base_url_for", AsyncMock(return_value="https://app.tamkobi.com")):
            return await event_notify.notify_event(
                "c1", "order_new", "Sipariş", "msg", link="/orders",
                dedupe_key="order:sendfail:1",
            )

    res = asyncio.run(_run())
    assert res.get("email", {}).get("status") == "sent"
    assert res.get("email", {}).get("via") == "platform_fallback"
    assert smtp.await_count == 2
