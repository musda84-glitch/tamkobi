"""Yeni yalnız-`_id` kiracı sorgusu kırmızıya düşer.

Bellek içi AST. Canlı veritabanına ve 8021'deki sunucuya bağlanmaz.
"""
from __future__ import annotations

from pathlib import Path

import dedicated_id_allowlist as allowlist
from dedicated_id_scan import baseline_counts, scan

_BACKEND = Path(__file__).resolve().parents[1]
_NEW = "company_id ekleyin ya da '# id-ok: neden' yazın"
_STALE = "Taban küçüldü; dedicated_id_allowlist.py içinden anahtarı silin"
_FROZEN = "DEDICATED_ID_FROZEN değişti; rbac.py ve addons.py bu PR'de değişmez"


def _frozen_file(path):
    return path.rsplit("/", 1)[-1] in ("rbac.py", "addons.py")


def _keys(pairs):
    lines = []
    for key, code, base in list(pairs)[:20]:
        file, function, collection, op = key
        lines.append(f"{file} {function} {collection} {op} kod={code} taban={base}")
    return "\n".join(lines)


def test_id_only_baseline_matches_scan():
    findings = scan(_BACKEND)
    counts = baseline_counts(findings)
    frozen_scan = {key: value for key, value in counts.items() if _frozen_file(key[0])}
    base_scan = {key: value for key, value in counts.items() if not _frozen_file(key[0])}
    frozen = dict(allowlist.DEDICATED_ID_FROZEN)
    base = dict(allowlist.DEDICATED_ID_BASELINE)
    frozen_diff = []
    for key in sorted(set(frozen_scan) | set(frozen)):
        code = frozen_scan.get(key, 0)
        prev = frozen.get(key, 0)
        if code != prev:
            frozen_diff.append((key, code, prev))
    assert not frozen_diff, _FROZEN + "\n" + _keys(frozen_diff)
    fresh = []
    for key, code in base_scan.items():
        prev = base.get(key, 0)
        if key not in base or code > prev:
            fresh.append((key, code, prev))
    stale = []
    for key, prev in base.items():
        code = base_scan.get(key, 0)
        if key not in base_scan or code < prev:
            stale.append((key, code, prev))
    assert not fresh, _NEW + "\n" + _keys(sorted(fresh))
    assert not stale, _STALE + "\n" + _keys(sorted(stale))


def test_scanner_skips_scoped_id_ok_and_platform(tmp_path):
    path = tmp_path / "mod_case.py"
    path.write_text(
        """
def run(db, cid, x):
    db.orders.find_one({"_id": x})
    db.orders.find_one({"_id": x, "company_id": cid})
    db.orders.delete_one({"_id": x})  # id-ok: legacy kip
    db.users.find_one({"_id": x})
    db.orders.find({"_id": {"$in": [x]}})
    q = {"_id": x}
    q["company_id"] = cid
    db.orders.update_one(q, {"$set": {"a": 1}})
    kept = {"_id": x}
    db.invoices.delete_one(kept)
    db.bank_transactions.aggregate([{"$match": {"_id": x}}])
""",
        encoding="utf-8",
    )
    found = {(item.function, item.collection, item.op) for item in scan(tmp_path)}
    assert ("run", "orders", "find_one") in found
    assert ("run", "orders", "find") in found
    assert ("run", "invoices", "delete_one") in found
    assert ("run", "bank_transactions", "aggregate") in found
    assert ("run", "orders", "delete_one") not in found
    assert ("run", "orders", "update_one") not in found
    assert ("run", "users", "find_one") not in found
