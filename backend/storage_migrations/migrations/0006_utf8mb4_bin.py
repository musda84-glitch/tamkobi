"""docs_v2 ve docs_v2_unique harf büyüklüğünü ayırsın.

0003 bu tabloları açar. docs_v2_unique MySQL'de harman yazmaz; MariaDB 11.8
varsayılanı utf8mb4_uca1400_ai_ci olunca company_id büyük-küçük harf
duyarsızdır ve bir şirket diğerinin benzersizlik satırını siler.

MySQL adımı mevcut tabloyu utf8mb4_bin'e çevirir. İkinci kez çalışması
aynı harmanı yazar. SQLite zaten ikili karşılaştırır; adım 0001'in
şema satırını yeniden eklemez, tekrar çalışınca da satır yazmaz.
"""

STEPS = [
    """
    INSERT INTO storage_meta (meta_key, meta_value)
    SELECT 'schema', 'v2'
    WHERE NOT EXISTS (
      SELECT 1 FROM storage_meta WHERE meta_key = 'schema'
    )
    """,
]

MYSQL_STEPS = [
    "ALTER TABLE docs_v2 CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
    "ALTER TABLE docs_v2_unique CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
]
