"""Kiracı db çağrılarının statik tabanı.

Bellek içi AST. Canlı veritabanına ve 8021'deki sunucuya bağlanmaz.
Hata metninde yalnız anahtar vardır: dosya, fonksiyon, koleksiyon, op, adet.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import time
from pathlib import Path

import tenant_scope
from tenant_scope import collection_kind
from tenant_static_scan import baseline_counts, scan

_BACKEND = Path(__file__).resolve().parents[1]
_SCRIPT = _BACKEND / "scripts" / "tenant_scope_baseline.py"
_NEW = "company_id ekleyin, TenantDB kullanın ya da '# tenant-ok: neden' yazın"
_STALE = "Taban küçüldü, python backend/scripts/tenant_scope_baseline.py --write çalıştırın"
_FROZEN = "TENANT_SCOPE_FROZEN değişti; rbac.py ve addons.py sahibin onayı olmadan değişmez"

_FILTERS = (
    {"company_id": "c1"},
    {"_id": "x"},
    {"$and": [{"company_id": "c1"}, {"_id": "x"}]},
    {"$or": [{"company_id": "c1"}]},
    {"$and": [{"$and": [{"company_id": "c1"}]}]},
    {},
    {"name": "a", "company_id": "c1"},
    {"company_id": {"$in": ["a", "b"]}},
    {"$and": []},
    {"$nor": [{"company_id": "c1"}]},
)


def _script():
    spec = importlib.util.spec_from_file_location("tenant_scope_baseline_mod", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _scan(tmp_path, source, name="mod_case.py"):
    path = tmp_path / name
    path.write_text(source, encoding="utf-8")
    return scan(tmp_path)


def _frozen_file(path):
    return path.rsplit("/", 1)[-1] in ("rbac.py", "addons.py")


def _keys(pairs):
    lines = []
    for key, code, base in list(pairs)[:20]:
        file, function, collection, op = key
        lines.append(f"{file} {function} {collection} {op} kod={code} taban={base}")
    return "\n".join(lines)


def test_baseline_matches_scan_and_finishes():
    started = time.perf_counter()
    findings = scan(_BACKEND)
    elapsed = time.perf_counter() - started
    assert elapsed < 20, round(elapsed, 3)
    counts = baseline_counts(findings)
    import tenant_scope_allowlist as allowlist

    frozen_scan = {key: value for key, value in counts.items() if _frozen_file(key[0])}
    base_scan = {key: value for key, value in counts.items() if not _frozen_file(key[0])}
    frozen = dict(allowlist.TENANT_SCOPE_FROZEN)
    base = dict(allowlist.TENANT_SCOPE_BASELINE)
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


def test_recognizes_constraint_and_skips_non_tenant(tmp_path):
    found = _scan(tmp_path, """
def run(db, cid, ids, x, q, base, name, server):
    db.orders.find({"company_id": cid})
    db.orders.find({"$and": [{"company_id": cid}, {"_id": x}]})
    db.orders.find({"company_id": {"$in": ids}})
    db.orders.find({"_id": x})
    db.orders.find()
    db.orders.aggregate([{"$sort": {"x": 1}}])
    db.orders.insert_one({"name": x})
    db.orders.changed_since(x)
    db.orders.find(q)
    db.orders.find({**base})
    kept = {"_id": x}
    kept["company_id"] = cid
    db.orders.find(kept)
    db.orders.update_one({"_id": x}, {"$setOnInsert": {"company_id": cid}}, upsert=True)
    db.orders.update_one({"_id": x}, {"$setOnInsert": {"company_id": cid}})
    db.users.find({})
    db.companies.find({})
    db.password_resets.find({})
    db.help_articles.find({})
    db.not_in_catalog_zz.find({})
    db[name].find({})
    getattr(db, name).find({})
    server.db.orders.find({"company_id": cid})

class Box:
    def run(self, cid):
        self.db.orders.find({"company_id": cid})
        self._db.orders.find({})
""")
    statuses = [(item.function, item.collection, item.op, item.status) for item in found]
    assert statuses == [
        ("run", "orders", "find", "ok"),
        ("run", "orders", "find", "ok"),
        ("run", "orders", "find", "ok"),
        ("run", "orders", "find", "missing"),
        ("run", "orders", "find", "missing"),
        ("run", "orders", "aggregate", "missing"),
        ("run", "orders", "insert_one", "missing"),
        ("run", "orders", "changed_since", "missing"),
        ("run", "orders", "find", "unclear"),
        ("run", "orders", "find", "unclear"),
        ("run", "orders", "find", "ok"),
        ("run", "orders", "update_one", "ok"),
        ("run", "orders", "update_one", "missing"),
        ("run", "not_in_catalog_zz", "find", "missing"),
        ("run", "", "find", "dynamic"),
        ("run", "", "find", "dynamic"),
        ("run", "orders", "find", "ok"),
        ("Box.run", "orders", "find", "ok"),
        ("Box.run", "orders", "find", "missing"),
    ]
    assert collection_kind("not_in_catalog_zz") == "unknown"
    assert collection_kind("help_articles") == "platform"
    assert collection_kind("users") == "membership"
    assert collection_kind("companies") == "company"
    assert collection_kind("password_resets") == "token"
    dynamic = [item for item in found if item.status == "dynamic"]
    assert baseline_counts(dynamic) == {}
    assert baseline_counts(found)[("mod_case.py", "run", "orders", "find")] == 4


def test_local_db_and_collection_aliases(tmp_path):
    found = _scan(tmp_path, """
def run(db, _db, c, x, name):
    store = db or _db
    store.expenses.find({"_id": x})
    store.expenses.find({"company_id": c})
    plain = db
    plain.orders.find({"company_id": c})
    plain.orders.find({"_id": x})
    getattr(store, name).find({})
    hop1 = db
    hop2 = hop1
    hop3 = hop2
    hop3.orders.find({"company_id": c})
    hop4 = hop3
    hop4.orders.find({"company_id": c})

def run2(db, c, x, name):
    coll = db.invoices
    coll.find_one({"_id": x})
    coll.find_one({"company_id": c})
    named = db["invoices"]
    named.find_one({"_id": x})
    dyn = db[name]
    dyn.find({})

def run3(db, other, x):
    coll = db.invoices
    coll.find_one({"_id": x})
    coll = other
    coll.find_one({"company_id": x})
    store = db
    store = other
    store.orders.find({"company_id": x})
""")
    statuses = [(item.function, item.collection, item.op, item.status) for item in found]
    assert statuses == [
        ("run", "expenses", "find", "missing"),
        ("run", "expenses", "find", "ok"),
        ("run", "orders", "find", "ok"),
        ("run", "orders", "find", "missing"),
        ("run", "", "find", "dynamic"),
        ("run", "orders", "find", "ok"),
        ("run2", "invoices", "find_one", "missing"),
        ("run2", "invoices", "find_one", "ok"),
        ("run2", "invoices", "find_one", "missing"),
        ("run2", "", "find", "dynamic"),
        ("run3", "invoices", "find_one", "missing"),
    ]


def test_alias_depth_and_module_level(tmp_path):
    found = _scan(tmp_path, """
db.orders.find({})

def run(db, cid):
    a = {"company_id": cid}
    b = a
    c = b
    db.orders.find(c)
    d = c
    db.orders.find(d)
""")
    module = [item for item in found if item.function == "<module>"]
    assert len(module) == 1
    assert module[0].status == "missing"
    chain = [item.status for item in found if item.function == "run"]
    assert chain == ["ok", "unclear"]


def test_filter_status_matches_is_constrained(tmp_path):
    lines = ["def run(db):"]
    for filt in _FILTERS:
        lines.append(f"    db.orders.find({filt!r})")
    found = _scan(tmp_path, "\n".join(lines) + "\n")
    assert len(found) == len(_FILTERS)
    for index, (filt, item) in enumerate(zip(_FILTERS, found)):
        same = (item.status == "ok") is bool(tenant_scope._is_constrained(filt))
        assert same, f"ornek {index} {item.op} status={item.status}"


def test_key_ignores_blank_line_and_comment(tmp_path):
    plain = 'def run(db, x):\n    db.orders.find({"_id": x})\n'
    padded = 'def run(db, x):\n\n    # yorum\n    db.orders.find({"_id": x})\n'
    renamed = 'def renamed(db, x):\n    db.orders.find({"_id": x})\n'
    first = baseline_counts(_scan(tmp_path, plain))
    second = baseline_counts(_scan(tmp_path, padded))
    third = baseline_counts(_scan(tmp_path, renamed))
    assert first == second
    assert first != third
    assert ("mod_case.py", "run", "orders", "find") in first
    assert ("mod_case.py", "renamed", "orders", "find") in third


def test_nested_function_and_method_names(tmp_path):
    found = _scan(tmp_path, """
class Kutu:
    async def calis(self, db):
        db.orders.find({"_id": 1})

def dis(db):
    def ic(db):
        db.orders.find({"_id": 1})
""")
    assert sorted(item.function for item in found) == ["Kutu.calis", "ic"]
    assert {item.status for item in found} == {"missing"}


def test_tenant_ok_and_unscoped_escape(tmp_path):
    found = _scan(tmp_path, """
def run(db, cid):
    db.orders.find({})  # tenant-ok: bakım
    # tenant-ok: bakım
    db.orders.find({})
    # tenant-ok:
    db.orders.find({})
    with tenant_scope.unscoped("x"):
        db.orders.find({})
    with helper.unscoped("bakim"):
        db.orders.find({})
    db.orders.find({})
    db.orders.find({"note": "# tenant-ok: bakım"})
""")
    ordered = sorted(found, key=lambda item: item.line)
    assert [item.status for item in ordered] == [
        "escaped",
        "escaped",
        "missing",
        "escaped",
        "escaped",
        "missing",
        "missing",
    ]
    assert ordered[2].status == "missing", "# tenant-ok: neden boş olamaz"
    assert ordered[-1].status == "missing"
    assert baseline_counts(found) == {("mod_case.py", "run", "orders", "find"): 3}


def test_write_twice_is_identical(tmp_path):
    tree = tmp_path / "tree"
    tree.mkdir()
    (tree / "mod_case.py").write_text(
        'def run(db, x):\n    db.orders.find({"_id": x})\n',
        encoding="utf-8",
    )
    mod = _script()
    first = tmp_path / "one.py"
    second = tmp_path / "two.py"
    assert mod.main(["--write", str(first), "--root", str(tree)]) == 0
    assert mod.main(["--write", str(second), "--root", str(tree)]) == 0
    assert first.read_bytes() == second.read_bytes()
    assert mod.main(["--write", str(first), "--root", str(tree)]) == 0
    assert first.read_bytes() == second.read_bytes()
    text = first.read_text(encoding="utf-8")
    assert "TENANT_SCOPE_BASELINE" in text
    assert "TENANT_SCOPE_FROZEN" in text
    assert "sahibin onayı olmadan değişmez" in text


def test_check_exit_codes(tmp_path):
    tree = tmp_path / "tree"
    tree.mkdir()
    (tree / "mod_case.py").write_text(
        'def run(db, x):\n    db.orders.find({"_id": x})\n    db.orders.find({"_id": x})\n',
        encoding="utf-8",
    )
    mod = _script()
    allow = tmp_path / "allow.py"
    assert mod.main(["--write", str(allow), "--root", str(tree)]) == 0
    assert mod.main(["--check", str(allow), "--root", str(tree)]) == 0
    text = allow.read_text(encoding="utf-8")
    marker = "TENANT_SCOPE_BASELINE: dict[tuple[str, str, str, str], int] = {\n"
    extra = text.replace(
        marker,
        marker + '    ("__yok__.py", "f", "orders", "find"): 1,\n',
        1,
    )
    dirty = tmp_path / "dirty.py"
    dirty.write_text(extra, encoding="utf-8")
    assert mod.main(["--check", str(dirty), "--root", str(tree)]) == 1
    kept = []
    removed = False
    for line in text.splitlines(keepends=True):
        if not removed and line.startswith("    ("):
            removed = True
            continue
        kept.append(line)
    assert removed
    short = tmp_path / "short.py"
    short.write_text("".join(kept), encoding="utf-8")
    assert mod.main(["--check", str(short), "--root", str(tree)]) == 1


def test_check_committed_baseline():
    mod = _script()
    assert mod.main(["--check"]) == 0


def test_summary_swallows_broken_pipe(tmp_path):
    tree = tmp_path / "tree"
    tree.mkdir()
    (tree / "mod_case.py").write_text(
        'def run(db, x):\n    db.orders.find({"_id": x})\n',
        encoding="utf-8",
    )
    script = (
        "import importlib.util, os, sys\n"
        "r, w = os.pipe()\n"
        "os.close(r)\n"
        "os.dup2(w, sys.stdout.fileno())\n"
        "os.close(w)\n"
        f"spec = importlib.util.spec_from_file_location('baseline_pipe', {str(_SCRIPT)!r})\n"
        "mod = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(mod)\n"
        f"raise SystemExit(mod.main(['--root', {str(tree)!r}]))\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", script],
        stderr=subprocess.PIPE,
        check=False,
    )
    assert proc.returncode == 0
    assert b"BrokenPipeError" not in proc.stderr
    assert b"Exception ignored" not in proc.stderr
