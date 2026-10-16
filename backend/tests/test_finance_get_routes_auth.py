"""Finance GET routes: route-level auth and company resolution.

In-process TestClient and a memory database. No live server and no port 8021.
External HTTP (integrator balance) is mocked.
"""
from __future__ import annotations

import asyncio
import copy
import csv
import inspect
import io
import os
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-finance-get-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import account_balance  # noqa: E402
import addons  # noqa: E402
import auth_utils  # noqa: E402
import cash_approval  # noqa: E402
import cheques  # noqa: E402
import e_invoice  # noqa: E402
import edoc_backup  # noqa: E402
import edocs  # noqa: E402
import gib_credits  # noqa: E402
import isnet_portal  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import tax_obligations  # noqa: E402
from invoice_status import is_cancelled_invoice  # noqa: E402
from mysql_store import match_query, new_upsert_doc, sort_docs  # noqa: E402

_CMP_OPS = ("$gt", "$gte", "$lt", "$lte")


def _and_cmp(query):
    """Mongo ANDs every operator on a field. The in-memory matcher returns on the first."""
    if not isinstance(query, dict):
        return query
    out = {}
    extra = []
    for key, cond in query.items():
        if key in ("$and", "$or", "$nor") and isinstance(cond, list):
            out[key] = [_and_cmp(item) for item in cond]
            continue
        if isinstance(cond, dict) and sum(op in cond for op in _CMP_OPS) > 1:
            for op in _CMP_OPS:
                if op in cond:
                    extra.append({key: {op: cond[op]}})
            rest = {k: v for k, v in cond.items() if k not in _CMP_OPS}
            if rest:
                extra.append({key: rest})
            continue
        out[key] = cond
    if not extra:
        return out
    parts = ([out] if out else []) + extra
    return parts[0] if len(parts) == 1 else {"$and": parts}


def _docs_match(doc, query):
    return match_query(doc, _and_cmp(query or {}))

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
MONTH = "2026-10"
RANGE = {"date_from": "2026-10-01", "date_to": "2026-10-02"}
SECRET_A = "enc-secret-a"
KEY_A = "enc-key-a"
PLAIN_PASSWORD = "plain-secret-should-not-leak"


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def _rows(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)

    async def to_list(self, length=None):
        return self._rows(length)

    def __aiter__(self):
        rows = self._rows()

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    def _note(self, op, query=None, payload=None):
        self.db.writes.append({"coll": self.name, "op": op})

    def find(self, query=None, projection=None):
        matched = [d for d in self.docs if _docs_match(d, query)]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if _docs_match(doc, query):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if _docs_match(doc, query))

    async def insert_one(self, doc):
        self._note("insert_one")
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self._note("insert_many")
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        self._note("update_one")
        from mysql_store import apply_update

        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def delete_one(self, query):
        self._note("delete_one")
        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        self._note("delete_many")
        kept, deleted = [], 0
        for doc in self.docs:
            if _docs_match(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)

    async def create_index(self, *args, **kwargs):
        return None


class MemDB:
    def __init__(self):
        self._cols = {}
        self.writes = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name, self)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)

    async def _ensure(self):
        return None


def _user(uid, company_ids, active, *, role="admin", superadmin=False):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _user_a():
    return _user("user-a", [COMP_A], COMP_A)


def _seed(db):
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A", "tax_number": "1111111111"},
        {"_id": COMP_B, "name": "Firma B", "tax_number": "2222222222"},
        {"_id": NEXUS, "name": "Nexus", "tax_number": "3333333333"},
    ])
    db.contacts.docs.extend([
        {"_id": "ctA", "company_id": COMP_A, "name": "Cari A", "tax_number_or_id": "1111111111"},
        {"_id": "ctB", "company_id": COMP_B, "name": "B-SECRET", "tax_number_or_id": "2222222222"},
    ])
    db.bank_accounts.docs.extend([
        {"_id": "acc-bank", "company_id": COMP_A, "account_name": "Banka A", "type": "bank", "current_balance": 20.0},
        {"_id": "acc-kasa", "company_id": COMP_A, "account_name": "Kasa A", "type": "bank", "current_balance": 10.0},
        {"_id": "acc-b", "company_id": COMP_B, "account_name": "B-SECRET", "type": "bank", "current_balance": 99.0},
        {"_id": "acc-n", "company_id": NEXUS, "account_name": "NEXUS-ONLY", "type": "bank", "current_balance": 1.0},
    ])
    db.bank_connections.docs.append({
        "_id": "connA", "company_id": COMP_A, "linked_account_id": "acc-bank",
        "provider_name": "Enpara", "status": "active",
    })
    db.bank_transactions.docs.extend([
        {"_id": "txA1", "company_id": COMP_A, "source": "manual", "type": "inflow", "amount": 30, "date": "2026-10-02",
         "account_id": "acc-bank", "account_name": "Banka A", "description": "Tahsilat A", "category": "Tahsilat"},
        {"_id": "txA2", "company_id": COMP_A, "source": "bank_sync", "match_status": "unmatched", "type": "outflow",
         "amount": 5, "date": "2026-10-01", "account_id": "acc-bank", "account_name": "Banka A",
         "description": "Gider A", "category": "Gider"},
        {"_id": "txA3", "company_id": COMP_A, "source": "bank_sync", "match_status": "matched", "type": "outflow",
         "amount": 10, "date": "2026-10-03", "matched_at": "2026-10-03T02:00:00", "account_id": "acc-bank",
         "account_name": "Banka A", "description": "ACME MARKET POS", "contact_id": "ctA", "contact_name": "Cari A",
         "category": "Market"},
        {"_id": "txA4", "company_id": COMP_A, "source": "bank_sync", "match_status": "matched", "type": "outflow",
         "amount": 15, "date": "2026-09-01", "matched_at": "2026-10-04T02:00:00", "account_id": "acc-bank",
         "account_name": "Banka A", "description": "ACME MARKET POS", "contact_id": "ctA", "contact_name": "Cari A",
         "category": "Market"},
        {"_id": "txB", "company_id": COMP_B, "source": "bank_sync", "match_status": "unmatched", "type": "inflow",
         "amount": 99, "date": "2026-10-02", "description": "B-SECRET", "account_name": "B-SECRET", "category": "Gizli"},
        {"_id": "txBm", "company_id": COMP_B, "source": "bank_sync", "match_status": "matched", "type": "inflow",
         "amount": 1, "date": "2026-10-02", "matched_at": "2026-10-05T00:00:00", "description": "B-SECRET MATCH",
         "account_name": "B-SECRET", "category": "Gizli"},
        {"_id": "txN", "company_id": NEXUS, "source": "bank_sync", "match_status": "unmatched", "type": "inflow",
         "amount": 1, "date": "2026-10-02", "description": "NEXUS-ONLY", "account_name": "NEXUS-ONLY"},
    ])
    db.bank_match_rules.docs.extend([
        {"_id": "ruleA", "company_id": COMP_A, "pattern": "diger kural", "hits": 1},
        {"_id": "ruleB", "company_id": COMP_B, "pattern": "acme market pos", "hits": 9},
    ])
    db.cash_approval_requests.docs.extend([
        {"_id": "capA1", "company_id": COMP_A, "kind": "virman", "payload": {"password": "payload-secret-a"},
         "summary": "A virman", "requested_by": "other", "requested_by_name": "Diğer", "status": "pending",
         "created_at": "2026-10-02T00:00:00"},
        {"_id": "capA2", "company_id": COMP_A, "kind": "partner_tx", "summary": "A ortak", "requested_by": "user-a",
         "status": "pending", "created_at": "2026-10-01T00:00:00"},
        {"_id": "capB", "company_id": COMP_B, "kind": "virman", "summary": "B-SECRET", "requested_by": "other",
         "status": "pending", "created_at": "2026-10-03T00:00:00", "payload": {"password": "B-SECRET"}},
    ])
    db.einvoice_settings.docs.extend([
        {"_id": "esA", "company_id": COMP_A, "provider": "isnet", "status": "configured", "mode": "test",
         "username": "user-a", "password_enc": SECRET_A, "api_key_enc": KEY_A, "alias": "urn:mail:a",
         "company_tax_id": "1111111111"},
        {"_id": "esB", "company_id": COMP_B, "provider": "isnet", "status": "configured", "mode": "test",
         "username": "B-SECRET", "password_enc": "B-SECRET-PASSWORD", "api_key_enc": "B-SECRET-KEY"},
        {"_id": "esN", "company_id": NEXUS, "provider": "isnet", "status": "configured", "mode": "test",
         "username": "NEXUS-ONLY", "password_enc": "NEXUS-KEY"},
    ])
    db.invoices.docs.extend([
        {"_id": "invA", "company_id": COMP_A, "invoice_type": "sales", "status": "issued", "e_type": "e_archive",
         "einvoice_state": "sent", "gib_uuid": "11111111-1111-1111-1111-111111111111",
         "invoice_number": "A-1", "issue_date": "2026-10-02", "contact_id": "ctA", "contact_name": "Cari A",
         "subtotal": 100, "vat_total": 20, "grand_total": 120, "paid_amount": 20, "payment_status": "partial",
         "gib_status": "İletildi", "items": [{"vat_rate": 20, "total": 100, "name": "Kalem", "quantity": 1, "unit_price": 100}]},
        {"_id": "invP", "company_id": COMP_A, "invoice_type": "purchase", "status": "issued", "e_type": "paper",
         "invoice_number": "P-1", "issue_date": "2026-10-01", "contact_id": "ctA", "contact_name": "Tedarik",
         "subtotal": 50, "vat_total": 10, "grand_total": 60, "paid_amount": 0, "payment_status": "unpaid",
         "gib_status": "", "items": [{"vat_rate": 20, "total": 50, "name": "Alim", "quantity": 1, "unit_price": 50}]},
        {"_id": "invC", "company_id": COMP_A, "invoice_type": "sales", "status": "cancelled", "e_type": "paper",
         "invoice_number": "C-1", "issue_date": "2026-10-02", "contact_name": "Iptal", "subtotal": 999,
         "vat_total": 0, "grand_total": 999, "paid_amount": 0, "payment_status": "unpaid", "items": []},
        {"_id": "invOld", "company_id": COMP_A, "invoice_type": "sales", "status": "issued", "e_type": "paper",
         "invoice_number": "OLD", "issue_date": "2026-09-01", "subtotal": 7, "vat_total": 0, "grand_total": 7,
         "paid_amount": 0, "payment_status": "unpaid", "items": []},
        {"_id": "invB", "company_id": COMP_B, "invoice_type": "sales", "status": "issued", "e_type": "paper",
         "invoice_number": "B-SECRET", "issue_date": "2026-10-02", "contact_name": "B-SECRET", "subtotal": 999,
         "vat_total": 0, "grand_total": 999, "paid_amount": 0, "payment_status": "unpaid", "items": []},
        {"_id": "invB2", "company_id": COMP_B, "invoice_type": "sales", "status": "issued", "e_type": "paper",
         "invoice_number": "B-SECRET-2", "issue_date": "2026-10-01", "contact_name": "B-SECRET", "subtotal": 8,
         "vat_total": 0, "grand_total": 8, "paid_amount": 0, "payment_status": "unpaid", "items": []},
        {"_id": "invBedoc", "company_id": COMP_B, "invoice_type": "sales", "status": "approved", "e_type": "e_archive",
         "einvoice_state": "sent", "gib_uuid": "22222222-2222-2222-2222-222222222222",
         "invoice_number": "B-EDOC", "issue_date": "2026-10-02", "contact_name": "B-SECRET", "subtotal": 0,
         "vat_total": 0, "grand_total": 0, "paid_amount": 0, "payment_status": "paid", "gib_status": "İletildi", "items": []},
        {"_id": "invB2edoc", "company_id": COMP_B, "invoice_type": "sales", "status": "issued", "e_type": "e_archive",
         "einvoice_state": "sent", "gib_uuid": "33333333-3333-3333-3333-333333333333",
         "gib_tracking_id": "GIB-SIM-B2",
         "invoice_number": "B-EDOC-2", "issue_date": "2026-10-01", "contact_name": "B-SECRET", "subtotal": 0,
         "vat_total": 0, "grand_total": 0, "paid_amount": 0, "payment_status": "paid", "gib_status": "İletildi", "items": []},
        {"_id": "invN", "company_id": NEXUS, "invoice_type": "sales", "status": "issued", "e_type": "paper",
         "invoice_number": "NEXUS-ONLY", "issue_date": "2026-10-02", "contact_name": "NEXUS-ONLY", "subtotal": 1,
         "vat_total": 0, "grand_total": 1, "paid_amount": 0, "payment_status": "unpaid", "items": []},
        {"_id": "invNedoc", "company_id": NEXUS, "invoice_type": "sales", "status": "issued", "e_type": "e_archive",
         "einvoice_state": "sent", "gib_uuid": "44444444-4444-4444-4444-444444444444",
         "invoice_number": "NEXUS-EDOC", "issue_date": "2026-10-02", "contact_name": "NEXUS-ONLY", "subtotal": 0,
         "vat_total": 0, "grand_total": 0, "paid_amount": 0, "payment_status": "paid", "gib_status": "İletildi", "items": []},
    ])
    db.incoming_edocs.docs.extend([
        {"_id": "edA", "company_id": COMP_A, "status": "pending", "received_at": "2026-10-02T00:00:00",
         "supplier": {"name": "Satici A", "tax_id": "1111111111"}, "lines": [{"name": "Kalem"}], "grand_total": 10,
         "number": "EA-1", "uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "dedupe_key": "uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
        {"_id": "edB", "company_id": COMP_B, "status": "pending", "received_at": "2026-10-03T00:00:00",
         "supplier": {"name": "B-SECRET", "tax_id": "222"}, "lines": [{"name": "Gizli"}], "grand_total": 9,
         "number": "B-SECRET", "uuid": "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", "dedupe_key": "uuid:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee"},
    ])
    db.cheques.docs.extend([
        {"_id": "chA", "company_id": COMP_A, "direction": "received", "status": "open", "amount": 250,
         "due_date": "2099-01-01", "instrument": "cheque", "number": "CEK-A", "contact_name": "Cari A"},
        {"_id": "chB", "company_id": COMP_B, "direction": "received", "status": "open", "amount": 999,
         "due_date": "2099-01-01", "instrument": "cheque", "number": "B-SECRET", "contact_name": "B-SECRET"},
        {"_id": "chN", "company_id": NEXUS, "direction": "issued", "status": "open", "amount": 1,
         "due_date": "2099-01-01", "instrument": "cheque", "number": "NEXUS-ONLY"},
    ])
    db.tax_obligations.docs.extend([
        {"_id": "obA", "company_id": COMP_A, "period": MONTH, "payment_status": "unpaid", "amount": 15,
         "due_date": "2026-10-26", "title": "KDV", "document_id": "docA", "source_kind": "tahakkuk"},
        {"_id": "obB", "company_id": COMP_B, "period": MONTH, "payment_status": "unpaid", "amount": 99,
         "due_date": "2026-10-26", "title": "B-SECRET", "document_id": "docB", "source_kind": "tahakkuk"},
    ])
    db.tax_documents.docs.extend([
        {"_id": "docA", "company_id": COMP_A, "period": MONTH, "source_kind": "tahakkuk", "filename": "kdv.pdf",
         "created_at": "2026-10-02T00:00:00", "summary": {}},
        {"_id": "docB", "company_id": COMP_B, "period": MONTH, "source_kind": "tahakkuk", "filename": "B-SECRET.pdf",
         "created_at": "2026-10-03T00:00:00", "summary": {}},
    ])
    db.gib_wallets.docs.extend([
        {"_id": COMP_A, "balance": 12, "created_at": "2026-10-01", "updated_at": "2026-10-01"},
        {"_id": COMP_B, "balance": 99, "created_at": "2026-10-01", "updated_at": "2026-10-01"},
    ])
    db.gib_credit_ledger.docs.extend([
        {"_id": "ledA", "wallet_id": COMP_A, "company_id": COMP_A, "type": "welcome", "credits": 12,
         "created_at": "2026-10-02T00:00:00", "note": "A kontor"},
        {"_id": "ledB", "wallet_id": COMP_B, "company_id": COMP_B, "type": "gift", "credits": 5,
         "created_at": "2026-10-03T00:00:00", "note": "B-SECRET"},
    ])


def _routes():
    return [
        (server.list_bank_accounts, server.get_current_user, "/api/banking/accounts", {}),
        (server.list_bank_transactions, server.get_current_user, "/api/banking/transactions", {}),
        (server.list_cash_approvals, server.get_current_user, "/api/banking/cash-approvals", {}),
        (server.list_unmatched_transactions, server.get_current_user, "/api/banking/transactions/unmatched", {}),
        (server.list_matched_transactions, server.get_current_user, "/api/banking/transactions/matched", {}),
        (server.match_rule_suggestions, server.get_current_user, "/api/banking/match-rule-suggestions", {}),
        (server.get_einvoice_settings, server.get_current_user, "/api/einvoice/settings", {}),
        (e_invoice.api_integrator_credits, e_invoice._user_dep, "/api/e-invoice/integrator-credits", {}),
        (edocs.list_inbox, edocs._user_dep, "/api/edocs/inbox", {}),
        (edoc_backup.edocs_preview, edoc_backup._user_dep, "/api/accountant/edocs", dict(RANGE)),
        (edoc_backup.edocs_export, edoc_backup._user_dep, "/api/accountant/edocs/export", dict(RANGE)),
        (edoc_backup.edocs_last_backup, edoc_backup._user_dep, "/api/accountant/edocs/last-backup", {}),
        (server.accountant_summary, server.get_current_user, "/api/accountant/summary", {"month": MONTH}),
        (server.accountant_export, server.get_current_user, "/api/accountant/export", {"month": MONTH, "kind": "invoices"}),
        (cheques.cheques_summary, cheques._user_dep, "/api/cheques/summary", {}),
        (cheques.list_cheques, cheques._user_dep, "/api/cheques", {}),
        (gib_credits.account_credits, gib_credits._user_dep, "/api/account/gib-credits", {}),
        (tax_obligations.list_tax_obligations, tax_obligations._user_dep, "/api/tax-obligations", {"month": MONTH}),
    ]


def _legacy_accounts(db, company_id):
    accounts = sort_docs([d for d in db.bank_accounts.docs if d.get("company_id") == company_id], [("account_name", 1)])
    conns = {c["linked_account_id"]: c for c in db.bank_connections.docs if c.get("company_id") == company_id}
    out = []
    for raw in server.clean_docs(copy.deepcopy(accounts)):
        conn = conns.get(raw["id"]) or conns.get(raw.get("_id"))
        if not conn:
            aid = str(raw.get("id") or "")
            conn = next((c for lid, c in conns.items() if str(lid) == aid), None)
        row = {
            **raw,
            "is_integrated": bool(conn),
            "integration_provider": (conn.get("provider_name") if conn else None),
            "integration_status": (conn.get("status") if conn else None),
            "connection_id": (conn.get("_id") if conn else None),
        }
        if row.get("is_customer_card_pool"):
            row["current_balance"] = 0.0
        out.append(row)
    return out


def _legacy_txs(db, company_id, account_id=None, *, limit=2000):
    rows = []
    for doc in db.bank_transactions.docs:
        if doc.get("company_id") != company_id:
            continue
        if account_id and doc.get("account_id") != account_id and doc.get("target_account_id") != account_id:
            continue
        rows.append(doc)
    rows = sort_docs(rows, [("date", -1)])[:limit]
    return server.clean_docs([account_balance.annotate_bank_tx(copy.deepcopy(t), account_id) for t in rows])


def _legacy_cash(db, company_id, user, status="pending"):
    rows = [d for d in db.cash_approval_requests.docs if d.get("company_id") == company_id and (not status or d.get("status") == status)]
    rows = sort_docs(rows, [("created_at", -1)])[:100]
    allowed = True
    actor = cash_approval.uid(user)
    out = []
    for raw in rows:
        row = cash_approval.public_row(copy.deepcopy(raw), user)
        row["can_approve"] = bool(allowed and raw.get("status") == "pending" and raw.get("requested_by") != actor)
        out.append(row)
    return out


def _legacy_filtered_txs(db, company_id, match_status, sort_key, limit):
    rows = [d for d in db.bank_transactions.docs if d.get("company_id") == company_id and d.get("source") == "bank_sync" and d.get("match_status") == match_status]
    rows = sort_docs(rows, [(sort_key, -1)])[:limit]
    return server.clean_docs(copy.deepcopy(rows))


def _legacy_suggestions(db, company_id, min_count=2):
    txs = [d for d in db.bank_transactions.docs if d.get("company_id") == company_id and d.get("source") == "bank_sync" and d.get("match_status") == "matched"]
    rules = {r["pattern"] for r in db.bank_match_rules.docs if r.get("company_id") == company_id}
    groups = {}
    for t in txs:
        pattern = server._match_pattern(t.get("description", ""))
        if not pattern or pattern in rules:
            continue
        key = (t.get("contact_id") or "", t.get("target_account_id") or "", t.get("category") or "")
        group = groups.setdefault(pattern, {"pattern": pattern, "count": 0, "targets": {}, "sample": t.get("description"), "total": 0.0})
        group["count"] += 1
        group["total"] += t.get("amount", 0)
        group["targets"][key] = group["targets"].get(key, 0) + 1
    out = []
    for pattern, group in groups.items():
        if group["count"] < min_count:
            continue
        (cid, tid, cat), n = max(group["targets"].items(), key=lambda kv: kv[1])
        if not (cid or tid or cat):
            continue
        sample = next(t for t in txs if server._match_pattern(t.get("description", "")) == pattern and (t.get("contact_id") or "") == cid and (t.get("target_account_id") or "") == tid)
        out.append({
            "pattern": pattern, "count": group["count"], "consistent": n == group["count"],
            "sample_description": group["sample"], "total_amount": round(group["total"], 2),
            "contact_id": cid or None, "contact_name": sample.get("contact_name"),
            "target_account_id": tid or None, "target_account_name": sample.get("target_account_name"),
            "category": cat or None,
        })
    out.sort(key=lambda x: -x["count"])
    return out


def _month_invoices(db, company_id, month):
    rows = [d for d in db.invoices.docs if d.get("company_id") == company_id and str(d.get("issue_date") or "").startswith(month)]
    return [d for d in rows if not is_cancelled_invoice(d)]


def _legacy_summary(db, company_id, month):
    invs = _month_invoices(db, company_id, month)
    txs = [d for d in db.bank_transactions.docs if d.get("company_id") == company_id and str(d.get("date") or "").startswith(month)]
    payrolls = [d for d in db.payrolls.docs if d.get("company_id") == company_id and d.get("period") == month]
    tax_obs = [d for d in db.tax_obligations.docs if d.get("company_id") == company_id and d.get("period") == month]
    tax_docs = [d for d in db.tax_documents.docs if d.get("company_id") == company_id and d.get("period") == month]
    sales = [i for i in invs if i.get("invoice_type") == "sales"]
    purchases = [i for i in invs if i.get("invoice_type") == "purchase"]
    by_vat = {}
    for inv in sales + purchases:
        for it in inv.get("items", []):
            rate = str(it.get("vat_rate", 20))
            base = float(it.get("total", 0))
            vat = base * float(it.get("vat_rate", 20)) / 100
            kind = "sales" if inv.get("invoice_type") == "sales" else "purchase"
            by_vat.setdefault(rate, {"rate": rate, "sales_base": 0, "sales_vat": 0, "purchase_base": 0, "purchase_vat": 0})
            by_vat[rate][f"{kind}_base"] += base
            by_vat[rate][f"{kind}_vat"] += vat
    calc_vat = sum(i.get("vat_total", 0) for i in sales)
    ded_vat = sum(i.get("vat_total", 0) for i in purchases)
    slim = [
        {k: i.get(k) for k in ("invoice_number", "issue_date", "invoice_type", "e_type", "contact_name", "subtotal", "vat_total", "grand_total", "gib_status")} | {"id": i.get("_id") or i.get("id")}
        for i in sorted(invs, key=lambda x: x.get("issue_date", ""), reverse=True)
    ]
    return {
        "month": month,
        "sales": {"count": len(sales), "subtotal": sum(i.get("subtotal", 0) for i in sales), "vat": calc_vat, "total": sum(i.get("grand_total", 0) for i in sales), "unpaid": sum(i.get("grand_total", 0) - i.get("paid_amount", 0) for i in sales if i.get("payment_status") != "paid")},
        "purchases": {"count": len(purchases), "subtotal": sum(i.get("subtotal", 0) for i in purchases), "vat": ded_vat, "total": sum(i.get("grand_total", 0) for i in purchases)},
        "vat": {"calculated": calc_vat, "deductible": ded_vat, "payable": max(0.0, calc_vat - ded_vat), "carryover": max(0.0, ded_vat - calc_vat), "by_rate": sorted(by_vat.values(), key=lambda x: -float(x["rate"]))},
        "cash": {"inflow": sum(t.get("amount", 0) for t in txs if t.get("type") == "inflow"), "outflow": sum(t.get("amount", 0) for t in txs if t.get("type") == "outflow"), "count": len(txs)},
        "payroll": tax_obligations.payroll_from_documents(tax_docs) or {"count": len(payrolls), "gross": sum(p.get("gross_salary", 0) for p in payrolls), "net": sum(p.get("net_salary", 0) for p in payrolls), "employer_cost": sum(p.get("total_employer_cost", p.get("gross_salary", 0)) for p in payrolls), "source": "personnel"},
        "tax_payables": tax_obligations.month_summary(tax_obs),
        "e_docs": {"gib_sent": sum(1 for i in invs if i.get("status") == "sent"), "draft": sum(1 for i in invs if i.get("status") == "draft"), "dispatch": sum(1 for i in invs if i.get("invoice_type") == "dispatch")},
        "invoices": slim,
    }


def _legacy_invoice_csv(db, company_id, month):
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["Belge No", "Tarih", "Tür", "E-Belge", "Cari", "VKN", "Matrah", "KDV", "Toplam", "Ödeme", "GİB"])
    invs = sort_docs(_month_invoices(db, company_id, month), [("issue_date", 1)])
    contacts = {c["_id"]: c for c in db.contacts.docs}
    for inv in invs:
        contact = contacts.get(inv.get("contact_id"))
        writer.writerow([
            inv.get("invoice_number"), inv.get("issue_date"), inv.get("invoice_type"), inv.get("e_type"),
            inv.get("contact_name"), (contact or {}).get("tax_number_or_id", ""),
            f"{inv.get('subtotal', 0):.2f}", f"{inv.get('vat_total', 0):.2f}", f"{inv.get('grand_total', 0):.2f}",
            inv.get("payment_status"), inv.get("gib_status") or "",
        ])
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


def _legacy_tx_csv(db, company_id, month):
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["Tarih", "Hesap", "Tür", "Kategori", "Açıklama", "Tutar"])
    rows = sort_docs(
        [d for d in db.bank_transactions.docs if d.get("company_id") == company_id and str(d.get("date") or "").startswith(month)],
        [("date", 1)],
    )
    for tx in rows:
        writer.writerow([
            tx.get("date"), tx.get("account_name"), "Giriş" if tx.get("type") == "inflow" else "Çıkış",
            tx.get("category"), tx.get("description"), f"{tx.get('amount', 0):.2f}",
        ])
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


def _legacy_obligations(db, company_id, month):
    query_rows = sort_docs([d for d in db.tax_obligations.docs if d.get("company_id") == company_id], [("due_date", 1)])
    all_rows = [tax_obligations._clean(copy.deepcopy(x)) for x in query_rows]
    rows = tax_obligations.visible_obligations(all_rows, month)
    docs_raw = [tax_obligations._clean(copy.deepcopy(x)) for x in sort_docs([d for d in db.tax_documents.docs if d.get("company_id") == company_id], [("created_at", -1)])]
    return {
        "obligations": rows,
        "documents": tax_obligations.enrich_documents(docs_raw, all_rows),
        "summary": tax_obligations.month_summary(rows),
        "payroll": tax_obligations.payroll_from_documents(docs_raw),
    }


def _no_foreign(text):
    assert "B-SECRET" not in text
    assert "NEXUS-ONLY" not in text
    assert "B-SECRET-PASSWORD" not in text
    assert SECRET_A not in text
    assert KEY_A not in text
    assert PLAIN_PASSWORD not in text


def _snapshot(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
    db.users.docs.append(_user("user-b", [COMP_B], COMP_B))
    db.users.docs.append(_user("user-sa", [], "", superadmin=True))
    db.users.docs.append(_user("user-sa-a", [COMP_A], COMP_A, superadmin=True))
    _seed(db)
    prev = (
        server.db, rbac._db, saas._db, addons._db, e_invoice._db, edocs._db,
        edoc_backup._db, gib_credits._db, cheques._db, tax_obligations._db,
    )
    prev_user = (e_invoice._current_user, edoc_backup._current_user, gib_credits._current_user, edocs._current_user, cheques._current_user, tax_obligations._current_user)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    e_invoice._db = db
    edocs._db = db
    edoc_backup._db = db
    gib_credits._db = db
    cheques._db = db
    tax_obligations._db = db
    e_invoice._current_user = server.get_current_user
    edoc_backup._current_user = server.get_current_user
    gib_credits._current_user = server.get_current_user
    edocs._current_user = server.get_current_user
    cheques._current_user = server.get_current_user
    tax_obligations._current_user = server.get_current_user
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    balance = AsyncMock(return_value={"remaining_credit": "42", "balance": "42", "message": "OK"})
    no_remote = AsyncMock(return_value=None)
    try:
        with patch.object(e_invoice.isnet, "get_company_balance", balance), \
             patch.object(e_invoice, "fetch_integrator_xml", no_remote), \
             patch.object(e_invoice, "fetch_integrator_pdf", no_remote):
            client.__enter__()
            entered = True
            yield client, db, balance
    finally:
        if entered:
            client.__exit__(None, None, None)
        (
            server.db, rbac._db, saas._db, addons._db, e_invoice._db, edocs._db,
            edoc_backup._db, gib_credits._db, cheques._db, tax_obligations._db,
        ) = prev
        (
            e_invoice._current_user, edoc_backup._current_user, gib_credits._current_user,
            edocs._current_user, cheques._current_user, tax_obligations._current_user,
        ) = prev_user
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _token(uid, *, superadmin=False):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", "admin", is_super_admin=superadmin)


def _auth(uid, *, superadmin=False):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin)}"}


def test_route_signatures_have_auth_and_no_nexus_default():
    routes = _routes()
    assert len(routes) == 18
    for fn, dep, _path, _extra in routes:
        sig = inspect.signature(fn)
        assert sig.parameters["company_id"].default is None
        assert sig.parameters["user"].default.dependency is dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "resolve_company_id" in src
    assert "request" not in inspect.signature(server.list_cash_approvals).parameters
    assert "request" not in inspect.signature(gib_credits.account_credits).parameters
    assert list(inspect.signature(server._einvoice_settings_payload).parameters) == ["company_id"]
    assert list(inspect.signature(cheques._cheques_summary).parameters) == ["company_id"]
    assert list(inspect.signature(edoc_backup.build_zip).parameters) == ["company_id", "date_from", "date_to"]
    assert list(inspect.signature(edoc_backup.last_backup).parameters) == ["company_id"]
    assert list(inspect.signature(edoc_backup.parse_range).parameters) == ["date_from", "date_to"]
    assert list(inspect.signature(edoc_backup.run_reminders).parameters) == []
    portal = inspect.getsource(isnet_portal.IsnetPortalClient.list_inbox)
    assert "resolve_company_id" not in portal
    assert "days" in inspect.signature(isnet_portal.IsnetPortalClient.list_inbox).parameters
    server_text = Path(server.__file__).read_text(encoding="utf-8")
    assert "await get_einvoice_settings(" not in server_text
    assert server_text.count("_einvoice_settings_payload(") >= 5
    cheque_text = Path(cheques.__file__).read_text(encoding="utf-8")
    assert "await cheques_summary(" not in cheque_text
    assert "await _cheques_summary(" in cheque_text


def test_background_loops_do_not_call_these_routes():
    names = [fn.__name__ for fn, _dep, _path, _extra in _routes()]
    blobs = [
        inspect.getsource(server._run_einvoice_inbox_auto_tick),
        inspect.getsource(server._einvoice_inbox_auto_loop),
        inspect.getsource(server._run_bank_auto_sync_tick),
        inspect.getsource(server._bank_auto_sync_loop),
        inspect.getsource(server._marketplace_auto_sync_loop),
        inspect.getsource(edoc_backup.run_reminders),
    ]
    text = "\n".join(blobs)
    for name in names:
        assert name not in text
    portal = Path(isnet_portal.__file__).read_text(encoding="utf-8")
    assert "client.list_inbox(" in portal


def test_no_token_is_401(api):
    client, db, balance = api
    before = _snapshot(db)
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params=extra or None)
        assert response.status_code == 401, (path, response.text)
        _no_foreign(response.text)
    assert _snapshot(db) == before
    balance.assert_not_called()


def test_other_company_is_403_and_returns_nothing(api):
    client, db, balance = api
    before = _snapshot(db)
    headers = _auth("user-a")
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params={"company_id": COMP_B, **extra}, headers=headers)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == "Bu şirket hesabına erişiminiz yok."
        _no_foreign(response.text)
    assert _snapshot(db) == before
    balance.assert_not_called()


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db, balance = api
    user_a = _user_a()
    before = _snapshot(db)
    for fn, _dep, path, extra in _routes():
        with pytest.raises(HTTPException) as exc:
            _run(fn(company_id=COMP_B, user=user_a, **extra))
        assert exc.value.status_code == 403, path
        assert exc.value.detail == "Bu şirket hesabına erişiminiz yok."
    assert _snapshot(db) == before
    balance.assert_not_called()


def test_missing_company_id_uses_active_company_only(api):
    client, db, _balance = api
    headers = _auth("user-a")
    user_a = _user_a()
    expected = {
        "/api/banking/accounts": _legacy_accounts(db, COMP_A),
        "/api/banking/transactions": _legacy_txs(db, COMP_A),
        "/api/banking/cash-approvals": _legacy_cash(db, COMP_A, user_a),
        "/api/banking/transactions/unmatched": _legacy_filtered_txs(db, COMP_A, "unmatched", "date", 500),
        "/api/banking/transactions/matched": _legacy_filtered_txs(db, COMP_A, "matched", "matched_at", 100),
        "/api/banking/match-rule-suggestions": _legacy_suggestions(db, COMP_A),
        "/api/einvoice/settings": server._einvoice_view(COMP_A, db.einvoice_settings.docs[0]),
        "/api/accountant/summary": _legacy_summary(db, COMP_A, MONTH),
        "/api/cheques/summary": _run(cheques._cheques_summary(COMP_A)),
        "/api/tax-obligations": _legacy_obligations(db, COMP_A, MONTH),
    }
    for fn, _dep, path, extra in _routes():
        if path in ("/api/accountant/edocs/export", "/api/accountant/export"):
            continue
        response = client.get(path, params=extra or None, headers=headers)
        assert response.status_code == 200, (path, response.text)
        _no_foreign(response.text)
        direct = _run(fn(company_id=None, user=user_a, **extra))
        if path in expected:
            assert response.json() == expected[path]
        if not isinstance(direct, server.Response):
            assert response.json() == direct
    blank = client.get("/api/banking/accounts", params={"company_id": ""}, headers=headers)
    assert blank.status_code == 200
    assert blank.json() == _legacy_accounts(db, COMP_A)
    _no_foreign(blank.text)


def test_happy_path_matches_legacy_shape(api):
    client, db, balance = api
    headers = _auth("user-a")
    user_a = _user_a()

    accounts = client.get("/api/banking/accounts", params={"company_id": COMP_A}, headers=headers)
    assert accounts.status_code == 200, accounts.text
    body = accounts.json()
    assert body == _legacy_accounts(db, COMP_A)
    assert [row["id"] for row in body] == ["acc-bank", "acc-kasa"]
    assert body[0]["is_integrated"] is True
    assert body[0]["integration_provider"] == "Enpara"
    assert body[0]["connection_id"] == "connA"
    assert body[1]["is_integrated"] is False
    assert "ledger_balance" not in body[0]
    assert "balance_drift" not in body[0]
    _no_foreign(accounts.text)

    txs = client.get("/api/banking/transactions", params={"company_id": COMP_A, "account_id": "acc-bank"}, headers=headers)
    assert txs.status_code == 200, txs.text
    assert txs.json() == _legacy_txs(db, COMP_A, "acc-bank")
    assert [row["id"] for row in txs.json()] == ["txA3", "txA1", "txA2", "txA4"]
    assert txs.json()[0]["balance_delta"] == -10
    assert txs.json()[0]["side"] == "out"

    approvals = client.get("/api/banking/cash-approvals", params={"company_id": COMP_A}, headers=headers)
    assert approvals.status_code == 200, approvals.text
    assert approvals.json() == _legacy_cash(db, COMP_A, user_a)
    assert approvals.json()[0]["can_approve"] is True
    assert approvals.json()[1]["can_approve"] is False
    assert approvals.json()[1]["is_own"] is True
    assert "payload" not in approvals.json()[0]
    assert "payload-secret-a" not in approvals.text

    unmatched = client.get("/api/banking/transactions/unmatched", params={"company_id": COMP_A}, headers=headers)
    assert unmatched.json() == _legacy_filtered_txs(db, COMP_A, "unmatched", "date", 500)
    assert [row["id"] for row in unmatched.json()] == ["txA2"]

    matched = client.get("/api/banking/transactions/matched", params={"company_id": COMP_A, "limit": 100}, headers=headers)
    assert matched.json() == _legacy_filtered_txs(db, COMP_A, "matched", "matched_at", 100)
    assert [row["id"] for row in matched.json()] == ["txA4", "txA3"]

    suggestions = client.get("/api/banking/match-rule-suggestions", params={"company_id": COMP_A, "min_count": 2}, headers=headers)
    assert suggestions.json() == _legacy_suggestions(db, COMP_A, 2)
    assert suggestions.json() == [{
        "pattern": "acme market pos", "count": 2, "consistent": True, "sample_description": "ACME MARKET POS",
        "total_amount": 25.0, "contact_id": "ctA", "contact_name": "Cari A", "target_account_id": None,
        "target_account_name": None, "category": "Market",
    }]

    settings = client.get("/api/einvoice/settings", params={"company_id": COMP_A}, headers=headers)
    assert settings.status_code == 200, settings.text
    view = settings.json()
    assert view == server._einvoice_view(COMP_A, copy.deepcopy(db.einvoice_settings.docs[0]))
    assert view["has_password"] is True
    assert view["has_api_key"] is True
    assert view["company_id"] == COMP_A
    assert "password" not in view
    assert "password_enc" not in view
    assert "api_key_enc" not in view
    assert SECRET_A not in settings.text
    assert KEY_A not in settings.text

    credits = client.get("/api/e-invoice/integrator-credits", params={"company_id": COMP_A}, headers=headers)
    assert credits.status_code == 200, credits.text
    assert credits.json() == {
        "company_id": COMP_A,
        "provider": "isnet",
        "balance": 42,
        "raw": {"remaining_credit": "42", "balance": "42", "message": "OK"},
        "source": "isnet",
        "message": "OK",
    }
    balance.assert_called()

    inbox = client.get("/api/edocs/inbox", params={"company_id": COMP_A}, headers=headers)
    assert inbox.status_code == 200, inbox.text
    assert [row["id"] for row in inbox.json()["items"]] == ["edA"]
    assert inbox.json()["counts"] == {"pending": 1, "approved": 0, "rejected": 0, "ignored": 0}
    assert inbox.json()["blank"] == 0
    assert inbox.json() == _run(edocs.list_inbox(company_id=COMP_A, user=user_a))

    preview = client.get("/api/accountant/edocs", params={"company_id": COMP_A, **RANGE}, headers=headers)
    assert preview.status_code == 200, preview.text
    assert preview.json()["date_from"] == "2026-10-01"
    assert preview.json()["date_to"] == "2026-10-02"
    assert preview.json()["days"] == 2
    assert preview.json()["max_days"] == 62
    assert preview.json()["invoice_count"] == 1
    assert preview.json()["xml_count"] == 1
    assert preview.json()["pdf_count"] == 1
    assert preview.json()["integrator_count"] == 1
    assert preview.json()["local_count"] == 0
    assert preview.json()["last_backup"] is None
    assert preview.json()["reminder_due"] is True
    assert preview.json() == _run(edoc_backup.edocs_preview(company_id=COMP_A, user=user_a, **RANGE))

    last = client.get("/api/accountant/edocs/last-backup", params={"company_id": COMP_A}, headers=headers)
    assert last.json() == {"last_backup": None, "reminder_due": True, "max_days": 62}

    summary = client.get("/api/accountant/summary", params={"company_id": COMP_A, "month": MONTH}, headers=headers)
    assert summary.status_code == 200, summary.text
    assert summary.json() == _legacy_summary(db, COMP_A, MONTH)
    assert summary.json()["sales"]["count"] == 1
    assert summary.json()["sales"]["unpaid"] == 100
    assert summary.json()["purchases"]["total"] == 60
    assert summary.json()["cash"] == {"inflow": 30, "outflow": 15, "count": 3}
    assert [row["id"] for row in summary.json()["invoices"]] == ["invA", "invP"]
    _no_foreign(summary.text)

    cheque_summary = client.get("/api/cheques/summary", params={"company_id": COMP_A}, headers=headers)
    assert cheque_summary.json() == _run(cheques._cheques_summary(COMP_A))
    assert cheque_summary.json()["portfolio"] == 250
    assert cheque_summary.json()["count"] == 1
    listed = client.get("/api/cheques", params={"company_id": COMP_A}, headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["summary"] == cheque_summary.json()
    assert [row["id"] for row in listed.json()["cheques"]] == ["chA"]
    assert listed.json()["cheques"][0]["status_label"] == "Portföy / Açık"
    assert listed.json()["cheques"][0]["due_soon"] is False
    assert listed.json() == _run(cheques.list_cheques(company_id=COMP_A, user=user_a))

    gib = client.get("/api/account/gib-credits", params={"company_id": COMP_A}, headers=headers)
    assert gib.status_code == 200, gib.text
    assert gib.json()["company_id"] == COMP_A
    assert gib.json()["wallet_id"] == COMP_A
    assert gib.json()["balance"] == 12
    assert gib.json()["sales_enabled"] is False
    assert gib.json()["packs"] == []
    assert [row["id"] for row in gib.json()["ledger"]] == ["ledA"]
    assert gib.json() == _run(gib_credits.account_credits(company_id=COMP_A, user=user_a))
    _no_foreign(gib.text)

    taxes = client.get("/api/tax-obligations", params={"company_id": COMP_A, "month": MONTH}, headers=headers)
    assert taxes.status_code == 200, taxes.text
    assert taxes.json() == _legacy_obligations(db, COMP_A, MONTH)
    assert taxes.json()["summary"]["unpaid_total"] == 15
    assert taxes.json()["documents"][0]["filename"] == "kdv.pdf"
    assert taxes.json()["payroll"] is None
    _no_foreign(taxes.text)


def test_download_headers_body_and_cookie_session(api):
    client, db, _balance = api
    headers = _auth("user-a")
    csv_params = {"company_id": COMP_A, "month": MONTH, "kind": "invoices"}
    exported = client.get("/api/accountant/export", params=csv_params, headers=headers)
    assert exported.status_code == 200, exported.text
    assert exported.headers["content-type"].startswith("text/csv")
    assert "charset=utf-8" in exported.headers["content-type"]
    assert exported.headers["content-disposition"] == f"attachment; filename=invoices_{MONTH}.csv"
    assert exported.content == _legacy_invoice_csv(db, COMP_A, MONTH)
    _no_foreign(exported.text)

    tx_params = {"company_id": COMP_A, "month": MONTH, "kind": "transactions"}
    tx_export = client.get("/api/accountant/export", params=tx_params, headers=headers)
    assert tx_export.status_code == 200, tx_export.text
    assert tx_export.headers["content-disposition"] == f"attachment; filename=transactions_{MONTH}.csv"
    assert tx_export.content == _legacy_tx_csv(db, COMP_A, MONTH)
    assert b"B-SECRET" not in tx_export.content

    cookie = client.get("/api/accountant/export", params=csv_params, cookies={"access_token": _token("user-a")})
    assert cookie.status_code == 200, cookie.text
    assert cookie.request.headers.get("authorization") is None
    assert cookie.headers["content-type"] == exported.headers["content-type"]
    assert cookie.headers["content-disposition"] == exported.headers["content-disposition"]
    assert cookie.content == exported.content

    zip_params = {"company_id": COMP_A, **RANGE}
    zipped = client.get("/api/accountant/edocs/export", params=zip_params, headers=headers)
    assert zipped.status_code == 200, zipped.text
    assert zipped.headers["content-type"].startswith("application/zip")
    assert zipped.headers["content-disposition"] == 'attachment; filename="ebelge_yedek_2026-10-01_2026-10-02.zip"'
    assert zipped.headers["x-invoice-count"] == "1"
    assert zipped.headers["x-xml-count"] == "1"
    assert zipped.headers["x-pdf-count"] == "1"
    assert zipped.headers["x-integrator-count"] == "0"
    assert zipped.headers["x-local-count"] == "2"
    assert b"B-SECRET" not in zipped.content
    assert b"NEXUS-ONLY" not in zipped.content
    archive = zipfile.ZipFile(io.BytesIO(zipped.content))
    manifest = archive.read("MANIFEST.txt").decode()
    assert "TamKobi e-belge yedek 2026-10-01 … 2026-10-02" in manifest
    assert "A-1_YEREL" in manifest
    assert "kaynak=local" in manifest
    assert "P-1" not in manifest
    assert any(name.startswith("giden/pdf/") and name.endswith(".pdf") for name in archive.namelist())
    assert any(name.startswith("giden/xml/") and name.endswith(".xml") for name in archive.namelist())

    zip_cookie = client.get("/api/accountant/edocs/export", params=zip_params, cookies={"access_token": _token("user-a")})
    assert zip_cookie.status_code == 200, zip_cookie.text
    assert zip_cookie.request.headers.get("authorization") is None
    assert zip_cookie.headers["content-type"] == zipped.headers["content-type"]
    assert zip_cookie.headers["content-disposition"] == zipped.headers["content-disposition"]
    assert zip_cookie.headers["x-invoice-count"] == "1"
    cookie_manifest = zipfile.ZipFile(io.BytesIO(zip_cookie.content)).read("MANIFEST.txt").decode()
    assert cookie_manifest == manifest


def test_einvoice_assign_and_save_keep_masked_view(api):
    client, db, _balance = api
    assigned = client.put(
        f"/api/system/companies/{COMP_B}/einvoice",
        json={"provider": "n11faturam"},
        headers=_auth("user-sa", superadmin=True),
    )
    assert assigned.status_code == 200, assigned.text
    view = assigned.json()
    assert view["company_id"] == COMP_B
    assert view["provider"] == "n11faturam"
    assert view["has_password"] is False
    assert view["has_api_key"] is False
    assert "password" not in view
    assert "password_enc" not in view
    assert "api_key_enc" not in view
    assert "B-SECRET-PASSWORD" not in assigned.text
    stored = next(d for d in db.einvoice_settings.docs if d.get("company_id") == COMP_B)
    assert stored.get("provider") == "n11faturam"
    assert "password_enc" not in stored

    saved = _run(server.save_einvoice_settings({
        "company_id": COMP_B,
        "username": "u-b",
        "password": PLAIN_PASSWORD,
        "corporate_code": "CORP-B",
        "mode": "test",
    }))
    assert saved["company_id"] == COMP_B
    assert saved["provider"] == "n11faturam"
    assert saved["username"] == "u-b"
    assert saved["corporate_code"] == "CORP-B"
    assert saved["has_password"] is True
    assert saved["status"] == "configured"
    assert "password" not in saved
    assert "password_enc" not in saved
    assert PLAIN_PASSWORD not in str(saved)
    assert saved == _run(server._einvoice_settings_payload(COMP_B))
    stored = next(d for d in db.einvoice_settings.docs if d.get("company_id") == COMP_B)
    assert stored.get("password_enc")
    assert PLAIN_PASSWORD not in stored["password_enc"]


def test_super_admin_follows_resolve_company_id(api):
    client, db, _balance = api
    missing = client.get("/api/banking/accounts", headers=_auth("user-sa", superadmin=True))
    assert missing.status_code == 400
    assert missing.json()["detail"] == "Şirket seçilmedi."
    _no_foreign(missing.text)
    with pytest.raises(HTTPException) as exc:
        _run(server.list_bank_accounts(user=_user("user-sa", [], "", superadmin=True)))
    assert exc.value.status_code == 400

    active = client.get("/api/banking/accounts", headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert active.json() == _legacy_accounts(db, COMP_A)
    assert "NEXUS-ONLY" not in active.text

    foreign = client.get("/api/banking/accounts", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert foreign.status_code == 200, foreign.text
    assert [row["id"] for row in foreign.json()] == ["acc-b"]

    preview = client.get("/api/accountant/edocs", params={"company_id": COMP_B, **RANGE}, headers=_auth("user-sa", superadmin=True))
    assert preview.status_code == 200, preview.text
    assert preview.json()["invoice_count"] == 2
