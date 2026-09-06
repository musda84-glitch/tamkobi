"""Database factory — TamKobi uses MySQL 8 (JSON document tables)."""
from typing import Optional

from mysql_store import (
    MySQLClient,
    MySQLDatabase,
    SyncMySQLClient,
    SyncMySQLDatabase,
    mysql_settings_from_env,
)


def get_client() -> MySQLClient:
    return MySQLClient()


def get_database(name: Optional[str] = None) -> MySQLDatabase:
    settings = mysql_settings_from_env()
    return get_client()[name or settings["db"]]


def get_sync_database(name: Optional[str] = None) -> SyncMySQLDatabase:
    settings = mysql_settings_from_env()
    return SyncMySQLClient()[name or settings["db"]]
