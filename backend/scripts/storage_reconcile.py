#!/usr/bin/env python3
"""Paylaşılan docs ile dedicated storage_records farkı.

Salt okuma, varsayılan dry-run. Veri taşımaz, paylaşılan kopyayı silmez.
Argümansız çağrı bağlantı açmaz. --apply yazım yapmaz ve reddedilir.
Belge gövdesi, DSN, ETTN ve VKN yazdırılmaz.

Canlı sayım elle çalıştırılır (değer değil, adet):

  -- paylaşılan tamkobi_db.docs, company_id = comp_505a96e8
  SELECT collection, COUNT(*) AS shared_count
  FROM docs
  WHERE JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id')) = 'comp_505a96e8'
  GROUP BY collection;

  -- dedicated veritabanı tamkobi_c_505a96e8 (adında comp_ yoktur)
  SELECT collection, COUNT(*) AS dedicated_count
  FROM storage_records
  GROUP BY collection;

docs_v2, t_bank_transactions ve t_stock_moves dedicated kipin deposu değildir.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _id_list(value) -> list:
    """Kimlik listesi. Belge gövdesi toplanmaz."""
    found = []
    for item in value or []:
        if isinstance(item, str):
            text = item.strip()
        elif isinstance(item, dict) and item.get("_id") is not None:
            text = str(item.get("_id")).strip()
        else:
            continue
        if text:
            found.append(text)
    return found


def compare_id_sets(shared_ids, dedicated_ids) -> dict:
    shared = set(_id_list(shared_ids))
    dedicated = set(_id_list(dedicated_ids))
    only_shared = sorted(shared - dedicated)
    only_dedicated = sorted(dedicated - shared)
    return {
        "shared": len(shared),
        "dedicated": len(dedicated),
        "only_shared": len(only_shared),
        "only_dedicated": len(only_dedicated),
        "only_shared_ids": only_shared,
        "only_dedicated_ids": only_dedicated,
    }


def compare_collections(shared: dict, dedicated: dict) -> list:
    """Koleksiyon başına adet ve yalnız bir tarafta olan kimlik sayısı."""
    left = shared or {}
    right = dedicated or {}
    rows = []
    for name in sorted(set(left) | set(right)):
        row = compare_id_sets(left.get(name) or [], right.get(name) or [])
        row["collection"] = str(name)
        rows.append(row)
    return rows


def render_report(rows) -> str:
    lines = ["collection\tshared\tdedicated\tonly_shared\tonly_dedicated"]
    for row in rows or []:
        lines.append("\t".join([
            str(row.get("collection") or ""),
            str(row.get("shared") or 0),
            str(row.get("dedicated") or 0),
            str(row.get("only_shared") or 0),
            str(row.get("only_dedicated") or 0),
        ]))
        extra = list(row.get("only_dedicated_ids") or [])
        if extra and len(extra) <= 20:
            lines.append("only_dedicated_ids\t" + ",".join(str(item) for item in extra))
    lines.append("dry-run\tyazım yok")
    return "\n".join(lines) + "\n"


def _load_ids(path: str) -> dict:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("JSON nesne olmalı: koleksiyon -> kimlik listesi")
    return {str(name): _id_list(value) for name, value in raw.items()}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Depolama farkı (salt okuma, dry-run)")
    parser.add_argument("--shared-json", default="", help="Paylaşılan kimlik listesi. Bağlantı açılmaz.")
    parser.add_argument("--dedicated-json", default="", help="Dedicated kimlik listesi. Bağlantı açılmaz.")
    parser.add_argument("--apply", action="store_true", help="Reddedilir. Yazım yok.")
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.apply:
        sys.stderr.write("salt okuma: --apply reddedildi, hiçbir yazım yok\n")
        return 2
    shared_path = str(args.shared_json or "").strip()
    dedicated_path = str(args.dedicated_json or "").strip()
    if not shared_path and not dedicated_path:
        sys.stdout.write("dry-run: kaynak verilmedi, bağlantı açılmadı\n")
        return 0
    shared = _load_ids(shared_path) if shared_path else {}
    dedicated = _load_ids(dedicated_path) if dedicated_path else {}
    sys.stdout.write(render_report(compare_collections(shared, dedicated)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
