#!/usr/bin/env python3
"""Eksik çek/senet ciro satırlarını cari Ödemeler listesine yazar.

Ciro sırasında cari bakiyesi zaten işlenmiştir. Bu betik yalnız
bank_transactions görünürlük satırını ekler; bakiyeye $inc yapmaz.

Varsayılan dry-run: adayları sayar, kayıt yazmaz. Yazmak için --apply gerekir.
.env okunmaz; MySQL adresi komut satırında verilmeden bağlanılmaz.

  python backend/scripts/backfill_cheque_endorsements.py --company comp_xxx --mysql-url 'mysql://user:pass@host:3306/tamkobi'
  python backend/scripts/backfill_cheque_endorsements.py --all-companies --mysql-host 127.0.0.1 --mysql-user tamkobi --mysql-db tamkobi
  python backend/scripts/backfill_cheque_endorsements.py --company comp_xxx --mysql-url 'mysql://user:pass@host/tamkobi' --apply

İkinci çalıştırma aynı çeke yeniden satır yazmaz.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Eksik çek ciro satırlarını Ödemeler listesine yazar")
    parser.add_argument("--company", default="", help="Yalnızca bu company_id")
    parser.add_argument("--all-companies", action="store_true", help="Tüm şirketleri tara (açık onay)")
    parser.add_argument("--apply", action="store_true", help="Eksik satırları yaz. Yoksa yalnız sayım")
    parser.add_argument("--mysql-url", default="", help="mysql://kullanıcı:parola@sunucu:port/veritabanı")
    parser.add_argument("--mongo-url", default="", help="Açık mysql:// adresi. mongodb:// kabul edilmez")
    parser.add_argument("--mysql-host", default="")
    parser.add_argument("--mysql-port", type=int, default=0)
    parser.add_argument("--mysql-user", default="")
    parser.add_argument("--mysql-password", default="")
    parser.add_argument("--mysql-db", default="")
    return parser


def _fail(message: str) -> None:
    raise SystemExit(message)


def settings_from_mysql_url(url: str) -> dict:
    raw = str(url or "").strip()
    if raw.startswith("mysql+"):
        raw = "mysql://" + raw.split("://", 1)[1]
    if raw.startswith("mongodb"):
        _fail("Bu kurulum MySQL kullanır. mysql:// adresini --mysql-url ile verin.")
    if not raw.startswith("mysql://"):
        _fail("Bağlantı adresi mysql:// ile başlamalı.")
    parsed = urlparse(raw)
    database = (parsed.path or "").lstrip("/").split("?")[0]
    if not parsed.hostname or not parsed.username or not database:
        _fail("MySQL adresinde kullanıcı, sunucu ve veritabanı olmalı.")
    return {
        "host": parsed.hostname,
        "port": parsed.port or 3306,
        "user": unquote(parsed.username),
        "password": unquote(parsed.password or ""),
        "db": database,
        "charset": "utf8mb4",
        "autocommit": True,
    }


def resolve_request(argv) -> dict:
    """Bayrakları doğrula. Bağlantı açmaz, .env okumaz, yazmaz."""
    args = build_parser().parse_args(list(argv))
    company = str(args.company or "").strip()
    all_companies = bool(args.all_companies)
    if company and all_companies:
        _fail("Yalnızca --company veya --all-companies verin.")
    if not company and not all_companies:
        _fail("--company zorunlu. Tüm şirketler için --all-companies verin.")
    mysql_url = str(args.mysql_url or "").strip()
    mongo_url = str(args.mongo_url or "").strip()
    host = str(args.mysql_host or "").strip()
    if mysql_url and mongo_url:
        _fail("Yalnızca bir bağlantı adresi verin.")
    url = mysql_url or mongo_url
    if url and (host or str(args.mysql_user or "").strip() or str(args.mysql_db or "").strip()):
        _fail("Bağlantıyı ya URL ya da --mysql-host ile verin.")
    if url:
        settings = settings_from_mysql_url(url)
    elif host and str(args.mysql_user or "").strip() and str(args.mysql_db or "").strip():
        settings = {
            "host": host,
            "port": int(args.mysql_port or 3306),
            "user": str(args.mysql_user).strip(),
            "password": str(args.mysql_password or ""),
            "db": str(args.mysql_db).strip(),
            "charset": "utf8mb4",
            "autocommit": True,
        }
    else:
        _fail("MySQL bağlantısı açıkça verilmeli (--mysql-url veya --mysql-host, --mysql-user, --mysql-db). .env okunmaz.")
    return {
        "company_id": company or None,
        "all_companies": all_companies,
        "apply": bool(args.apply),
        "settings": settings,
    }


async def _company_ids(db, company_id: str) -> list:
    if company_id:
        return [company_id]
    rows = await db.companies.find({}).to_list(5000)
    out = []
    for row in rows or []:
        cid = str((row or {}).get("_id") or (row or {}).get("id") or "").strip()
        if cid:
            out.append(cid)
    return out


async def run_backfill(db, request: dict) -> dict:
    import cheques

    company_id = str(request.get("company_id") or "")
    apply = bool(request.get("apply"))
    summaries = []
    for cid in await _company_ids(db, company_id):
        summaries.append(await cheques.backfill_endorsement_rows(db, company_id=cid, apply=apply))
    return {
        "dry_run": not apply,
        "company_id": company_id or None,
        "companies": summaries,
        "candidates": sum(int(row.get("candidates") or 0) for row in summaries),
        "inserted": sum(int(row.get("inserted") or 0) for row in summaries),
    }


async def _main(request: dict) -> int:
    from mysql_store import MySQLDatabase

    db = MySQLDatabase(request["settings"])
    try:
        summary = await run_backfill(db, request)
    finally:
        await db.close()
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if summary["dry_run"]:
        print(json.dumps({"note": "Dry-run. Yazmak için --apply verin."}, ensure_ascii=False))
    return 0


def main(argv=None):
    request = resolve_request(sys.argv[1:] if argv is None else argv)
    raise SystemExit(asyncio.run(_main(request)))


if __name__ == "__main__":
    main()
