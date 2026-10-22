-- Dedicated belge deposu. İndeksli kolonlar VARCHAR, belge LONGTEXT.
CREATE TABLE IF NOT EXISTS storage_records (
  collection VARCHAR(128) NOT NULL,
  doc_id VARCHAR(191) NOT NULL,
  doc LONGTEXT NOT NULL,
  company_id VARCHAR(64) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))) STORED
);

CREATE UNIQUE INDEX uq_storage_records_doc ON storage_records (collection, doc_id);

CREATE INDEX idx_storage_records_company ON storage_records (collection, company_id);
