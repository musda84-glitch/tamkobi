"""Bildirim hedefi: kayıt anında type+id+route, eski kayıtta okuma anında tahmin."""
import asyncio

from notify import (
    MISSING_RECORD,
    bank_movement_target,
    build_notification_target,
    infer_notification_target,
    notification_doc,
    present_notification,
    resolve_notification_open,
)


class _Col:
    def __init__(self, docs):
        self.docs = list(docs)

    async def find_one(self, query):
        for doc in self.docs:
            if _match(doc, query):
                return doc
        return None

    def find(self, query):
        rows = [d for d in self.docs if _match(d, query)]

        class _Cursor:
            async def to_list(self, limit):
                return rows[:limit]

        return _Cursor()


def _match(doc, query):
    if not query:
        return True
    for key, val in query.items():
        if doc.get(key) != val:
            return False
    return True


class _Db:
    def __init__(self, **cols):
        for name, docs in cols.items():
            setattr(self, name, _Col(docs))


def test_new_order_invoice_contact_payment_task_targets():
    order = notification_doc("c1", "order_new", "Yeni sipariş", "WEB", ref_type="order", ref_id="ord-1", link="/orders")
    assert order["target"] == {"type": "order", "id": "ord-1", "route": "/orders?open=ord-1"}
    assert order["link"] == "/orders"

    invoice = build_notification_target("receivable_overdue", ref_type="invoice", ref_id="inv-9")
    assert invoice["route"] == "/invoices?open=inv-9"

    contact = build_notification_target("", ref_type="contact", ref_id="car-1")
    assert contact == {"type": "contact", "id": "car-1", "route": "/contacts?contact_id=car-1"}

    payment = build_notification_target("", ref_type="payment", ref_id="pay-3")
    assert payment["route"] == "/expenses?open=pay-3"

    task = notification_doc(
        "c1", "task_assigned", "Göreve atandı", "Ali",
        ref_type="task", ref_id="task-7",
        extra={"project_id": "proj-2"},
    )
    assert task["target"]["type"] == "task"
    assert task["target"]["id"] == "task-7"
    assert "tab=gorevler" in task["target"]["route"]
    assert "task=task-7" in task["target"]["route"]
    assert "project=proj-2" in task["target"]["route"]


def test_bank_movement_target_highlights_pending_tx():
    target = bank_movement_target(account_id="acc-1", tx_id="tx-9", account_name="Enpara", pending=True)
    assert target["type"] == "bank_tx"
    assert target["id"] == "tx-9"
    assert "account_id=acc-1" in target["route"]
    assert "tx=tx-9" in target["route"]
    assert "pending=1" in target["route"]
    saved = notification_doc(
        "c1", "bank_sync", "1 yeni banka hareketi", "Enpara: 1 yeni hareket (1 eşleşme bekliyor).",
        link=target["route"], ref_type="bank_tx", ref_id="tx-9", target=target,
    )
    assert saved["target"] == target


def test_einvoice_target_keeps_ettn():
    target = build_notification_target(
        "einvoice_incoming",
        message="1.250,00 ₺ · ETTN aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        link="/edoc-inbox?ettn=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&id=doc-1",
        ref_type="edoc",
        ref_id="doc-1",
    )
    assert target["type"] == "edoc"
    assert target["id"] == "doc-1"
    assert "ettn=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" in target["route"]
    assert target["route"].startswith("/edoc-inbox?")


def test_legacy_notes_infer_without_mutating():
    bank = {
        "_id": "n-old-bank",
        "type": "bank_sync",
        "title": "2 yeni banka hareketi",
        "message": "Vadesiz TL Hesabı: 2 yeni hareket (1 eşleşme bekliyor).",
        "link": "/banking?tab=match",
        "ref_type": "bank",
        "ref_id": "acc-44",
    }
    original = dict(bank)
    shown = present_notification(bank)
    assert bank == original
    assert shown["target"]["type"] == "bank_account"
    assert shown["target"]["id"] == "acc-44"
    assert "pending=1" in shown["target"]["route"]
    assert "account_id=acc-44" in shown["target"]["route"]

    edoc = {
        "type": "einvoice_incoming",
        "title": "Gelen e-belge",
        "message": "250,00 ₺ · ETTN abcdef12-3456…",
        "link": "/edoc-inbox",
        "ref_type": "edoc",
    }
    guessed = infer_notification_target(edoc)
    assert guessed["type"] == "edoc"
    assert guessed["route"].startswith("/edoc-inbox?ettn=abcdef12-3456")
    assert "target" not in edoc

    named = infer_notification_target({
        "type": "bank_sync",
        "title": "1 yeni banka hareketi",
        "message": "Enpara",
        "link": "/banking",
    })
    assert "account=Enpara" in named["route"]


def test_deleted_target_reports_missing_without_write():
    db = _Db(
        orders=[{"_id": "ord-1", "company_id": "c1"}],
        incoming_edocs=[{"_id": "doc-1", "company_id": "c1", "uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}],
        bank_accounts=[{"_id": "acc-1", "company_id": "c1", "account_name": "Vadesiz TL Hesabı"}],
        bank_transactions=[{"_id": "tx-1", "company_id": "c1", "account_id": "acc-1", "match_status": "unmatched"}],
        projects=[{"_id": "proj-1", "company_id": "c1", "tasks": [{"id": "task-1", "title": "Kes"}]}],
    )
    note = {"company_id": "c1", "type": "order_new", "ref_type": "order", "ref_id": "missing", "link": "/orders"}

    async def _run():
        missing = await resolve_notification_open(db, note)
        assert missing["exists"] is False
        assert missing["message"] == MISSING_RECORD
        alive = await resolve_notification_open(db, {**note, "ref_id": "ord-1"})
        assert alive["exists"] is True
        assert alive["target"]["route"] == "/orders?open=ord-1"
        edoc = await resolve_notification_open(db, {
            "company_id": "c1",
            "type": "einvoice_incoming",
            "message": "ETTN aaaaaaaa-bbbb",
            "link": "/edoc-inbox",
            "ref_type": "edoc",
        })
        assert edoc["exists"] is True
        assert edoc["target"]["id"] == "doc-1"
        assert "ettn=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" in edoc["target"]["route"]
        gone = await resolve_notification_open(db, {
            "company_id": "c1",
            "type": "einvoice_incoming",
            "message": "ETTN ffffffff-ffff",
            "ref_type": "edoc",
            "ref_id": "nope",
        })
        assert gone["exists"] is False
        bank = await resolve_notification_open(db, {
            "company_id": "c1",
            "type": "bank_sync",
            "message": "Vadesiz TL Hesabı: 1 yeni hareket (1 eşleşme bekliyor).",
            "link": "/banking?tab=match",
        })
        assert bank["exists"] is True
        assert bank["target"]["id"] == "acc-1"
        tx = await resolve_notification_open(db, {
            "company_id": "c1",
            "type": "bank_sync",
            "target": {"type": "bank_tx", "id": "tx-1", "route": "/banking?pending=1&account_id=acc-1&tx=tx-1"},
        })
        assert tx["exists"] is True
        assert tx["target"]["id"] == "tx-1"
        lost_tx = await resolve_notification_open(db, {
            "company_id": "c1",
            "type": "bank_sync",
            "target": {"type": "bank_tx", "id": "tx-gone", "route": "/banking?tx=tx-gone"},
        })
        assert lost_tx["exists"] is False
        task = await resolve_notification_open(db, {
            "company_id": "c1",
            "type": "task_assigned",
            "ref_type": "task",
            "ref_id": "task-1",
            "project_id": "proj-1",
        })
        assert task["exists"] is True
        lost_task = await resolve_notification_open(db, {
            "company_id": "c1",
            "type": "task_assigned",
            "ref_type": "task",
            "ref_id": "task-x",
            "project_id": "proj-1",
        })
        assert lost_task["message"] == MISSING_RECORD

    asyncio.run(_run())
    assert not hasattr(note, "mutated")
