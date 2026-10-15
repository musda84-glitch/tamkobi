"""Kağıt fatura einvoice_state=sent → paper migration (yalnız boş GİB kimliği)."""
import asyncio
import logging

import e_invoice


class _Coll:
    def __init__(self, rows):
        self.rows = rows
        self.updates = []

    def find(self, query):
        self.query = query
        return self

    async def to_list(self, _n):
        q = self.query
        return [
            r for r in self.rows
            if r.get("e_type") == q.get("e_type") and r.get("einvoice_state") == q.get("einvoice_state")
        ]

    async def update_one(self, query, update):
        self.updates.append((query, update))
        for row in self.rows:
            if row.get("_id") != query.get("_id"):
                continue
            if row.get("e_type") != query.get("e_type") or row.get("einvoice_state") != query.get("einvoice_state"):
                continue
            row.update(update.get("$set") or {})
        return {"modified": 1}


class _DB:
    def __init__(self, rows):
        self.invoices = _Coll(rows)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_migration_rewrites_only_paper_sent_without_gib_ids(caplog):
    rows = [
        {"_id": "paper-sent", "e_type": "paper", "einvoice_state": "sent", "gib_status": "Kağıt Fatura (Matbu)", "invoice_number": "TA2026000000069"},
        {"_id": "paper-uuid", "e_type": "paper", "einvoice_state": "sent", "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "invoice_number": "TA9"},
        {"_id": "paper-gibno", "e_type": "paper", "einvoice_state": "sent", "gib_invoice_id": "GIB1", "invoice_number": "TA8"},
        {"_id": "paper-draft", "e_type": "paper", "einvoice_state": "draft", "invoice_number": "TA7"},
        {"_id": "earchive-sent", "e_type": "e_archive", "einvoice_state": "sent", "gib_uuid": "u-real", "invoice_number": "U05"},
        {"_id": "paper-blank-uuid", "e_type": "paper", "einvoice_state": "sent", "gib_uuid": "  ", "gib_invoice_id": None, "status": "approved"},
    ]
    db = _DB(rows)
    with caplog.at_level(logging.INFO, logger="tamkobi.e_invoice"):
        n = _run(e_invoice.migrate_mislabelled_paper_invoices(db))
    assert n == 2
    by_id = {r["_id"]: r for r in rows}
    assert by_id["paper-sent"]["einvoice_state"] == "paper"
    assert by_id["paper-sent"]["gib_status"] == "Kağıt Fatura (Matbu)"
    assert by_id["paper-sent"]["invoice_number"] == "TA2026000000069"
    assert by_id["paper-blank-uuid"]["einvoice_state"] == "paper"
    assert by_id["paper-blank-uuid"]["status"] == "approved"
    assert by_id["paper-uuid"]["einvoice_state"] == "sent"
    assert by_id["paper-gibno"]["einvoice_state"] == "sent"
    assert by_id["paper-draft"]["einvoice_state"] == "draft"
    assert by_id["earchive-sent"]["einvoice_state"] == "sent"
    sets = [u["$set"] for _q, u in db.invoices.updates]
    assert sets == [{"einvoice_state": "paper"}, {"einvoice_state": "paper"}]
    assert "paper-sent" in caplog.text
    assert "sent → paper" in caplog.text


def test_migration_is_idempotent(caplog):
    rows = [
        {"_id": "paper-sent", "e_type": "paper", "einvoice_state": "sent", "invoice_number": "TA1"},
    ]
    db = _DB(rows)
    assert _run(e_invoice.migrate_mislabelled_paper_invoices(db)) == 1
    with caplog.at_level(logging.INFO, logger="tamkobi.e_invoice"):
        assert _run(e_invoice.migrate_mislabelled_paper_invoices(db)) == 0
    assert rows[0]["einvoice_state"] == "paper"
    assert len(db.invoices.updates) == 1
