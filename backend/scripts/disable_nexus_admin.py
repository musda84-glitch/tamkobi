#!/usr/bin/env python3
"""Tek seferlik, onaylı: canlıda kalan admin@nexus.com hesabını DEVRE DIŞI bırakır.

Otomatik silme YAPMAZ. Çalıştırmadan önce yedek alın.
Kullanım (onay zorunlu):

  cd backend
  CONFIRM_DISABLE_NEXUS_ADMIN=yes python scripts/disable_nexus_admin.py

İsteğe bağlı:
  NEXUS_ADMIN_EMAIL=admin@nexus.com  (varsayılan)
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

# backend kökünden çalıştırın
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main() -> int:
    if os.environ.get("CONFIRM_DISABLE_NEXUS_ADMIN", "").strip().lower() not in ("yes", "1", "true"):
        print(
            "REDDEDİLDİ: Bu script hesabı pasifleştirir.\n"
            "Onay için: CONFIRM_DISABLE_NEXUS_ADMIN=yes python scripts/disable_nexus_admin.py\n"
            "Silme yapılmaz; yalnızca is_active=false ve is_super_admin=false."
        )
        return 2

    email = (os.environ.get("NEXUS_ADMIN_EMAIL") or "admin@nexus.com").strip().lower()
    from dotenv import load_dotenv
    load_dotenv()
    try:
        from setup_state import apply_saved_secrets
        apply_saved_secrets()
    except Exception:
        pass

    from mysql_store import MySQLClient

    client = MySQLClient()
    db_name = (os.environ.get("DB_NAME") or os.environ.get("MYSQL_DATABASE") or "tamkobi").strip()
    db = client[db_name]
    await db._ensure()
    user = await db.users.find_one({"email": email})
    if not user:
        print(f"OK: {email} bulunamadı — işlem gerekmedi.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "is_active": False,
                "is_super_admin": False,
                "disabled_at": now,
                "disabled_reason": "security-p0: admin@nexus.com retired",
                "updated_at": now,
            }
        },
    )
    print(
        f"TAMAM: {email} (id={user.get('_id')}) pasifleştirildi; "
        "is_super_admin kaldırıldı. Kayıt silinmedi. "
        "JWT_SECRET değiştiyse tüm oturumlar zaten düşmüş olur."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
