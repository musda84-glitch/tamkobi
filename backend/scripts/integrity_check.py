#!/usr/bin/env python3
"""Veri tutarlılığı: orphan hareket / eksik bağ / kasa kayması tarama (ve isteğe bağlı cleanup).

Örnek:
  python backend/scripts/integrity_check.py --company comp_nexus_main_01 --dry-run
  python backend/scripts/integrity_check.py --company comp_xxx --apply
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def _main(company_id: str, dry_run: bool, apply: bool) -> int:
    from mysql_store import MySQLClient
    import linked_moves

    db = MySQLClient()
    # reverse_tx optional for scan; cleanup needs it for bank effects
    try:
        import server as srv
        linked_moves.init(db, reverse_tx_fn=srv._reverse_tx_effects)
    except Exception:
        linked_moves.init(db)

    report = await linked_moves.scan_orphans(db, company_id)
    print(json.dumps({"scan": report["summary"], "company_id": company_id}, ensure_ascii=False, indent=2))
    if apply or not dry_run:
        # --apply forces write; default is dry-run
        do_dry = dry_run and not apply
        result = await linked_moves.cleanup_orphans(db, company_id, dry_run=do_dry, actor={"name": "cli:integrity_check"})
        print(json.dumps({"cleanup": {"dry_run": result["dry_run"], "actions": len(result["actions"]), "drift_fixes": len(result["drift_fixes"])}}, ensure_ascii=False, indent=2))
        if os.environ.get("INTEGRITY_VERBOSE"):
            print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    else:
        print(json.dumps({
            "orphan_bonus_moves": len(report["orphan_bonus_moves"]),
            "orphan_payroll_moves": len(report["orphan_payroll_moves"]),
            "orphan_loan_moves": len(report["orphan_loan_moves"]),
            "paid_bonus_without_moves": len(report["paid_bonus_without_moves"]),
            "paid_payroll_without_moves": len(report["paid_payroll_without_moves"]),
            "cash_balance_drift": report["cash_balance_drift"],
            "heuristic_bonus_links": len(report["heuristic_bonus_links"]),
        }, ensure_ascii=False, indent=2, default=str))
    return 0


def main():
    p = argparse.ArgumentParser(description="TamKobi linked-move integrity check")
    p.add_argument("--company", required=True, help="company_id")
    p.add_argument("--dry-run", action="store_true", default=True, help="Değişiklik yapma (varsayılan)")
    p.add_argument("--apply", action="store_true", help="Cleanup uygula (dry-run kapalı)")
    args = p.parse_args()
    raise SystemExit(asyncio.run(_main(args.company, dry_run=True, apply=args.apply)))


if __name__ == "__main__":
    main()
