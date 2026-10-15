#!/usr/bin/env python3
"""Siparişte kalmış, canlı faturası olmayan fatura bağlarını listeler veya koparır.

Varsayılan dry-run'dur: sipariş no, invoice_id ve neden yazılır; veritabanı değişmez.
--apply, silme yolundaki _unlink_orders_from_invoice ile bağı koparır (sipariş silinmez).
is_invoiced=True olup canlı faturası olmayan siparişler listelenir; düzeltilmeleri
yalnız --include-invoiced ile olur. İkinci --apply yazılacak bağ kalmadığında 0'dır.

Her sorgu company_id taşır. Başka faturaya bağlı siparişe ve başka firmaya dokunulmaz.

  python backend/scripts/repair_orphan_order_invoice_links.py
  python backend/scripts/repair_orphan_order_invoice_links.py --company-id comp_xxx
  python backend/scripts/repair_orphan_order_invoice_links.py --company-id comp_xxx --apply
  python backend/scripts/repair_orphan_order_invoice_links.py --apply --include-invoiced
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_RESIDUE_FIELDS = (
    "invoice_id",
    "invoice_number",
    "invoice_e_type",
    "invoice_gib_status",
    "invoice_gib_uuid",
    "gib_uuid",
    "gib_invoice_id",
    "einvoice_state",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Yetim sipariş–fatura bağlarını listele (varsayılan) veya kopar",
    )
    parser.add_argument("--company-id", default="", help="Yalnız bu firma. Boşsa tüm firmalar.")
    parser.add_argument("--apply", action="store_true", help="Bağları kopar. Yoksa dry-run.")
    parser.add_argument(
        "--include-invoiced",
        action="store_true",
        help="is_invoiced=True olup canlı faturası olmayan siparişleri de düzelt (--apply ile).",
    )
    return parser


def _text(value: Any) -> str:
    return str(value or "").strip()


def _is_invoiced(order: dict) -> bool:
    return bool((order or {}).get("is_invoiced"))


def _has_link_residue(order: dict) -> bool:
    if _text(order.get("order_status")) == "invoiced":
        return True
    return any(_text(order.get(key)) for key in _RESIDUE_FIELDS)


def _residue_or() -> List[dict]:
    clauses: List[dict] = [
        {"is_invoiced": True},
        {"order_status": "invoiced"},
    ]
    for key in _RESIDUE_FIELDS:
        clauses.append({key: {"$nin": [None, ""]}})
    return clauses


def _row(company_id: str, order: dict, invoice_id: str, reason: str) -> dict:
    return {
        "company_id": company_id,
        "order_id": _text(order.get("_id")),
        "order_number": _text(order.get("order_number")) or _text(order.get("_id")),
        "invoice_id": invoice_id or "",
        "reason": reason,
    }


async def _company_ids(db, company_id: Optional[str]) -> List[str]:
    cid = _text(company_id)
    if cid:
        return [cid]
    rows = await db.companies.find({}, {"_id": 1}).to_list(20000)
    return [_text(row.get("_id")) for row in rows if _text(row.get("_id"))]


def _trash_invoice_doc(rec: dict, company_id: str) -> Optional[dict]:
    if _text(rec.get("company_id")) != company_id:
        return None
    if _text(rec.get("entity_type")) != "invoice":
        return None
    collection = _text(rec.get("collection"))
    if collection and collection != "invoices":
        return None
    doc = rec.get("doc") if isinstance(rec.get("doc"), dict) else None
    if not doc:
        return None
    doc_company = _text(doc.get("company_id")) or company_id
    if doc_company != company_id or not _text(doc.get("_id")):
        return None
    return doc


def _trash_order_ids(doc: dict) -> List[str]:
    ids: List[str] = []
    for key in ("order_id", "source_order_id"):
        val = _text(doc.get(key))
        if val and val not in ids:
            ids.append(val)
    for raw in doc.get("order_ids") or []:
        val = _text(raw)
        if val and val not in ids:
            ids.append(val)
    return ids


async def _scan_company(db, company_id: str) -> Dict[str, List[dict]]:
    orders = await db.orders.find(
        {"company_id": company_id, "$or": _residue_or()},
    ).to_list(20000)
    orders = [order for order in orders if _text(order.get("company_id")) == company_id]
    inv_ids = {_text(order.get("invoice_id")) for order in orders if _text(order.get("invoice_id"))}
    live_ids = set()
    if inv_ids:
        live_rows = await db.invoices.find(
            {"company_id": company_id, "_id": {"$in": list(inv_ids)}},
            {"_id": 1},
        ).to_list(len(inv_ids))
        live_ids = {_text(row.get("_id")) for row in live_rows if _text(row.get("_id"))}

    trash_rows = await db.trash.find(
        {"company_id": company_id, "entity_type": "invoice"},
    ).to_list(20000)
    trash_by_id: Dict[str, dict] = {}
    trash_order_index: Dict[str, dict] = {}
    for rec in trash_rows:
        doc = _trash_invoice_doc(rec, company_id)
        if not doc:
            continue
        inv_id = _text(doc.get("_id"))
        trash_by_id[inv_id] = doc
        for oid in _trash_order_ids(doc):
            trash_order_index.setdefault(oid, doc)

    orders_by_id = {_text(order.get("_id")): order for order in orders if _text(order.get("_id"))}
    seen = set()
    orphans: List[dict] = []
    invoiced_orphans: List[dict] = []

    for order in orders:
        oid = _text(order.get("_id"))
        if not oid or oid in seen:
            continue
        linked = _text(order.get("invoice_id"))
        if linked and linked in live_ids:
            continue
        if _is_invoiced(order):
            invoiced_orphans.append(_row(company_id, order, linked, "invoiced_without_invoice"))
            seen.add(oid)
            continue
        if linked:
            reason = "trashed_invoice" if linked in trash_by_id else "missing_invoice"
            orphans.append(_row(company_id, order, linked, reason))
            seen.add(oid)

    for oid, doc in trash_order_index.items():
        if oid in seen:
            continue
        order = orders_by_id.get(oid)
        if not order or _text(order.get("company_id")) != company_id:
            continue
        linked = _text(order.get("invoice_id"))
        inv_id = _text(doc.get("_id"))
        if linked and linked != inv_id:
            continue
        if _is_invoiced(order) or not _has_link_residue(order):
            continue
        orphans.append(_row(company_id, order, inv_id, "reverse_link"))
        seen.add(oid)

    return {"orphans": orphans, "invoiced_orphans": invoiced_orphans}


async def collect_orphan_order_invoice_links(db, company_id: Optional[str] = None) -> Dict[str, Any]:
    """Dry-run verisi. Yazma yapmaz. company_id yoksa firmalar tek tek taranır."""
    orphans: List[dict] = []
    invoiced_orphans: List[dict] = []
    for cid in await _company_ids(db, company_id):
        found = await _scan_company(db, cid)
        orphans.extend(found["orphans"])
        invoiced_orphans.extend(found["invoiced_orphans"])
    return {
        "company_id": _text(company_id),
        "orphans": orphans,
        "invoiced_orphans": invoiced_orphans,
        "dry_run": True,
        "applied": 0,
    }


def unlink_payloads(rows: List[dict], *, skip_invoiced: bool) -> List[dict]:
    """Aynı faturaya ait siparişler tek _unlink_orders_from_invoice çağrısında birleşir."""
    grouped: Dict[tuple, dict] = {}
    loose: Dict[str, List[str]] = {}
    for row in rows:
        cid = _text(row.get("company_id"))
        inv_id = _text(row.get("invoice_id"))
        oid = _text(row.get("order_id"))
        if not cid:
            continue
        if not inv_id:
            if oid:
                loose.setdefault(cid, []).append(oid)
            continue
        bucket = grouped.setdefault((cid, inv_id), {
            "_id": inv_id,
            "company_id": cid,
            "order_ids": [],
        })
        if row.get("reason") == "reverse_link" and oid and oid not in bucket["order_ids"]:
            bucket["order_ids"].append(oid)
    payloads: List[dict] = []
    for bucket in grouped.values():
        ids = list(bucket["order_ids"])
        if ids:
            bucket["order_id"] = ids[0]
        else:
            bucket.pop("order_ids", None)
        if skip_invoiced:
            bucket["_unlink_skip_invoiced"] = True
        payloads.append(bucket)
    for cid, ids in loose.items():
        uniq = list(dict.fromkeys(ids))
        if not uniq:
            continue
        payload = {
            "company_id": cid,
            "_unlink_order_ids_only": True,
            "order_ids": uniq,
            "order_id": uniq[0],
        }
        if skip_invoiced:
            payload["_unlink_skip_invoiced"] = True
        payloads.append(payload)
    return payloads


async def apply_orphan_order_invoice_links(
    db,
    company_id: Optional[str] = None,
    *,
    include_invoiced: bool = False,
) -> Dict[str, Any]:
    """--apply. Silme fonksiyonu ile bağ kopar. is_invoiced satırlar flag olmadan durur."""
    found = await collect_orphan_order_invoice_links(db, company_id)
    import server

    previous = server.db
    server.db = db
    applied = 0
    try:
        for payload in unlink_payloads(found["orphans"], skip_invoiced=True):
            applied += int(await server._unlink_orders_from_invoice(payload) or 0)
        if include_invoiced:
            for payload in unlink_payloads(found["invoiced_orphans"], skip_invoiced=False):
                applied += int(await server._unlink_orders_from_invoice(payload) or 0)
    finally:
        server.db = previous
    return {
        **found,
        "dry_run": False,
        "applied": applied,
        "include_invoiced": include_invoiced,
    }


def format_report(report: dict, *, dry_run: bool, include_invoiced: bool) -> str:
    lines = []
    for row in report.get("orphans") or []:
        lines.append(f"{row.get('order_number')}\t{row.get('invoice_id') or ''}\t{row.get('reason')}")
    for row in report.get("invoiced_orphans") or []:
        lines.append(f"{row.get('order_number')}\t{row.get('invoice_id') or ''}\t{row.get('reason')}")
    applied = 0 if dry_run else int(report.get("applied") or 0)
    lines.append(
        "özet: "
        f"dry_run={str(bool(dry_run)).lower()} "
        f"koparılacak={len(report.get('orphans') or [])} "
        f"is_invoiced_faturasız={len(report.get('invoiced_orphans') or [])} "
        f"uygulanan={applied} "
        f"include_invoiced={str(bool(include_invoiced)).lower()}"
    )
    return "\n".join(lines)


async def _main(company_id: str, apply: bool, include_invoiced: bool) -> int:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    try:
        from setup_state import apply_saved_secrets

        apply_saved_secrets()
    except Exception:
        pass

    from mysql_store import MySQLClient, mysql_settings_from_env

    client = MySQLClient()
    try:
        db_name = str(mysql_settings_from_env().get("db") or "tamkobi").strip()
        db = client[db_name]
        cid = _text(company_id) or None
        if apply:
            report = await apply_orphan_order_invoice_links(db, cid, include_invoiced=include_invoiced)
        else:
            report = await collect_orphan_order_invoice_links(db, cid)
        print(format_report(report, dry_run=not apply, include_invoiced=include_invoiced))
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
    raise SystemExit(asyncio.run(_main(args.company_id, bool(args.apply), bool(args.include_invoiced))))


if __name__ == "__main__":
    main()
