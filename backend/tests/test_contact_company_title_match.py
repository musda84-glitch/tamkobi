"""Ticari ünvan, cari adıyla aynı eşleşme yollarında kullanılır."""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000")

from mysql_store import apply_update, document_from_upsert, match_query
from bank_auto_match import contact_matches_text, contact_matches_text_any
from card_match import match_statement_contact
from contact_search import search_contacts


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *args, **kwargs):
        return self

    def limit(self, n):
        self._docs = self._docs[: int(n)]
        return self

    async def to_list(self, length=None):
        rows = self._docs if length is None else self._docs[:length]
        return copy.deepcopy(rows)


class MemoryCollection:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        stored = copy.deepcopy(doc)
        self.docs[stored["_id"]] = stored
        return stored

    async def find_one(self, query=None, projection=None):
        for doc in self.docs.values():
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        matched = [copy.deepcopy(d) for d in self.docs.values() if match_query(d, query or {})]
        return _Cursor(matched)

    async def update_one(self, query, update, upsert=False):
        found = None
        for doc in self.docs.values():
            if match_query(doc, query or {}):
                found = doc
                break
        if not found:
            if not upsert:
                return None
            new_doc = document_from_upsert(update, query)
            self.docs[new_doc["_id"]] = new_doc
            return None
        updated = apply_update(found, update, query)
        self.docs[updated.get("_id") or found["_id"]] = updated
        return None

    async def update_many(self, query, update):
        return None


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name):
        self._cols.setdefault(name, MemoryCollection())
        return self._cols[name]


TITLE = "MOR PLASTİK SANAYİ VE TİCARET LTD. ŞTİ."
USER = {
    "id": "u1",
    "role": "admin",
    "active_company_id": "co1",
    "company_ids": ["co1"],
}


def _contact(**extra):
    doc = {
        "_id": extra.pop("_id", "c1"),
        "company_id": "co1",
        "name": "Mor Plastik",
        "company_title": TITLE,
        "type": "customer",
        "is_active": True,
        "tax_number_or_id": "",
    }
    doc.update(extra)
    return doc


def test_search_contacts_matches_company_title_and_firma_adi():
    contacts = [
        _contact(_id="hit", name="Mor Plastik", company_title=TITLE, type="supplier"),
        _contact(_id="other", name="Başka Cam", company_title="Başka Cam Sanayi", type="customer"),
    ]
    found = search_contacts(contacts, "plastik sanayi")
    assert [row["_id"] for row in found["items"]] == ["hit"]
    suggested = search_contacts(
        contacts,
        "",
        suggest="Firma Adı: MOR PLASTIK SAN. TIC. LTD STI",
    )
    assert suggested["suggestions"][0]["_id"] == "hit"
    assert suggested["suggest_query"] == "MOR PLASTIK SAN. TIC. LTD STI"


def test_contacts_search_api_ranks_title_first():
    import server

    db = MemoryDB()
    _run(db.contacts.insert_one(_contact(_id="hit", name="Mor Plastik", company_title=TITLE, type="supplier")))
    _run(db.contacts.insert_one(_contact(_id="other", name="Plastik Dünyası", company_title="", type="customer")))
    _run(db.contacts.insert_one(_contact(_id="foreign", company_id="co2", name="Yabancı", company_title=TITLE)))
    prev = server.db
    server.db = db
    try:
        res = _run(server.search_contacts_api(
            company_id="co1",
            q="plastik sanayi",
            suggest="Firma Adı: MOR PLASTIK SAN. TIC. LTD STI",
            user=USER,
        ))
    finally:
        server.db = prev
    assert res["items"][0]["id"] == "hit"
    assert res["suggestions"][0]["id"] == "hit"
    assert all(row["id"] != "foreign" for row in res["items"] + res["suggestions"])


def test_global_search_title_returns_contact_invoice_and_order_in_tenant():
    import server

    db = MemoryDB()
    _run(db.contacts.insert_one(_contact(_id="c-own", name="Mor Plastik", company_title=TITLE)))
    _run(db.contacts.insert_one(_contact(_id="c-other", company_id="co2", name="Mor Plastik", company_title=TITLE)))
    _run(db.orders.insert_one({
        "_id": "o1", "company_id": "co1", "contact_id": "c-own",
        "order_number": "SIP-1", "customer_name": "Mor Plastik", "order_date": "2026-10-01",
    }))
    _run(db.orders.insert_one({
        "_id": "o2", "company_id": "co2", "contact_id": "c-other",
        "order_number": "SIP-YABANCI", "customer_name": "Mor Plastik", "order_date": "2026-10-02",
    }))
    _run(db.invoices.insert_one({
        "_id": "i1", "company_id": "co1", "contact_id": "c-own",
        "invoice_number": "FAT-1", "contact_name": "Mor Plastik", "issue_date": "2026-10-01",
    }))
    _run(db.invoices.insert_one({
        "_id": "i2", "company_id": "co2", "contact_id": "c-other",
        "invoice_number": "FAT-YABANCI", "contact_name": "Mor Plastik", "issue_date": "2026-10-02",
    }))
    prev = server.db
    server.db = db
    try:
        res = _run(server.global_search("sanayi ve ticaret", company_id="co1", user=USER))
    finally:
        server.db = prev
    assert [row["id"] for row in res["contacts"]] == ["c-own"]
    assert res["contacts"][0]["name"] == "Mor Plastik"
    assert res["contacts"][0]["company_title"] == TITLE
    assert [row["order_number"] for row in res["orders"]] == ["SIP-1"]
    assert [row["invoice_number"] for row in res["invoices"]] == ["FAT-1"]
    assert res["orders"][0]["customer_name"] == "Mor Plastik"
    assert res["invoices"][0]["contact_name"] == "Mor Plastik"


def test_bank_title_beats_similar_name_and_ignores_stopword_and_other_tenant():
    import server

    assert contact_matches_text(
        "Ahmet Y.",
        "CICEK INSAAT AS",
        "",
        contact_title="ÇİÇEK İNŞAAT A.Ş.",
    )
    assert contact_matches_text_any(
        ["Ahmet Y.", "ÇİÇEK İNŞAAT A.Ş."],
        "CICEK INSAAT AS",
        "",
    )
    assert not contact_matches_text("LTD STI", "LTD STI", "")
    assert not contact_matches_text("Mor Plastik Sanayi", "LTD STI", "havale")
    assert not contact_matches_text("Gerçek Firma", "", "LTD. STI.")

    db = MemoryDB()
    _run(db.contacts.insert_one({
        "_id": "similar", "company_id": "co1", "name": "Çiçek İnşaat",
        "company_title": "Market Ltd", "tax_number_or_id": "",
    }))
    _run(db.contacts.insert_one({
        "_id": "title", "company_id": "co1", "name": "Ahmet Y.",
        "company_title": "ÇİÇEK İNŞAAT A.Ş.", "tax_number_or_id": "",
    }))
    _run(db.contacts.insert_one({
        "_id": "foreign", "company_id": "co2", "name": "Ahmet Y.",
        "company_title": "ÇİÇEK İNŞAAT A.Ş.", "tax_number_or_id": "9999999999",
    }))
    _run(db.contacts.insert_one({
        "_id": "tax", "company_id": "co1", "name": "Vergi Carisi",
        "company_title": "Başka Ünvan Ltd", "tax_number_or_id": "1234567890",
    }))
    prev = server.db
    server.db = db
    try:
        picked = _run(server._suggest_contact("co1", "CICEK INSAAT AS", ""))
        assert picked["_id"] == "title"
        assert picked["matched_on"] == "company_title"
        assert picked["name"] == "Ahmet Y."
        stopped = _run(server._suggest_contact("co1", "LTD STI", ""))
        assert stopped is None
        by_tax = _run(server._suggest_contact("co1", "CICEK INSAAT AS", "VKN 1234567890 havale"))
        assert by_tax["_id"] == "tax"
        assert by_tax["matched_on"] == "tax_number_or_id"
    finally:
        server.db = prev


def test_card_statement_matches_title_when_name_differs():
    contacts = [
        {"_id": "c1", "name": "Eko", "company_title": "Eko Ambalaj Sanayi Ltd. Şti.", "tax_number_or_id": ""},
        {"_id": "c2", "name": "Başka Market", "company_title": "Market A.Ş.", "tax_number_or_id": ""},
    ]
    hit = match_statement_contact("POS EKO AMBALAJ SANAYI LTD STI", contacts)
    assert hit["_id"] == "c1"


def test_card_label_score_requires_word_boundary():
    """Kısa veya yaygın kelime, daha uzun kelimenin içinde geçtiği için eşleşmez."""
    gold = [{"_id": "g", "name": "Gold", "company_title": "", "tax_number_or_id": ""}]
    assert match_statement_contact("GOLDSMITH JEWELRY 1234", gold) is None
    assert match_statement_contact("MARIGOLD MARKET", gold) is None
    assert match_statement_contact("GOLD MARKET POS", gold)["_id"] == "g"
    market = [{"_id": "m", "name": "Market", "company_title": "", "tax_number_or_id": ""}]
    assert match_statement_contact("SUPERMARKET 4401", market) is None
    assert match_statement_contact("MARKET POS 12", market)["_id"] == "m"


def test_edoc_enrich_matches_title_inside_company():
    import edocs

    db = MemoryDB()
    _run(db.contacts.insert_one({
        "_id": "eko", "company_id": "co1", "name": "Eko",
        "company_title": "Eko Ambalaj Sanayi Ltd. Şti.",
    }))
    _run(db.contacts.insert_one({
        "_id": "foreign", "company_id": "co2", "name": "Eko",
        "company_title": "Eko Ambalaj Sanayi Ltd. Şti.",
    }))
    prev = edocs._db
    edocs.init(db, {})
    doc = {
        "supplier": {"name": "Eko Ambalaj San. Ltd. Şti.", "tax_id": ""},
        "lines": [],
    }
    try:
        out = _run(edocs._enrich(doc, "co1"))
    finally:
        edocs._db = prev
    assert out["contact_id"] == "eko"
    assert out["contact_name"] == "Eko"


def test_order_customer_matches_existing_title_without_creating():
    import server

    db = MemoryDB()
    _run(db.contacts.insert_one({
        "_id": "foreign", "company_id": "co2", "name": "Yabancı",
        "company_title": TITLE, "type": "customer",
    }))
    _run(db.contacts.insert_one({
        "_id": "own", "company_id": "co1", "name": "Kısa Ad",
        "company_title": TITLE, "type": "customer",
    }))
    order = {
        "_id": "ord1",
        "company_id": "co1",
        "customer_name": "Ali Veli",
        "customer_company": TITLE,
        "channel": "manual",
    }
    _run(db.orders.insert_one(order))
    prev = server.db
    server.db = db
    try:
        linked = _run(server._ensure_order_contact(order))
    finally:
        server.db = prev
    assert linked["_id"] == "own"
    assert linked.get("_created") is False
    assert len(db.contacts.docs) == 2
    assert db.orders.docs["ord1"]["contact_id"] == "own"
    assert db.orders.docs["ord1"]["contact_name"] == "Kısa Ad"
