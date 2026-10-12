#!/usr/bin/env python3
"""Acil durum: süper admin TOTP 2FA sıfırlama (telefon kaybı).

Otomatik silme YAPMAZ; yalnızca totp_* / pending_2fa_* alanlarını ve
2fa:* kilit kayıtlarını temizler.

Canlı sunucu:

  cd /var/www/tamkobi.com/backend && sudo CONFIRM=yes venv/bin/python scripts/reset_superadmin_2fa.py

Yerel:

  cd backend
  CONFIRM=yes python scripts/reset_superadmin_2fa.py

İsteğe bağlı:
  SUPERADMIN_EMAIL=platform@ornek.com   (verilmezse tüm is_super_admin)
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def _run() -> int:
    if os.environ.get("CONFIRM", "").strip().lower() not in ("yes", "1", "true"):
        print(
            "REDDEDİLDİ: Bu script süper admin 2FA'yı sıfırlar.\n"
            "Canlı: cd /var/www/tamkobi.com/backend && sudo CONFIRM=yes venv/bin/python scripts/reset_superadmin_2fa.py\n"
            "Onay: CONFIRM=yes python scripts/reset_superadmin_2fa.py\n"
            "İsteğe bağlı: SUPERADMIN_EMAIL=...\n"
        )
        return 2

    from dotenv import load_dotenv
    load_dotenv()
    try:
        from setup_state import apply_saved_secrets
        apply_saved_secrets()
    except Exception:
        pass

    from mysql_store import MySQLClient, mysql_settings_from_env

    client = MySQLClient()
    db_name = str(mysql_settings_from_env().get("db") or "tamkobi").strip()
    db = client[db_name]
    try:
        await db._ensure()

        email = (os.environ.get("SUPERADMIN_EMAIL") or "").strip().lower()
        query = {"is_super_admin": True}
        if email:
            query["email"] = email

        users = await db.users.find(query).to_list(100)
        if not users:
            print("OK: eşleşen süper admin yok — işlem gerekmedi.")
            return 0

        now = datetime.now(timezone.utc).isoformat()
        for user in users:
            uid = user.get("_id")
            await db.users.update_one(
                {"_id": uid},
                {
                    "$set": {
                        "totp_enabled": False,
                        "totp_secret": "",
                        "totp_recovery_hashes": [],
                        "totp_last_counter": None,
                        "pending_2fa_jti": "",
                        "pending_2fa_attempts": 0,
                        "totp_reset_at": now,
                        "updated_at": now,
                    },
                    "$unset": {"totp_setup_started_at": "", "totp_enabled_at": ""},
                },
            )
            await db.login_attempts.delete_one({"identifier": f"2fa:{uid}"})
            print(f"TAMAM: {user.get('email')} (id={uid}) 2FA sıfırlandı; 2fa:{uid} kilit temizlendi.")

        print(
            f"Toplam {len(users)} hesap. Yeniden girişte (zorunluluk açıksa) kurulum ekranı gelir."
        )
        return 0
    finally:
        try:
            await client.close_async()
        except Exception:
            try:
                client.close()
            except Exception:
                pass


def main() -> int:
    try:
        return asyncio.run(_run())
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
