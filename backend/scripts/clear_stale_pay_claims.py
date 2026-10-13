#!/usr/bin/env python3
"""Bayat ödeme kilitlerini listele (varsayılan dry-run) veya temizle.

Ödeme sırasında süreç çökerse belgede `_pay_claimed_at` kalır. Bu komut
5 dakikadan (veya --older-than-minutes) eski kilitleri yazar.
Ödeme idempotency anahtarıyla yazılmışsa kilit kapanırken kayıt ödendi yapılır;
yazılmamışsa yalnız kilit bırakılır, tekrar ödeme denenebilir.

  python backend/scripts/clear_stale_pay_claims.py
  python backend/scripts/clear_stale_pay_claims.py --company comp_xxx --dry-run
  python backend/scripts/clear_stale_pay_claims.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bayat _pay_claimed_at kilitlerini listele veya temizle")
    parser.add_argument("--company", default="", help="Yalnızca bu company_id")
    parser.add_argument("--older-than-minutes", type=float, default=5.0, help="Bu süreden eski kilitler bayattır")
    parser.add_argument("--dry-run", action="store_true", help="Yalnızca listele (varsayılan)")
    parser.add_argument("--apply", action="store_true", help="Kilitleri bırak / yazılmış ödemeyi kapat")
    return parser


async def _main(company_id: str, minutes: float, apply: bool) -> int:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    try:
        from setup_state import apply_saved_secrets

        apply_saved_secrets()
    except Exception:
        pass

    from mysql_store import MySQLClient
    import pay_claim

    db = MySQLClient()
    report = await pay_claim.clear_stale_claims(
        db,
        dry_run=not apply,
        stale_after=timedelta(minutes=minutes),
        company_id=company_id,
    )
    if report["dry_run"]:
        print(f"dry-run: {report['count']} bayat kilit. Veritabanı değişmedi.")
    else:
        print(
            f"uygulandı: {report['released']} kilit bırakıldı, "
            f"{report['finalized']} yazılmış ödeme kapatıldı."
        )
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 0


def main() -> None:
    args = build_parser().parse_args()
    raise SystemExit(asyncio.run(_main(args.company.strip(), float(args.older_than_minutes), bool(args.apply))))


if __name__ == "__main__":
    main()
