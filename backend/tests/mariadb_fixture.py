"""MariaDB testleri worker başına ayrı veritabanı kullanır.

xdist modülleri aynı DSN'i paylaşırsa DROP TABLE birbirini keser.
Veritabanı harmanı utf8mb4_uca1400_ai_ci'dir; COLLATE yazmayan tablo
MariaDB 11.8'de bunu devralır.
"""
from __future__ import annotations

import os
from urllib.parse import unquote, urlparse


def isolated_dsn(dsn: str) -> str:
    import pymysql

    parsed = urlparse(dsn.replace("mariadb://", "mysql://", 1).replace("mysql+pymysql://", "mysql://", 1))
    base = (parsed.path or "/tamkobi").lstrip("/").split("?")[0] or "tamkobi"
    safe = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in base)[:24]
    name = f"{safe}_w{os.getpid()}"
    admin = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=5,
    )
    try:
        with admin.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci"
            )
    finally:
        admin.close()
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 3306
    auth = user if not password else f"{user}:{password}"
    query = f"?{parsed.query}" if parsed.query else ""
    scheme = "mariadb" if dsn.startswith("mariadb") else "mysql"
    return f"{scheme}://{auth}@{host}:{port}/{name}{query}"
