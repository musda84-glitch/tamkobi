"""İade faturası: cari işareti, stok yönü ve ekstre satırı.

Satış artı, alış eksi kalır. Alış iadesi ve tedarikçi `return` artıdır.
Satış iadesi ve müşteri `return` eksidir. Kayıtlı bakiyeyi geri yazan bir göç yok.
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import invoice_kind
import statement_share
from stock_moves import invoice_stock_moves


def _run(coro):
    return asyncio.run(coro)


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows)[:n]


class FakeColl:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def _match(self, d, q):
        if not q:
            return True
        for k, v in q.items():
            if isinstance(v, dict) and "$in" in v:
                if d.get(k) not in v["$in"]:
                    return False
                continue
            if d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        d = next((x for x in self.docs if self._match(x, q or {})), None)
        return dict(d) if d else None

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, q, upd):
        d = next((x for x in self.docs if self._match(x, q or {})), None)
        if not d:
            return MagicMock(matched_count=0, modified_count=0)
        if "$set" in upd:
            d.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                d[k] = float(d.get(k) or 0) + float(v)
        if "$unset" in upd:
            for k in upd["$unset"]:
                d.pop(k, None)
        return MagicMock(matched_count=1, modified_count=1)


def _db(contacts, products, invoices):
    db = MagicMock()
    db.contacts = FakeColl(contacts)
    db.products = FakeColl(products)
    db.invoices = FakeColl(invoices)
    db.stock_lots = FakeColl([])
    return db


def _contact(cid, ctype, balance=0.0):
    return {"_id": cid, "company_id": "co", "type": ctype, "name": ctype, "balance": balance}


def _product(stock=10.0):
    return {"_id": "p1", "company_id": "co", "name": "Mal", "stock_quantity": stock}


def _inv(itype, *, contact="sup", total=999.58, qty=2, status="draft", effects=None, flag=None, direction=None, iid="inv1"):
    doc = {
        "_id": iid,
        "company_id": "co",
        "invoice_type": itype,
        "status": status,
        "contact_id": contact,
        "items": [{"product_id": "p1", "name": "Mal", "quantity": qty}],
        "grand_total": total,
        "local_total": total,
        "currency": "TRY",
        "fx_rate": 1,
    }
    if effects is not None:
        doc["effects_applied"] = effects
    if flag is not None:
        doc["stock_effects_applied"] = flag
    if direction:
        doc["direction"] = direction
    return doc


def _balance(db, cid="sup"):
    return next(x for x in db.contacts.docs if x["_id"] == cid)["balance"]


def _stock(db):
    return next(x for x in db.products.docs if x["_id"] == "p1")["stock_quantity"]


def _stored_type(db, iid="inv1"):
    return next(x for x in db.invoices.docs if x["_id"] == iid)["invoice_type"]


@pytest.fixture
def server_mod():
    import server
    return server


def test_canonical_type_prefers_contact_over_direction():
    supplier = {"type": "supplier"}
    customer = {"type": "customer"}
    both = {"type": "both"}
    assert invoice_kind.canonical_invoice_type({"invoice_type": "return"}, supplier) == "purchase_return"
    assert invoice_kind.canonical_invoice_type({"invoice_type": "iade", "direction": "outgoing"}, supplier) == "purchase_return"
    assert invoice_kind.canonical_invoice_type({"invoice_type": "return", "direction": "incoming"}, customer) == "sales_return"
    assert invoice_kind.canonical_invoice_type({"invoice_type": "return", "direction": "incoming"}, both) == "purchase_return"
    assert invoice_kind.canonical_invoice_type({"invoice_type": "return"}, both) == "sales_return"
    assert invoice_kind.canonical_invoice_type({"invoice_type": "return", "direction": "incoming"}) == "purchase_return"
    assert invoice_kind.canonical_invoice_type({"invoice_type": "return"}) == "sales_return"
    assert invoice_kind.canonical_invoice_type({"invoice_type": "sales"}) == "sales"
    assert invoice_kind.canonical_invoice_type({"invoice_type": "purchase"}) == "purchase"


def test_balance_sign_keeps_sales_and_purchase():
    assert invoice_kind.balance_delta(100, "sales") == 100
    assert invoice_kind.balance_delta(100, "purchase") == -100
    assert invoice_kind.balance_delta(100, "purchase_return") == 100
    assert invoice_kind.balance_delta(100, "sales_return") == -100
    assert invoice_kind.balance_delta(100, "proforma") == -100
    assert invoice_kind.stock_delta_sign("sales") == -1
    assert invoice_kind.stock_delta_sign("purchase_return") == -1
    assert invoice_kind.stock_delta_sign("purchase") == 1
    assert invoice_kind.stock_delta_sign("sales_return") == 1


def _apply_reverse(server_mod, itype, ctype, *, total=999.58, qty=2, direction=None, status="draft", effects=None, flag=None):
    contact_id = "sup" if ctype == "supplier" else "cus"
    contact = _contact(contact_id, ctype)
    product = _product()
    inv = _inv(
        itype, contact=contact_id, total=total, qty=qty, status=status,
        effects=effects, flag=flag, direction=direction,
    )
    db = _db([contact], [product], [inv])
    with patch.object(server_mod, "db", db):
        _run(server_mod._apply_invoice_effects(inv))
        applied = (_balance(db, contact_id), _stock(db), _stored_type(db), inv.get("invoice_type"))
        _run(server_mod._reverse_invoice_effects(inv))
        reversed_state = (_balance(db, contact_id), _stock(db), inv.get("stock_effects_applied"))
    return applied, reversed_state


def test_apply_reverse_sales_and_purchase_unchanged(server_mod):
    sales, sales_back = _apply_reverse(server_mod, "sales", "customer", total=150, qty=3)
    assert sales[0] == pytest.approx(150)
    assert sales[1] == pytest.approx(7)
    assert sales[2] == "sales"
    assert sales_back[0] == pytest.approx(0)
    assert sales_back[1] == pytest.approx(10)

    purchase, purchase_back = _apply_reverse(
        server_mod, "purchase", "supplier", total=80, qty=4, flag=False,
    )
    assert purchase[0] == pytest.approx(-80)
    assert purchase[1] == pytest.approx(14)
    assert purchase[2] == "purchase"
    assert purchase_back[0] == pytest.approx(0)
    assert purchase_back[1] == pytest.approx(10)


def test_apply_reverse_return_types_and_legacy_return(server_mod):
    cases = [
        ("sales_return", "customer", -999.58, 12),
        ("purchase_return", "supplier", 999.58, 8),
        ("return", "supplier", 999.58, 8),
        ("return", "customer", -999.58, 12),
    ]
    for itype, ctype, balance, stock in cases:
        applied, restored = _apply_reverse(server_mod, itype, ctype)
        assert applied[0] == pytest.approx(balance), itype
        assert applied[1] == pytest.approx(stock), itype
        assert restored[0] == pytest.approx(0), itype
        assert restored[1] == pytest.approx(10), itype


def test_draft_legacy_return_is_stored_as_canonical_on_apply(server_mod):
    contact = _contact("sup", "supplier")
    inv = _inv("return", status="draft")
    db = _db([contact], [_product()], [inv])
    with patch.object(server_mod, "db", db):
        _run(server_mod._apply_invoice_effects(inv))
    assert _stored_type(db) == "purchase_return"
    assert inv["invoice_type"] == "purchase_return"
    assert _balance(db) == pytest.approx(999.58)
    assert _stock(db) == pytest.approx(8)


def test_posted_legacy_return_keeps_stored_type_and_does_not_move_stock(server_mod):
    """Eski işlenmiş `return` belgesi yeniden yazılmaz; stoğu da ilk kez oynatılmaz.

    İptalde düzeltilmiş işaret kullanılır. Bu, tarihsel eksi bakiyeyi geri almaz.
    """
    contact = _contact("sup", "supplier", balance=-999.58)
    inv = _inv("return", status="approved", effects=True)
    db = _db([contact], [_product(10)], [inv])
    with patch.object(server_mod, "db", db):
        _run(server_mod._reverse_invoice_effects(inv))
    assert _stored_type(db) == "return"
    assert _stock(db) == pytest.approx(10)
    assert _balance(db) == pytest.approx(-999.58 - 999.58)


def test_incoming_direction_without_contact_type_is_purchase_return(server_mod):
    contact = _contact("sup", "both")
    inv = _inv("return", direction="incoming", status="draft")
    db = _db([contact], [_product()], [inv])
    with patch.object(server_mod, "db", db):
        _run(server_mod._apply_invoice_effects(inv))
    assert _stored_type(db) == "purchase_return"
    assert _balance(db) == pytest.approx(999.58)
    assert _stock(db) == pytest.approx(8)


def test_create_normalizes_return_by_contact(server_mod):
    from models import Invoice, InvoiceItem

    async def stamp(*_a, **_k):
        return {"currency": "TRY", "fx_rate": 1.0, "fx_date": "2026-10-01", "fx_source": "manual"}

    def _make(itype_contact, number):
        ctype, expected = itype_contact
        cid = "c-" + ctype
        contact = _contact(cid, ctype)
        db = _db([contact], [], [])
        item = InvoiceItem(name="Mal", quantity=1, unit_price=999.58, vat_rate=0, total=999.58, total_incl=999.58)
        invoice = Invoice(
            company_id="co",
            invoice_type="return",
            invoice_number=number,
            contact_id=cid,
            contact_name=ctype,
            items=[item],
            status="draft",
            currency="TRY",
        )
        user = {"is_super_admin": True, "company_ids": ["co"]}
        with patch.object(server_mod, "db", db), \
             patch.object(server_mod, "_fill_stock_codes", AsyncMock()), \
             patch.object(server_mod.fx, "stamp", AsyncMock(side_effect=stamp)), \
             patch.object(server_mod.fx, "typed_rate", return_value=None):
            out = _run(server_mod._create_invoice_core(invoice, user))
        assert out["invoice_type"] == expected
        assert db.invoices.docs[0]["invoice_type"] == expected
        assert db.contacts.docs[0]["balance"] == pytest.approx(0)

    _make(("supplier", "purchase_return"), "IADE-S")
    _make(("customer", "sales_return"), "IADE-C")


def test_draft_update_normalizes_return_posted_update_does_not(server_mod):
    supplier = _contact("sup", "supplier", balance=-999.58)
    draft = _inv("return", status="draft", iid="draft1")
    posted = _inv("return", status="approved", effects=True, iid="posted1", total=999.58)
    db = _db([supplier], [_product()], [draft, posted])

    def go(invoice_id, source):
        with patch.object(server_mod, "db", db), \
             patch("tenant_access.get_tenant_doc", AsyncMock(return_value=dict(source))), \
             patch.object(server_mod, "_invoice_gib_locked", return_value=False):
            return _run(server_mod.update_invoice(invoice_id, {"notes": "not"}, user={"is_super_admin": True}))

    _run_draft = go("draft1", draft)
    assert _run_draft["invoice_type"] == "purchase_return"
    assert _stored_type(db, "draft1") == "purchase_return"
    assert _balance(db) == pytest.approx(-999.58)

    posted_out = go("posted1", posted)
    assert posted_out["invoice_type"] == "return"
    assert _stored_type(db, "posted1") == "return"
    assert _balance(db) == pytest.approx(-999.58)
    assert _stock(db) == pytest.approx(10)


def test_stock_moves_direction_for_each_invoice_type():
    product = {"_id": "p1", "sku": "M-1", "name": "Mal"}
    invoices = [
        {"_id": "s", "invoice_type": "sales", "invoice_number": "S", "items": [{"product_id": "p1", "quantity": 1}]},
        {"_id": "p", "invoice_type": "purchase", "invoice_number": "P", "items": [{"product_id": "p1", "quantity": 4}]},
        {"_id": "sr", "invoice_type": "sales_return", "invoice_number": "SR", "items": [{"product_id": "p1", "quantity": 2}]},
        {"_id": "pr", "invoice_type": "purchase_return", "invoice_number": "PR", "items": [{"product_id": "p1", "quantity": 3}]},
        {"_id": "rs", "invoice_type": "return", "contact_type": "supplier", "invoice_number": "RS", "items": [{"product_id": "p1", "quantity": 5}]},
        {"_id": "rc", "invoice_type": "return", "contact_type": "customer", "direction": "incoming", "invoice_number": "RC", "items": [{"product_id": "p1", "quantity": 6}]},
        {"_id": "ri", "invoice_type": "return", "direction": "incoming", "invoice_number": "RI", "items": [{"product_id": "p1", "quantity": 7}]},
        {"_id": "d", "invoice_type": "dispatch", "invoice_number": "D", "items": [{"product_id": "p1", "quantity": 9}]},
    ]
    rows = invoice_stock_moves(invoices, "p1", product)
    assert [(r["invoice_type"], r["change"], r["reason"].split(":")[0]) for r in rows] == [
        ("sales", -1.0, "Satış"),
        ("purchase", 4.0, "Alış"),
        ("sales_return", 2.0, "Satış iadesi"),
        ("purchase_return", -3.0, "Alış iadesi"),
        ("purchase_return", -5.0, "Alış iadesi"),
        ("sales_return", 6.0, "Satış iadesi"),
        ("purchase_return", -7.0, "Alış iadesi"),
    ]


def test_statement_rows_label_and_sides():
    supplier = {"_id": "sup", "type": "supplier", "name": "Tedarik"}
    rows = statement_share.statement_rows(
        [
            {"invoice_number": "S", "invoice_type": "sales", "grand_total": 100, "issue_date": "2026-05-01", "status": "issued"},
            {"invoice_number": "P", "invoice_type": "purchase", "grand_total": 30, "issue_date": "2026-05-02", "status": "issued"},
            {"invoice_number": "SR", "invoice_type": "sales_return", "grand_total": 10, "issue_date": "2026-05-03", "status": "issued"},
            {"invoice_number": "PR", "invoice_type": "purchase_return", "grand_total": 40, "issue_date": "2026-05-04", "status": "issued"},
            {"invoice_number": "R", "invoice_type": "return", "grand_total": 999.58, "issue_date": "2026-05-05", "status": "issued"},
            {"invoice_number": "X", "invoice_type": "return", "grand_total": 1, "issue_date": "2026-05-06", "status": "cancelled"},
        ],
        [],
        contact=supplier,
    )
    assert [r["doc"] for r in rows] == [
        "S • Satış Faturası",
        "P • Alış Faturası",
        "SR • İade Faturası",
        "PR • İade Faturası",
        "R • İade Faturası",
    ]
    assert rows[0]["debit"] == 100 and rows[0]["credit"] == 0
    assert rows[1]["debit"] == 0 and rows[1]["credit"] == 30
    assert rows[2]["debit"] == 0 and rows[2]["credit"] == 10
    assert rows[3]["debit"] == 40 and rows[3]["credit"] == 0
    assert rows[4]["debit"] == 999.58 and rows[4]["credit"] == 0
    assert rows[4]["balance"] == pytest.approx(100 - 30 - 10 + 40 + 999.58)

    customer_rows = statement_share.statement_rows(
        [{"invoice_number": "R2", "invoice_type": "return", "grand_total": 15, "issue_date": "2026-06-01", "status": "issued", "direction": "incoming"}],
        [],
        contact={"type": "customer"},
    )
    assert customer_rows[0]["doc"] == "R2 • İade Faturası"
    assert customer_rows[0]["debit"] == 0 and customer_rows[0]["credit"] == 15
    assert customer_rows[0]["balance"] == pytest.approx(-15)
