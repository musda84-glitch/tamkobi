-- Dedicated belge tablosu. docs tablosuna dokunulmaz.
CREATE TABLE IF NOT EXISTS storage_records (
  collection VARCHAR(128) NOT NULL,
  doc_id VARCHAR(191) NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (collection, doc_id)
);
