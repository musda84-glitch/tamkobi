-- TamKobi MySQL 8.0 physical schema
-- Canonical source: also applied automatically by backend/mysql_store.py on startup.
-- Logical ERP entities are JSON documents in `docs.collection`, not SQL tables.
-- Full map: docs/mysql-schema.md

CREATE DATABASE IF NOT EXISTS tamkobi
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tamkobi;

-- Motor/Mongo-compatible document store. One row = one JSON document.
-- PK (collection, id) is the Mongo (collection, _id) pair.
-- id is VARCHAR(191) so utf8mb4 primary keys stay under the 767-byte InnoDB limit.
CREATE TABLE IF NOT EXISTS docs (
  collection VARCHAR(128) NOT NULL,
  id VARCHAR(191) NOT NULL,
  doc JSON NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (collection, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Application-level unique / lookup indexes (enforced in Python, not as SQL UNIQUE).
-- Seeded at API startup: users.email (unique), products.sku, products.barcode,
-- contacts.tax_number_or_id, invoices.invoice_number, orders.order_number,
-- login_attempts.identifier.
CREATE TABLE IF NOT EXISTS meta_indexes (
  collection VARCHAR(128) NOT NULL,
  name VARCHAR(191) NOT NULL,
  spec JSON NOT NULL,
  unique_index TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (collection, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
