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

CREATE TABLE IF NOT EXISTS system_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  level VARCHAR(16) NOT NULL,
  category VARCHAR(32) NOT NULL,
  event VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NULL,
  user_email VARCHAR(191) NULL,
  company_id VARCHAR(64) NULL,
  ip VARCHAR(64) NULL,
  method VARCHAR(16) NULL,
  path VARCHAR(512) NULL,
  status_code SMALLINT NULL,
  duration_ms INT NULL,
  collection_name VARCHAR(128) NULL,
  message TEXT NOT NULL,
  details JSON NULL,
  PRIMARY KEY (id),
  KEY idx_syslogs_created (created_at),
  KEY idx_syslogs_cat_created (category, created_at),
  KEY idx_syslogs_user (user_email, created_at),
  KEY idx_syslogs_event (event, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
