-- TamKobi MySQL schema (also created automatically on backend startup)
CREATE DATABASE IF NOT EXISTS tamkobi
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tamkobi;

CREATE TABLE IF NOT EXISTS docs (
  collection VARCHAR(128) NOT NULL,
  id VARCHAR(191) NOT NULL,
  doc JSON NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (collection, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_indexes (
  collection VARCHAR(128) NOT NULL,
  name VARCHAR(191) NOT NULL,
  spec JSON NOT NULL,
  unique_index TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (collection, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
