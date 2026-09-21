"""Banka bağlantıları için arka plan senkron seçimi."""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional

from bank_providers import has_credentials

BANK_AUTO_SYNC_INTERVAL_S = 600
BANK_AUTO_SYNC_STARTUP_DELAY_S = 30


def should_background_sync(conn: Optional[Dict[str, Any]]) -> bool:
    """auto_sync açık ve canlı kimlik bilgisi olan bağlantılar arka planda çekilir.

    Simüle (anahtarsız) bağlantılar her turda sahte hareket üretmesin diye hariç.
    """
    if not conn:
        return False
    if conn.get("auto_sync") is False:
        return False
    if conn.get("mode") == "simulation":
        return False
    if (conn.get("status") or "") == "disconnected":
        return False
    return has_credentials(conn)


async def run_bank_auto_sync_tick(
    connections: List[Dict[str, Any]],
    sync_one: Callable[[Dict[str, Any]], Awaitable[Any]],
) -> List[str]:
    synced: List[str] = []
    for conn in connections:
        if not should_background_sync(conn):
            continue
        cid = str(conn.get("_id") or conn.get("id") or "")
        try:
            await sync_one(conn)
        except Exception:
            continue
        if cid:
            synced.append(cid)
    return synced
