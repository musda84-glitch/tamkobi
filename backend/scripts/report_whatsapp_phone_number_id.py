#!/usr/bin/env python3
"""Aynı phone_number_id değerini paylaşan WhatsApp ayarlarını listeler.

Kısmi tekil indeks ile aynı kural: phone_number_id string ve boş değil
(server._WA_PHONE_NUMBER_ID_PARTIAL). Boş kimlikler çakışma sayılmaz.

Varsayılan ve tek kip dry-run'dur. Veritabanına bağlanmaz, satır silmez,
güncellemez. --apply yoktur. Canlıda çalıştırılmaz; girdi yalnız --json dosyasıdır.

Çıktıda telefon numarası, erişim token'ı, app secret ve verify token yoktur.

  python backend/scripts/report_whatsapp_phone_number_id.py
  python backend/scripts/report_whatsapp_phone_number_id.py --json settings.json
  python backend/scripts/report_whatsapp_phone_number_id.py --company comp_xxx --json settings.json
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
        raw = raw.get("rows") or raw.get("items") or raw.get("settings") or []
    if not isinstance(raw, list):
        raise ValueError("JSON liste olmalı")
    return [row for row in raw if isinstance(row, dict)]


def indexed_phone_number_id(row) -> str:
    """İndekse giren phone_number_id. Boş ve string olmayan değerler dışarıda."""
    if not isinstance(row, dict):
        return ""
    key = row.get("phone_number_id")
    if not isinstance(key, str) or key == "":
        return ""
    return key


def find_conflicts(rows, *, company_id: str = "") -> dict:
    """Aynı dolu phone_number_id için birden fazla ayar satırını sayar.

    Yazmaz. Token, secret, verify token, telefon ve mesaj alanlarını kopyalamaz.
    """
    wanted = _text(company_id)
    groups: dict = {}
    order: list = []
    for row in rows or []:
        key = indexed_phone_number_id(row)
        if not key:
            continue
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    reported = []
    for key in order:
        items = groups[key]
        if len(items) < 2:
            continue
        company_ids = []
        setting_ids = []
        for row in items:
            cid = _text(row.get("company_id"))
            if cid and cid not in company_ids:
                company_ids.append(cid)
            sid = _text(row.get("_id") or row.get("id"))
            if sid and sid not in setting_ids:
                setting_ids.append(sid)
        if wanted and wanted not in company_ids:
            continue
        reported.append({
            "phone_number_id": key,
            "copies": len(items),
            "company_ids": company_ids,
            "setting_ids": setting_ids,
        })
    return {
        "dry_run": True,
        "wrote": False,
        "company_id": wanted or None,
        "duplicate_groups": len(reported),
        "groups": reported,
    }


def _cell(value) -> str:
    return str(value or "").replace("\t", " ").replace("\r", " ").replace("\n", " ")


def render_report(report: dict) -> str:
    lines = [
        "dry-run\tyazım yok",
        "phone_number_id\tcopies\tcompany_ids\tsetting_ids",
    ]
    for row in report.get("groups") or []:
        lines.append("\t".join([
            _cell(row.get("phone_number_id")),
            str(row.get("copies") or 0),
            ",".join(_cell(item) for item in (row.get("company_ids") or [])),
            ",".join(_cell(item) for item in (row.get("setting_ids") or [])),
        ]))
    if not report.get("groups"):
        lines.append("duplicate_groups\t0")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    raw = list(argv) if argv is not None else None
    probe = raw if raw is not None else sys.argv[1:]
    if any(item == "--apply" for item in probe):
        sys.stderr.write("salt okuma: --apply yok, silme yok\n")
        return 2
    parser = argparse.ArgumentParser(
        description="WhatsApp phone_number_id çakışma raporu (salt okuma, dry-run)",
    )
    parser.add_argument("--company", default="", help="Yalnızca bu company_id geçen gruplar")
    parser.add_argument("--json", default="", help="WhatsApp ayar dışa aktarımı. Bağlantı açılmaz.")
    parser.add_argument("--dry-run", action="store_true", help="Yalnızca rapor (varsayılan, tek kip)")
    args = parser.parse_args(raw)
    path = _text(args.json)
    if not path:
        sys.stdout.write("dry-run: bağlantı açılmadı, yazım yok\n")
        return 0
    report = find_conflicts(_load_rows(path), company_id=args.company)
    sys.stdout.write(render_report(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
