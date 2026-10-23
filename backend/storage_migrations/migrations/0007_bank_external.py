"""Banka hareketinde (company_id, external_id) tekilliği.

Yalnız storage_bank_external tablosunu açar. storage_records satırına
dokunmaz, mevcut kopyayı silmez. Boş external_id bu tabloya yazılmaz.
İkinci kez çalışınca CREATE TABLE IF NOT EXISTS yeni satır eklemez.
MySQL harmanı utf8mb4_bin: company_id büyük-küçük harfi ayırır.
"""

_TABLE = """
CREATE TABLE IF NOT EXISTS storage_bank_external (
  company_id VARCHAR(64) NOT NULL,
  external_id VARCHAR(191) NOT NULL,
  doc_id VARCHAR(191) NOT NULL,
  PRIMARY KEY (company_id, external_id)
)
""".strip()

STEPS = [_TABLE]
MYSQL_STEPS = [
    _TABLE + " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin",
]
