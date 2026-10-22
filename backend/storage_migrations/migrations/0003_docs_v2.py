"""docs_v2 şeması.

storage_records tablosuna bakmaz. 0004 ile sıra bağımsızdır.

SQLite json_extract kullanır. MySQL/MariaDB generated kolon
LEFT(JSON_UNQUOTE(JSON_EXTRACT(...)), n) olur ve VARCHAR(n) olarak indekslenir.
Kesme olmazsa strict modda uzun metin 1406 verir. TEXT generated kolon
prefixsiz indekste 1170 verir. doc MySQL'de JSON, SQLite'ta LONGTEXT'tir.

Benzersiz alanlar koleksiyon bazında çalışma anında bildirilir. status gibi
alanlar firma içinde tekrar eder, bu yüzden generated kolonların hepsine
UNIQUE konmaz. Eşzamanlı yazmayı docs_v2_unique birincil anahtarı tutar:
(company_id, collection, field_name, value_hash). value_hash tam değerin
SHA-256 hex özetidir; uzun metin field_value sınırına takılmaz.
"""

_FIELDS = (
    ("g_status", "status", 64),
    ("g_contact_id", "contact_id", 64),
    ("g_date", "date", 32),
    ("g_created_at", "created_at", 40),
    ("g_account_id", "account_id", 64),
    ("g_invoice_number", "invoice_number", 64),
    ("g_sku", "sku", 64),
    ("g_barcode", "barcode", 64),
    ("g_partner_id", "partner_id", 64),
    ("g_account_name", "account_name", 191),
    ("g_issue_date", "issue_date", 32),
    ("g_order_number", "order_number", 64),
)

_UNIQUE = """
CREATE TABLE IF NOT EXISTS docs_v2_unique (
  company_id VARCHAR(64) NOT NULL,
  collection VARCHAR(128) NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  field_value VARCHAR(191) NOT NULL,
  value_hash CHAR(64) NOT NULL,
  doc_id VARCHAR(191) NOT NULL,
  PRIMARY KEY (company_id, collection, field_name, value_hash)
)
""".strip()


def _table(kind: str) -> str:
    columns = [
        "company_id VARCHAR(64) NOT NULL",
        "collection VARCHAR(128) NOT NULL",
        "id VARCHAR(191) NOT NULL",
        "doc JSON NOT NULL" if kind == "mysql" else "doc LONGTEXT NOT NULL",
    ]
    for column, field, length in _FIELDS:
        if kind == "mysql":
            value = f"LEFT(JSON_UNQUOTE(JSON_EXTRACT(doc, '$.{field}')), {length})"
            marker = (
                f"CASE WHEN JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) IS NULL "
                f"OR JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) IN ('STRING', 'NULL') "
                f"THEN NULL ELSE '1' END"
            )
        else:
            value = f"substr(json_extract(doc, '$.{field}'), 1, {length})"
            marker = (
                f"CASE WHEN json_type(doc, '$.{field}') IS NULL "
                f"OR json_type(doc, '$.{field}') IN ('text', 'null') "
                f"THEN NULL ELSE '1' END"
            )
        columns.append(
            f"{column} VARCHAR({length}) GENERATED ALWAYS AS ({value}) STORED"
        )
        columns.append(
            f"{column}_bad VARCHAR(1) GENERATED ALWAYS AS ({marker}) STORED"
        )
    columns.append("PRIMARY KEY (company_id, collection, id)")
    body = "CREATE TABLE IF NOT EXISTS docs_v2 (\n  " + ",\n  ".join(columns) + "\n)"
    if kind == "mysql":
        body += " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC"
    return body


def _indexes(guard: bool) -> list:
    prefix = "CREATE INDEX IF NOT EXISTS" if guard else "CREATE INDEX"
    steps = []
    for column, field, _length in _FIELDS:
        steps.append(
            f"{prefix} idx_v2_{field} ON docs_v2 (company_id, collection, {column})"
        )
        steps.append(
            f"{prefix} idx_v2_{field}_bad ON docs_v2 (company_id, collection, {column}_bad)"
        )
    steps.append(
        f"{prefix} idx_v2_unique_doc ON docs_v2_unique (company_id, collection, doc_id)"
    )
    return steps


STEPS = [_table("sqlite"), _UNIQUE, *_indexes(True)]
MYSQL_STEPS = [_table("mysql"), _UNIQUE, *_indexes(False)]
