#!/usr/bin/env python3
"""Sahipsiz GİB e-belge kontör cüzdanlarını raporlar.

Cüzdan `_id` hiçbir şirketin `_id` / `license_id` değeriyle ve hiçbir
`company_licenses._id` ile eşleşmiyorsa sahipsizdir. Rapor adet ve bakiye
toplamı verir.

Varsayılan dry-run'dur; veritabanına yazılmaz. `--apply` yalnız eşleşmesi
kesin olanları taşır:

- sahipsiz cüzdanın defterindeki company_id tek bir mevcut şirkete aitse ve
  o şirketin güncel cüzdan anahtarı (`license_id` ya da `_id`) farklıysa
- cüzdan `_id` bir şirketin `_id`'si ise ama bu kimlik artık hiçbir şirketin
  güncel cüzdan anahtarı değilse (üst firmaya bağlanınca geride kalan bakiye)

Hoş geldin kontörü açılmaz. Aynı transfer_id ikinci kez bakiyeyi artırmaz.
Belirsiz sahipsiz cüzdanlar yalnız raporda kalır.

  python backend/scripts/gib_wallet_orphans.py
  python backend/scripts/gib_wallet_orphans.py --dry-run
  python backend/scripts/gib_wallet_orphans.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logger = logging.getLogger("gib_wallet_orphans")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Sahipsiz GİB kontör cüzdanlarını listele veya taşı")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Yalnızca raporla (varsayılan)")
    mode.add_argument("--apply", action="store_true", help="Eşleşmesi kesin olan bakiyeleri taşı")
    return parser


def wallet_key(company: dict) -> str:
    return str((company or {}).get("license_id") or (company or {}).get("_id") or "").strip()


def _as_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


async def _all(coll) -> List[dict]:
    cursor = coll.find({})
    rows = await cursor.to_list(100000)
    return [row for row in rows if isinstance(row, dict)]


def _orphan_transfer_id(company_id: str, old_wid: str, new_wid: str) -> str:
    raw = f"gib-wallet-orphan:{company_id}:{old_wid}:{new_wid}"
    if len(raw) <= 160:
        return raw
    return "gib-wallet-orphan:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def classify_wallets(companies: List[dict], licenses: List[dict], wallets: List[dict], ledger: List[dict]) -> dict:
    """Sahipsiz ve kesin taşınabilir cüzdanları ayırır. Yazmaz."""
    company_ids = {str(row.get("_id")) for row in companies if row.get("_id")}
    license_ids = {str(row.get("license_id")) for row in companies if row.get("license_id")}
    license_ids |= {str(row.get("_id")) for row in licenses if row.get("_id")}
    by_id = {str(row.get("_id")): row for row in companies if row.get("_id")}
    current_keys = {wallet_key(row) for row in companies if wallet_key(row)}

    ledger_companies: Dict[str, set] = {}
    for row in ledger:
        wid = str(row.get("wallet_id") or "").strip()
        cid = str(row.get("company_id") or "").strip()
        if wid and cid:
            ledger_companies.setdefault(wid, set()).add(cid)

    orphans: List[dict] = []
    certain: List[dict] = []
    for wallet in wallets:
        wid = str(wallet.get("_id") or "").strip()
        if not wid or wid in current_keys:
            continue
        balance = _as_int(wallet.get("balance"))
        matches_company = wid in company_ids
        matches_license = wid in license_ids
        if not matches_company and not matches_license:
            cids = ledger_companies.get(wid) or set()
            company_id = next(iter(cids)) if len(cids) == 1 else ""
            company = by_id.get(company_id) if company_id else None
            dest = wallet_key(company) if company else ""
            ok = bool(company and dest and dest != wid and dest in current_keys)
            row = {
                "wallet_id": wid,
                "balance": balance,
                "company_id": company_id or None,
                "dest_wallet_id": dest if ok else None,
                "certain": ok,
                "kind": "orphan",
            }
            orphans.append(row)
            if ok:
                certain.append(row)
            continue
        if matches_company and wid in by_id:
            company = by_id[wid]
            dest = wallet_key(company)
            if dest and dest != wid and dest in current_keys:
                certain.append({
                    "wallet_id": wid,
                    "balance": balance,
                    "company_id": wid,
                    "dest_wallet_id": dest,
                    "certain": True,
                    "kind": "moved_license",
                })
    orphan_balance = sum(_as_int(row.get("balance")) for row in orphans)
    certain_balance = sum(_as_int(row.get("balance")) for row in certain)
    return {
        "orphan_count": len(orphans),
        "orphan_balance": orphan_balance,
        "certain_count": len(certain),
        "certain_balance": certain_balance,
        "orphans": orphans,
        "certain": certain,
    }


async def gib_wallet_orphan_report(db, *, apply: bool = False) -> Dict[str, Any]:
    """Dry-run raporu. apply=True iken yalnız kesin eşleşen bakiyeyi taşır."""
    classified = classify_wallets(
        await _all(db.companies),
        await _all(db.company_licenses),
        await _all(db.gib_wallets),
        await _all(db.gib_credit_ledger),
    )
    applied: List[dict] = []
    if apply:
        import gib_credits

        prev = gib_credits._db
        gib_credits._db = db
        try:
            for row in classified["certain"]:
                amount = _as_int(row.get("balance"))
                dest = str(row.get("dest_wallet_id") or "").strip()
                company_id = str(row.get("company_id") or "").strip()
                old_wid = str(row.get("wallet_id") or "").strip()
                if amount <= 0 or not dest or not company_id or not old_wid or dest == old_wid:
                    continue
                transfer_id = _orphan_transfer_id(company_id, old_wid, dest)
                result = await gib_credits.transfer_wallet_balance(
                    old_wid,
                    dest,
                    company_id=company_id,
                    transfer_id=transfer_id,
                )
                if result.get("applied") and int(result.get("transferred") or 0) > 0:
                    applied.append({
                        "wallet_id": old_wid,
                        "dest_wallet_id": dest,
                        "company_id": company_id,
                        "amount": int(result.get("transferred") or 0),
                        "transfer_id": transfer_id,
                    })
                    logger.info(
                        "taşındı wallet=%s dest=%s company=%s amount=%s",
                        old_wid,
                        dest,
                        company_id,
                        int(result.get("transferred") or 0),
                    )
        finally:
            gib_credits._db = prev
    return {
        "dry_run": not apply,
        "orphan_count": classified["orphan_count"],
        "orphan_balance": classified["orphan_balance"],
        "certain_count": classified["certain_count"],
        "certain_balance": classified["certain_balance"],
        "orphans": classified["orphans"],
        "certain": classified["certain"],
        "applied": applied,
    }


async def _main(apply: bool) -> int:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    try:
        from setup_state import apply_saved_secrets

        apply_saved_secrets()
    except Exception:
        pass

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    from mysql_store import MySQLClient, mysql_settings_from_env

    client = MySQLClient()
    try:
        db_name = str(mysql_settings_from_env().get("db") or "tamkobi").strip()
        db = client[db_name]
        report = await gib_wallet_orphan_report(db, apply=apply)
        if report["dry_run"]:
            print(
                f"dry-run: {report['orphan_count']} sahipsiz cüzdan, "
                f"bakiye toplamı {report['orphan_balance']}. Veritabanı değişmedi."
            )
        else:
            print(f"uygulandı: {len(report['applied'])} cüzdan taşındı.")
        print(
            f"kesin taşıma adayı: {report['certain_count']}, "
            f"bakiye {report['certain_balance']}."
        )
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        return 0
    finally:
        try:
            await client.close_async()
        except Exception:
            try:
                client.close()
            except Exception:
                pass


def main() -> None:
    args = build_parser().parse_args()
    # Yazma yalnız --apply ile. Bayrak yoksa veya --dry-run ise raporla.
    raise SystemExit(asyncio.run(_main(bool(args.apply))))


if __name__ == "__main__":
    main()
