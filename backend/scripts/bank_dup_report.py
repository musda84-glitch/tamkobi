#!/usr/bin/env python3
"""Tekrar eden banka external_id kayıtlarını listeler.

Varsayılan ve tek kip dry-run'dur. Bağlantı açmaz, satır silmez, güncellemez.
--apply yoktur.

  python backend/scripts/bank_dup_report.py
  python backend/scripts/bank_dup_report.py --bank-json bank.json --partner-json partner.json
  python backend/scripts/bank_dup_report.py --company comp_xxx --bank-json bank.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _text(value) -> str:
    return str(value or "").strip()


def _load_rows(path: str) -> list:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("rows") or raw.get("items") or []
    if not isinstance(raw, list):
        raise ValueError("JSON liste olmalı")
    return [row for row in raw if isinstance(row, dict)]


def find_duplicates(bank_rows, partner_rows=None, *, company_id: str = "") -> dict:
    """Şirket + external_id kopyalarını ve bağlı ortak hareketlerini sayar.

    Belge gövdesi, açıklama, tutar ve hesap numarası dönmez.
    """
    wanted = _text(company_id)
    groups: dict = {}
    for row in bank_rows or []:
        if not isinstance(row, dict):
            continue
        cid = _text(row.get("company_id"))
        ext = _text(row.get("external_id"))
        if not cid or not ext:
            continue
        if wanted and cid != wanted:
            continue
        groups.setdefault((cid, ext), []).append(row)

    partners = [row for row in (partner_rows or []) if isinstance(row, dict)]
    companies = []
    for (cid, ext), rows in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1])):
        if len(rows) < 2:
            continue
        bank_ids = []
        match_status: dict = {}
        for row in rows:
            ident = _text(row.get("_id") or row.get("id"))
            if ident and ident not in bank_ids:
                bank_ids.append(ident)
            status = _text(row.get("match_status")) or "unknown"
            match_status[status] = match_status.get(status, 0) + 1
        linked = []
        for row in partners:
            if _text(row.get("company_id")) != cid:
                continue
            related = _text(row.get("related_bank_tx_id"))
            own_ext = _text(row.get("external_id"))
            if related not in bank_ids and own_ext != ext:
                continue
            pid = _text(row.get("_id") or row.get("id"))
            if pid and pid not in linked:
                linked.append(pid)
        companies.append({
            "company_id": cid,
            "external_id": ext,
            "copies": len(rows),
            "bank_transaction_ids": bank_ids,
            "match_status": match_status,
            "partner_transaction_ids": linked,
            "partner_count": len(linked),
        })
    return {
        "dry_run": True,
        "wrote": False,
        "company_id": wanted or None,
        "duplicate_groups": len(companies),
        "companies": companies,
    }


def render_report(report: dict) -> str:
    lines = [
        "dry-run\tyazım yok",
        "company_id\text\tcopies\tbank_ids\tpartner_ids\tmatch_status",
    ]
    for row in report.get("companies") or []:
        lines.append("\t".join([
            str(row.get("company_id") or ""),
            str(row.get("external_id") or ""),
            str(row.get("copies") or 0),
            ",".join(row.get("bank_transaction_ids") or []),
            ",".join(row.get("partner_transaction_ids") or []),
            json.dumps(row.get("match_status") or {}, ensure_ascii=False, separators=(",", ":")),
        ]))
    if not report.get("companies"):
        lines.append("duplicate_groups\t0")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    raw = list(argv) if argv is not None else None
    probe = raw if raw is not None else sys.argv[1:]
    if any(item == "--apply" for item in probe):
        sys.stderr.write("salt okuma: --apply yok, silme yok\n")
        return 2
    parser = argparse.ArgumentParser(
        description="Tekrar eden banka external_id raporu (salt okuma, dry-run)",
    )
    parser.add_argument("--company", default="", help="Yalnızca bu company_id")
    parser.add_argument("--bank-json", default="", help="Banka hareketleri. Bağlantı açılmaz.")
    parser.add_argument("--partner-json", default="", help="Ortak hareketleri. Bağlantı açılmaz.")
    parser.add_argument("--dry-run", action="store_true", help="Yalnızca rapor (varsayılan, tek kip)")
    args = parser.parse_args(raw)
    bank_path = _text(args.bank_json)
    partner_path = _text(args.partner_json)
    if not bank_path and not partner_path:
        sys.stdout.write("dry-run: bağlantı açılmadı, yazım yok\n")
        return 0
    bank_rows = _load_rows(bank_path) if bank_path else []
    partner_rows = _load_rows(partner_path) if partner_path else []
    report = find_duplicates(bank_rows, partner_rows, company_id=args.company)
    sys.stdout.write(render_report(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
