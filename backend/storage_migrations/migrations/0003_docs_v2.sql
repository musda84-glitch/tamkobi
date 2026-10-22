-- Firma satirinin anahtari company_id. JSON alanlari generated kolon + index.
-- Secim: status, contact_id, date, created_at, account_id, invoice_number,
-- sku, barcode, partner_id, account_name, issue_date, order_number.
CREATE TABLE IF NOT EXISTS docs_v2 (
  company_id VARCHAR(64) NOT NULL,
  collection VARCHAR(128) NOT NULL,
  id VARCHAR(191) NOT NULL,
  doc TEXT NOT NULL,
  g_status TEXT GENERATED ALWAYS AS (json_extract(doc, '$.status')) STORED,
  g_contact_id TEXT GENERATED ALWAYS AS (json_extract(doc, '$.contact_id')) STORED,
  g_date TEXT GENERATED ALWAYS AS (json_extract(doc, '$.date')) STORED,
  g_created_at TEXT GENERATED ALWAYS AS (json_extract(doc, '$.created_at')) STORED,
  g_account_id TEXT GENERATED ALWAYS AS (json_extract(doc, '$.account_id')) STORED,
  g_invoice_number TEXT GENERATED ALWAYS AS (json_extract(doc, '$.invoice_number')) STORED,
  g_sku TEXT GENERATED ALWAYS AS (json_extract(doc, '$.sku')) STORED,
  g_barcode TEXT GENERATED ALWAYS AS (json_extract(doc, '$.barcode')) STORED,
  g_partner_id TEXT GENERATED ALWAYS AS (json_extract(doc, '$.partner_id')) STORED,
  g_account_name TEXT GENERATED ALWAYS AS (json_extract(doc, '$.account_name')) STORED,
  g_issue_date TEXT GENERATED ALWAYS AS (json_extract(doc, '$.issue_date')) STORED,
  g_order_number TEXT GENERATED ALWAYS AS (json_extract(doc, '$.order_number')) STORED,
  g_status_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.status') IS NULL OR json_type(doc, '$.status') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_contact_id_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.contact_id') IS NULL OR json_type(doc, '$.contact_id') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_date_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.date') IS NULL OR json_type(doc, '$.date') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_created_at_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.created_at') IS NULL OR json_type(doc, '$.created_at') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_account_id_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.account_id') IS NULL OR json_type(doc, '$.account_id') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_invoice_number_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.invoice_number') IS NULL OR json_type(doc, '$.invoice_number') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_sku_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.sku') IS NULL OR json_type(doc, '$.sku') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_barcode_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.barcode') IS NULL OR json_type(doc, '$.barcode') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_partner_id_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.partner_id') IS NULL OR json_type(doc, '$.partner_id') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_account_name_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.account_name') IS NULL OR json_type(doc, '$.account_name') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_issue_date_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.issue_date') IS NULL OR json_type(doc, '$.issue_date') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  g_order_number_bad TEXT GENERATED ALWAYS AS (CASE WHEN json_type(doc, '$.order_number') IS NULL OR json_type(doc, '$.order_number') IN ('text', 'null', 'STRING', 'NULL') THEN NULL ELSE '1' END) STORED,
  PRIMARY KEY (company_id, collection, id)
);

CREATE INDEX idx_v2_status ON docs_v2 (company_id, collection, g_status);
CREATE INDEX idx_v2_contact_id ON docs_v2 (company_id, collection, g_contact_id);
CREATE INDEX idx_v2_date ON docs_v2 (company_id, collection, g_date);
CREATE INDEX idx_v2_created_at ON docs_v2 (company_id, collection, g_created_at);
CREATE INDEX idx_v2_account_id ON docs_v2 (company_id, collection, g_account_id);
CREATE INDEX idx_v2_invoice_number ON docs_v2 (company_id, collection, g_invoice_number);
CREATE INDEX idx_v2_sku ON docs_v2 (company_id, collection, g_sku);
CREATE INDEX idx_v2_barcode ON docs_v2 (company_id, collection, g_barcode);
CREATE INDEX idx_v2_partner_id ON docs_v2 (company_id, collection, g_partner_id);
CREATE INDEX idx_v2_account_name ON docs_v2 (company_id, collection, g_account_name);
CREATE INDEX idx_v2_issue_date ON docs_v2 (company_id, collection, g_issue_date);
CREATE INDEX idx_v2_order_number ON docs_v2 (company_id, collection, g_order_number);
CREATE INDEX idx_v2_status_bad ON docs_v2 (company_id, collection, g_status_bad);
CREATE INDEX idx_v2_contact_id_bad ON docs_v2 (company_id, collection, g_contact_id_bad);
CREATE INDEX idx_v2_date_bad ON docs_v2 (company_id, collection, g_date_bad);
CREATE INDEX idx_v2_created_at_bad ON docs_v2 (company_id, collection, g_created_at_bad);
CREATE INDEX idx_v2_account_id_bad ON docs_v2 (company_id, collection, g_account_id_bad);
CREATE INDEX idx_v2_invoice_number_bad ON docs_v2 (company_id, collection, g_invoice_number_bad);
CREATE INDEX idx_v2_sku_bad ON docs_v2 (company_id, collection, g_sku_bad);
CREATE INDEX idx_v2_barcode_bad ON docs_v2 (company_id, collection, g_barcode_bad);
CREATE INDEX idx_v2_partner_id_bad ON docs_v2 (company_id, collection, g_partner_id_bad);
CREATE INDEX idx_v2_account_name_bad ON docs_v2 (company_id, collection, g_account_name_bad);
CREATE INDEX idx_v2_issue_date_bad ON docs_v2 (company_id, collection, g_issue_date_bad);
CREATE INDEX idx_v2_order_number_bad ON docs_v2 (company_id, collection, g_order_number_bad);
