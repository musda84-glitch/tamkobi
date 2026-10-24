"""sync_tombstones için saklama raporu.

Yalnız sayar. Silmez, şema değiştirmez, kendiliğinden çalışmaz.
apply=True bile satır silmez; çağrı reddedilir.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

RETENTION_DAYS = 30


def _collection(db):
    found = getattr(db, "sync_tombstones", None)
    if found is not None:
        return found
    return db["sync_tombstones"]


async def report_tombstones(
    db,
    *,
    older_than_days: int = RETENTION_DAYS,
    company_id: Optional[str] = None,
    now: Optional[datetime] = None,
    apply: bool = False,
) -> dict:
    """deleted_at eşiğinden eski mezar taşlarını say.

    Dönüş her zaman dry_run=True ve deleted=0. Veri silinmez.
    """
    if apply:
        raise ValueError("Tombstone temizliği kapalı. Bu yardımcı yalnız sayar.")
    days = int(older_than_days)
    if days < 1:
        days = RETENTION_DAYS
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    cutoff = (moment - timedelta(days=days)).isoformat()
    query = {"deleted_at": {"$lt": cutoff}}
    if company_id:
        query["company_id"] = str(company_id)
    count = int(await _collection(db).count_documents(query) or 0)
    return {
        "dry_run": True,
        "deleted": 0,
        "older_than_days": days,
        "cutoff": cutoff,
        "company_id": str(company_id) if company_id else None,
        "count": count,
    }
