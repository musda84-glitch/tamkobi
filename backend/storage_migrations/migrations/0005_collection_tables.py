"""Büyük koleksiyonların gerçek tabloları.

0003 docs_v2 ve 0004 storage_records ile tablo paylaşmaz. Sıra bağımsızdır.
Her tablo bir koleksiyondur: id, company_id ve sık sorgulanan kolonlar
gerçektir; belgenin tamamı doc içindedir. SQLite doc LONGTEXT, MySQL JSON.

İndeksler (company_id, tarih), (company_id, durum), (company_id, cari/ürün)
ve belge numarasıdır. Tekrar çalışınca CREATE TABLE IF NOT EXISTS ve
var olan indeks atlanır.

Uzun metin kolona sığmazsa uygulama yazmadan keser; tam değer doc'tadır.
Benzersiz anahtarlar t_row_unique birincil anahtarındadır.
"""

_ORDERS = (
    "order_date VARCHAR(40)",
    "order_status VARCHAR(64)",
    "contact_id VARCHAR(64)",
    "order_number VARCHAR(64)",
    "total_amount VARCHAR(64)",
    "channel VARCHAR(64)",
)

_INVOICES = (
    "issue_date VARCHAR(40)",
    "status VARCHAR(64)",
    "contact_id VARCHAR(64)",
    "invoice_number VARCHAR(64)",
    "grand_total VARCHAR(64)",
)

_STOCK = (
    "doc_date VARCHAR(40)",
    "status VARCHAR(64)",
    "product_id VARCHAR(64)",
    "doc_no VARCHAR(64)",
    "amount VARCHAR(64)",
)

_BANK = (
    "doc_date VARCHAR(40)",
    "match_status VARCHAR(64)",
    "contact_id VARCHAR(64)",
    "account_id VARCHAR(64)",
    "doc_no VARCHAR(64)",
    "amount VARCHAR(64)",
)

_UNIQUE = """
CREATE TABLE IF NOT EXISTS t_row_unique (
  company_id VARCHAR(64) NOT NULL,
  collection VARCHAR(128) NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  field_value VARCHAR(191) NOT NULL,
  value_hash CHAR(64) NOT NULL,
  doc_id VARCHAR(191) NOT NULL,
  PRIMARY KEY (company_id, collection, field_name, value_hash)
)
""".strip()

_INDEXES = (
    ("idx_t_orders_date", "t_orders", "company_id, order_date"),
    ("idx_t_orders_status", "t_orders", "company_id, order_status"),
    ("idx_t_orders_contact", "t_orders", "company_id, contact_id"),
    ("idx_t_orders_number", "t_orders", "company_id, order_number"),
    ("idx_t_invoices_date", "t_invoices", "company_id, issue_date"),
    ("idx_t_invoices_status", "t_invoices", "company_id, status"),
    ("idx_t_invoices_contact", "t_invoices", "company_id, contact_id"),
    ("idx_t_invoices_number", "t_invoices", "company_id, invoice_number"),
    ("idx_t_stock_moves_date", "t_stock_moves", "company_id, doc_date"),
    ("idx_t_stock_moves_status", "t_stock_moves", "company_id, status"),
    ("idx_t_stock_moves_product", "t_stock_moves", "company_id, product_id"),
    ("idx_t_bank_tx_date", "t_bank_transactions", "company_id, doc_date"),
    ("idx_t_bank_tx_status", "t_bank_transactions", "company_id, match_status"),
    ("idx_t_bank_tx_contact", "t_bank_transactions", "company_id, contact_id"),
    ("idx_t_bank_tx_account", "t_bank_transactions", "company_id, account_id"),
    ("idx_t_row_unique_doc", "t_row_unique", "company_id, collection, doc_id"),
)


def _table(kind: str, name: str, columns) -> str:
    doc = "doc JSON NOT NULL" if kind == "mysql" else "doc LONGTEXT NOT NULL"
    body = [
        "id VARCHAR(191) NOT NULL",
        "company_id VARCHAR(64) NOT NULL",
        *columns,
        doc,
        "PRIMARY KEY (company_id, id)",
    ]
    sql = "CREATE TABLE IF NOT EXISTS " + name + " (\n  " + ",\n  ".join(body) + "\n)"
    if kind == "mysql":
        sql += " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC"
    return sql


def _indexes(guard: bool):
    prefix = "CREATE INDEX IF NOT EXISTS" if guard else "CREATE INDEX"
    return [
        f"{prefix} {name} ON {table} ({columns})"
        for name, table, columns in _INDEXES
    ]


def _steps(kind: str, guard: bool):
    return [
        _table(kind, "t_orders", _ORDERS),
        _table(kind, "t_invoices", _INVOICES),
        _table(kind, "t_stock_moves", _STOCK),
        _table(kind, "t_bank_transactions", _BANK),
        _UNIQUE,
        *_indexes(guard),
    ]


STEPS = _steps("sqlite", True)
MYSQL_STEPS = _steps("mysql", False)
