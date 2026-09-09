"""Dump TamKobi MySQL physical tables + JSON collections into docs/mysql-schema.md."""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mysql_store import mysql_settings_from_env

GROUPS = {
    "SaaS / platform": ["users", "companies", "company_licenses", "saas_plans", "roles", "user_invites", "platform_settings", "platform_mail_servers", "platform_mailboxes", "upgrade_requests", "login_attempts"],
    "Muhasebe": ["invoices", "contacts", "installments", "expenses", "expense_categories", "expense_budgets", "quotes", "trade_files"],
    "Finans": ["bank_accounts", "bank_transactions", "partners", "partner_transactions", "cash_approval_requests", "fx_rates", "gib_wallets", "gib_credit_ledger"],
    "Satış / sipariş": ["orders", "order_pick_sessions", "projects", "surveys", "cargo_configs", "cargo_shipments"],
    "Stok / üretim": ["products", "product_categories", "units", "warehouses", "stock_movements", "stock_counts", "recipes", "production_orders", "work_orders", "label_templates"],
    "İK": ["employees", "payrolls", "leave_requests", "bonus_payments", "attendance_alerts"],
    "Entegrasyon": ["integration_configs", "einvoice_settings", "migration_api_configs", "migration_api_cache"],
    "Sistem": ["activity_logs", "notifications", "trash", "counters"],
}


def _connect():
    import pymysql
    cfg = mysql_settings_from_env()
    return pymysql.connect(
        host=cfg["host"], port=int(cfg["port"]), user=cfg["user"],
        password=cfg["password"], database=cfg["db"], charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    ), cfg


def map_schema() -> Dict[str, Any]:
    conn, cfg = _connect()
    cur = conn.cursor()
    cur.execute("SHOW TABLE STATUS")
    tables = cur.fetchall()
    creates = {}
    for t in tables:
        cur.execute(f"SHOW CREATE TABLE `{t['Name']}`")
        row = cur.fetchone()
        creates[t["Name"]] = list(row.values())[1]
    cur.execute(
        "SELECT collection, COUNT(*) AS n, ROUND(SUM(LENGTH(doc))/1024,1) AS kb "
        "FROM docs GROUP BY collection ORDER BY collection"
    )
    collections = cur.fetchall()
    cur.execute("SELECT collection, name, spec, unique_index FROM meta_indexes ORDER BY collection, name")
    indexes = cur.fetchall()
    samples = {}
    for row in collections:
        cur.execute("SELECT doc FROM docs WHERE collection=%s LIMIT 1", (row["collection"],))
        one = cur.fetchone()
        if not one:
            continue
        doc = one["doc"]
        if isinstance(doc, str):
            doc = json.loads(doc)
        samples[row["collection"]] = sorted(doc.keys())
    conn.close()
    by_group = defaultdict(list)
    grouped = set()
    for title, names in GROUPS.items():
        for n in names:
            match = next((c for c in collections if c["collection"] == n), None)
            if match:
                by_group[title].append(match)
                grouped.add(n)
    other = [c for c in collections if c["collection"] not in grouped]
    if other:
        by_group["Diğer"] = other
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "database": cfg["db"],
        "host": f"{cfg['host']}:{cfg['port']}",
        "tables": tables,
        "creates": creates,
        "collections": collections,
        "indexes": indexes,
        "samples": samples,
        "groups": {k: v for k, v in by_group.items()},
    }


def to_markdown(data: Dict[str, Any]) -> str:
    lines: List[str] = [
        "# TamKobi MySQL schema map",
        "",
        f"Generated: `{data['generated_at']}` · `{data['host']}/{data['database']}`",
        "",
        "TamKobi does **not** use one SQL table per entity. Application documents",
        "(invoices, contacts, users, …) live as JSON rows in `docs`, keyed by",
        "`(collection, id)`. `meta_indexes` stores uniqueness rules enforced in Python.",
        "`system_logs` is a native relational audit table.",
        "",
        "## Physical tables",
        "",
    ]
    for t in data["tables"]:
        data_mb = round((t.get("Data_length") or 0) / 1024 / 1024, 3)
        idx_mb = round((t.get("Index_length") or 0) / 1024 / 1024, 3)
        lines += [
            f"### `{t['Name']}`",
            "",
            f"- Engine: {t.get('Engine')} · Collation: {t.get('Collation')}",
            f"- Approx rows: {t.get('Rows')} · data {data_mb} MB · indexes {idx_mb} MB",
            "",
            "```sql",
            data["creates"].get(t["Name"], ""),
            "```",
            "",
        ]
    lines += [
        "## JSON collections (`docs.collection`)",
        "",
        "Each collection is a logical Mongo-style table. Reads historically scanned",
        "the whole collection in Python; `company_id` equality now uses the generated",
        "column + `idx_docs_coll_company`.",
        "",
    ]
    for title, rows in data["groups"].items():
        lines += [f"### {title}", "", "| collection | rows | KB | sample fields |", "|---|---:|---:|---|"]
        for r in rows:
            fields = ", ".join(f"`{k}`" for k in (data["samples"].get(r["collection"]) or [])[:12])
            lines.append(f"| `{r['collection']}` | {r['n']} | {r['kb']} | {fields} |")
        lines.append("")
    lines += [
        "## Application indexes (`meta_indexes`)",
        "",
        "These are **not** InnoDB indexes (except `users.email` uniqueness checked in app).",
        "They prevent duplicate JSON documents on write.",
        "",
        "| collection | name | unique | fields |",
        "|---|---|---|---|",
    ]
    for idx in data["indexes"]:
        spec = idx.get("spec")
        if isinstance(spec, str):
            try:
                spec = json.loads(spec)
            except Exception:
                spec = {}
        fields = ",".join((spec or {}).get("fields") or [])
        lines.append(f"| `{idx['collection']}` | `{idx['name']}` | {bool(idx['unique_index'])} | `{fields}` |")
    lines += [
        "",
        "## Query pattern",
        "",
        "1. `SELECT doc FROM docs WHERE collection=? [AND company_id=?]`",
        "2. Filter/sort remaining predicates in Python (`match_query` / `sort_docs`).",
        "3. Writes: `INSERT` / `REPLACE` / `DELETE` on `(collection, id)`.",
        "",
        "See `docs/mysql-performance-report.md` for load, buffer pool, and scaling.",
        "",
    ]
    return "\n".join(lines)


def main():
    dest = Path(__file__).resolve().parent.parent.parent / "docs" / "mysql-schema.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = map_schema()
    dest.write_text(to_markdown(data), encoding="utf-8")
    json_dest = dest.with_suffix(".json")
    slim = {k: data[k] for k in ("generated_at", "database", "host", "collections", "indexes", "samples") if k in data}
    json_dest.write_text(json.dumps(slim, ensure_ascii=False, default=str, indent=2), encoding="utf-8")
    print(dest)
    print(json_dest)


if __name__ == "__main__":
    main()
