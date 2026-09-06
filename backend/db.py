"""Database factory — TamKobi uses MySQL (JSON document tables)."""
from typing import Optional
from mysql_store import MySQLClient, MySQLDatabase, mysql_settings_from_env

def get_client() -> MySQLClient:
    return MySQLClient()

def get_database(name: Optional[str] = None) -> MySQLDatabase:
    client = get_client()
    settings = mysql_settings_from_env()
    return client[name or settings["db"]]
    client = get_client()
    settings = mysql_settings_from_env()
    return client[name or settings["db"]]
