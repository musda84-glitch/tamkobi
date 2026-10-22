"""shared_v2 büyük koleksiyonların gerçek tabloları.

orders, invoices, stock_movements ve bank_transactions docs_v2 yerine
kendi tablolarına yazılır. Diğer koleksiyonlar storage_shared_v2'de kalır.
Bağlantı ve benzersiz anahtar kaydı shared_v2 deposuyla ortaktır; tablo
bu modülde açılmaz. Şema storage_migrations 0005 içindedir.

Sık okunan alanlar gerçek kolondur. Metin kolon genişliğini aşarsa kolon
LEFT gibi kesilir, belgenin tamamı doc içindedir. Eşitlik kısa değerde
kolonu daraltır ve tam JSON metniyle doğrular. company_id ve _id kesilmez;
sınırı aşan yazı, alan adını söyleyen doğrulama hatası verir.
"""
from __future__ import annotations

import logging

import storage_shared_v2
from storage_shared_v2 import SharedV2Collection

log = logging.getLogger("storage_tables")

DATE_WIDTH = 40
TEXT_WIDTH = 64
ID_WIDTH = 191
COMPANY_WIDTH = 64


class Spec:
    def __init__(self, table, fields, indexes):
        self.table = table
        self.fields = tuple(fields)
        self.indexes = tuple(indexes)
        self.columns = {field: (column, width) for column, field, width in self.fields}


def _field(column, field, width):
    return (column, field, width)


SPECS = {
    "orders": Spec(
        "t_orders",
        (
            _field("order_date", "order_date", DATE_WIDTH),
            _field("order_status", "order_status", TEXT_WIDTH),
            _field("contact_id", "contact_id", TEXT_WIDTH),
            _field("order_number", "order_number", TEXT_WIDTH),
            _field("total_amount", "total_amount", TEXT_WIDTH),
            _field("channel", "channel", TEXT_WIDTH),
        ),
        (
            ("idx_t_orders_date", ("company_id", "order_date")),
            ("idx_t_orders_status", ("company_id", "order_status")),
            ("idx_t_orders_contact", ("company_id", "contact_id")),
            ("idx_t_orders_number", ("company_id", "order_number")),
        ),
    ),
    "invoices": Spec(
        "t_invoices",
        (
            _field("issue_date", "issue_date", DATE_WIDTH),
            _field("status", "status", TEXT_WIDTH),
            _field("contact_id", "contact_id", TEXT_WIDTH),
            _field("invoice_number", "invoice_number", TEXT_WIDTH),
            _field("grand_total", "grand_total", TEXT_WIDTH),
        ),
        (
            ("idx_t_invoices_date", ("company_id", "issue_date")),
            ("idx_t_invoices_status", ("company_id", "status")),
            ("idx_t_invoices_contact", ("company_id", "contact_id")),
            ("idx_t_invoices_number", ("company_id", "invoice_number")),
        ),
    ),
    "stock_movements": Spec(
        "t_stock_moves",
        (
            _field("doc_date", "date", DATE_WIDTH),
            _field("status", "status", TEXT_WIDTH),
            _field("product_id", "product_id", TEXT_WIDTH),
            _field("doc_no", "doc_no", TEXT_WIDTH),
            _field("amount", "change", TEXT_WIDTH),
        ),
        (
            ("idx_t_stock_moves_date", ("company_id", "doc_date")),
            ("idx_t_stock_moves_status", ("company_id", "status")),
            ("idx_t_stock_moves_product", ("company_id", "product_id")),
        ),
    ),
    "bank_transactions": Spec(
        "t_bank_transactions",
        (
            _field("doc_date", "date", DATE_WIDTH),
            _field("match_status", "match_status", TEXT_WIDTH),
            _field("contact_id", "contact_id", TEXT_WIDTH),
            _field("account_id", "account_id", TEXT_WIDTH),
            _field("doc_no", "doc_no", TEXT_WIDTH),
            _field("amount", "amount", TEXT_WIDTH),
        ),
        (
            ("idx_t_bank_tx_date", ("company_id", "doc_date")),
            ("idx_t_bank_tx_status", ("company_id", "match_status")),
            ("idx_t_bank_tx_contact", ("company_id", "contact_id")),
            ("idx_t_bank_tx_account", ("company_id", "account_id")),
        ),
    ),
}

REAL_COLLECTIONS = frozenset(SPECS)
UNIQUE_TABLE = "t_row_unique"
UNIQUE_INDEX = ("idx_t_row_unique_doc", ("company_id", "collection", "doc_id"))


def collection_for(company_id: str, name: str) -> "TableCollection":
    cid = str(company_id or "").strip()
    coll = str(name or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    if coll not in SPECS:
        raise ValueError("collection gerçek tablo değil")
    return TableCollection(storage_shared_v2.get_store(), cid, coll, SPECS[coll])


def stored_value(body, field: str, width: int):
    """Kolona yazılacak kısa metin. Kesilen değer belgede tam durur."""
    if not isinstance(body, dict) or field not in body:
        return None
    value = body[field]
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        text = value
    elif isinstance(value, int):
        text = str(value)
    elif isinstance(value, float):
        text = format(value, "f").rstrip("0").rstrip(".")
        if text in ("", "-", "-0"):
            text = "0"
    else:
        return None
    if len(text) > width:
        return text[:width]
    return text


class TableCollection(SharedV2Collection):
    def __init__(self, store, company_id: str, name: str, spec: Spec):
        super().__init__(store, company_id, name)
        self.spec = spec

    def _data_table(self) -> str:
        return self.spec.table

    def _unique_table(self) -> str:
        return UNIQUE_TABLE

    def _scope(self):
        return "company_id=?", [self.company_id]

    def _column(self, field):
        return self.spec.columns.get(field)

    def _bad_column(self, field) -> bool:
        return False

    def _backfill_query(self):
        # tenant-ok: koleksiyonun benzersiz anahtarı tüm firmalara aynıdır; satır firma kimliğiyle yazılır.
        return (f"SELECT company_id, id, doc FROM {self._data_table()}", ())

    def _insert_row(self, body) -> None:
        self._guard_key(body)
        columns = ["id", "company_id", "doc"]
        params = [str(body["_id"]), self.company_id, storage_shared_v2.dumps(body)]
        for column, field, width in self.spec.fields:
            columns.append(column)
            params.append(stored_value(body, field, width))
        marks = ",".join(["?"] * len(columns))
        names = ", ".join(columns)
        self._run(
            f"INSERT INTO {self._data_table()} ({names}) VALUES ({marks})",
            tuple(params),
        )

    def _update_row(self, body, doc_id) -> None:
        self._guard_key(body)
        sets = ["doc=?"]
        params = [storage_shared_v2.dumps(body)]
        for column, field, width in self.spec.fields:
            sets.append(f"{column}=?")
            params.append(stored_value(body, field, width))
        scope, scope_params = self._scope()
        params.extend(scope_params)
        params.append(str(doc_id))
        self._run(
            f"UPDATE {self._data_table()} SET {', '.join(sets)} WHERE {scope} AND id=?",
            tuple(params),
        )

    def _guard_key(self, body) -> None:
        if len(self.company_id) > COMPANY_WIDTH:
            raise ValueError(f"company_id alanı {COMPANY_WIDTH} karakterden uzun")
        if len(str(body.get("_id") or "")) > ID_WIDTH:
            raise ValueError(f"_id alanı {ID_WIDTH} karakterden uzun")

    def _log_fallback(self, reason: str) -> None:
        log.warning("storage_tables pushdown yok collection=%s neden=%s", self.name, reason or "query")
