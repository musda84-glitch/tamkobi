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

import json
import logging
from decimal import Decimal

import storage_shared_v2
from storage_shared_v2 import SharedV2Collection

log = logging.getLogger("storage_tables")

DATE_WIDTH = 40
TEXT_WIDTH = 64
ID_WIDTH = 191
COMPANY_WIDTH = 64
DECIMAL_SQL = "DECIMAL(18,4)"
_DECIMAL_SCALE = Decimal("0.0001")
_DECIMAL_LIMIT = Decimal(10) ** 14


class Spec:
    def __init__(self, table, fields, indexes, numeric=()):
        self.table = table
        self.fields = tuple(fields)
        self.indexes = tuple(indexes)
        self.numeric = frozenset(numeric)
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
            ("idx_t_orders_amount", ("company_id", "total_amount")),
        ),
        numeric=("total_amount",),
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
            ("idx_t_invoices_total", ("company_id", "grand_total")),
        ),
        numeric=("grand_total",),
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
            ("idx_t_stock_moves_amount", ("company_id", "amount")),
        ),
        numeric=("change",),
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
            ("idx_t_bank_tx_amount", ("company_id", "amount")),
        ),
        numeric=("amount",),
    ),
}

REAL_COLLECTIONS = frozenset(SPECS)
UNIQUE_TABLE = "t_row_unique"
UNIQUE_INDEX = ("idx_t_row_unique_doc", ("company_id", "collection", "doc_id"))


def _query_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    if isinstance(value, float):
        text = format(value, "f").rstrip("0").rstrip(".")
        if text in ("", "-", "-0"):
            text = "0"
    else:
        text = str(value)
    try:
        number = Decimal(text)
    except Exception:
        return None
    if not number.is_finite():
        return None
    return format(number.quantize(_DECIMAL_SCALE), "f")


def collection_for(company_id: str, name: str) -> "TableCollection":
    cid = str(company_id or "").strip()
    coll = str(name or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    if coll not in SPECS:
        raise ValueError("collection gerçek tablo değil")
    return TableCollection(storage_shared_v2.get_store(), cid, coll, SPECS[coll])


def _encoded(body):
    """Belgenin doc ile aynı JSON hali. datetime ve Decimal default=str ile metin olur."""
    if not isinstance(body, dict):
        return {}
    loaded = json.loads(storage_shared_v2.dumps(body))
    return loaded if isinstance(loaded, dict) else {}


def _scalar(body, field: str):
    if not isinstance(body, dict) or field not in body:
        return None
    value = _encoded(body).get(field)
    if value is None or isinstance(value, (bool, dict, list)):
        return None
    return value


def _text_of(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        text = format(value, "f").rstrip("0").rstrip(".")
        if text in ("", "-", "-0"):
            return "0"
        return text
    return ""


def stored_value(body, field: str, width: int):
    """Kolona yazılacak kısa metin. doc ile aynı JSON skalerinden kırpılır."""
    value = _scalar(body, field)
    if value is None:
        return None
    text = _text_of(value)
    if text == "" and not isinstance(value, str):
        return None
    if len(text) > width:
        return text[:width]
    return text


def stored_decimal(body, field: str):
    """Sayı kolonuna yazılacak DECIMAL metni. Aralık sorgusu bu kolonu indeksler.

    JSON sayısı ve sayıya dönen metin (Decimal'ın str hali) yazılır.
    Sayı olmayan metin NULL kalır; tam değer doc'tadır.
    """
    value = _scalar(body, field)
    if value is None:
        return None
    text = _text_of(value).strip()
    if text == "":
        return None
    try:
        number = Decimal(text)
    except Exception:
        return None
    if not number.is_finite():
        return None
    quantized = number.quantize(_DECIMAL_SCALE)
    if quantized.copy_abs() >= _DECIMAL_LIMIT:
        raise ValueError(f"{field} alanı DECIMAL sınırını aşıyor")
    return format(quantized, "f")


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
            params.append(self._column_param(body, field, width))
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
            params.append(self._column_param(body, field, width))
        scope, scope_params = self._scope()
        params.extend(scope_params)
        params.append(str(doc_id))
        self._run(
            f"UPDATE {self._data_table()} SET {', '.join(sets)} WHERE {scope} AND id=?",
            tuple(params),
        )

    def _column_param(self, body, field: str, width: int):
        if field in self.spec.numeric:
            return stored_decimal(body, field)
        return stored_value(body, field, width)

    def _cmp_sql(self, field, symbol, value):
        if field in self.spec.numeric and _query_number(value) is not None:
            column = self.spec.columns[field][0]
            return f"({column} {symbol} ?)", [_query_number(value)], [field]
        return super()._cmp_sql(field, symbol, value)

    def _search_expr(self, field, value, allow_equal: bool):
        if field in self.spec.numeric:
            return self._full_text(field)
        return super()._search_expr(field, value, allow_equal)

    def _eq_pred(self, field, value):
        if field in self.spec.numeric:
            return f"{self._full_text(field)} = ?", [value]
        return super()._eq_pred(field, value)

    def _nonscalar_sql(self, field):
        if field in self.spec.numeric:
            if self.store.dialect == "mysql":
                return (
                    f"JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) IS NOT NULL "
                    f"AND JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) NOT IN "
                    "('INTEGER', 'DOUBLE', 'DECIMAL', 'NULL')"
                )
            return (
                f"json_type(doc, '$.{field}') IS NOT NULL "
                f"AND json_type(doc, '$.{field}') NOT IN ('integer', 'real', 'null')"
            )
        return super()._nonscalar_sql(field)

    def _guard_key(self, body) -> None:
        if len(self.company_id) > COMPANY_WIDTH:
            raise ValueError(f"company_id alanı {COMPANY_WIDTH} karakterden uzun")
        if len(str(body.get("_id") or "")) > ID_WIDTH:
            raise ValueError(f"_id alanı {ID_WIDTH} karakterden uzun")

    def _log_fallback(self, reason: str) -> None:
        log.warning("storage_tables pushdown yok collection=%s neden=%s", self.name, reason or "query")
