"""Kiracı kapsamı statik tabanını üretir veya karşılaştırır.

Veritabanına, ağa ve .env dosyasına erişmez. Yalnız kaynak AST'ı okur.
"""
from __future__ import annotations

import argparse
import ast
import os
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from tenant_static_scan import baseline_counts, scan

_ALLOWLIST = os.path.join(_BACKEND, "tenant_scope_allowlist.py")
_FROZEN_NAMES = frozenset({"rbac.py", "addons.py"})
_DOC = (
    '"""Üretildi: python backend/scripts/tenant_scope_baseline.py --write; '
    'elle yalnız silme yapın."""\n'
)


def _frozen(path):
    return path.rsplit("/", 1)[-1] in _FROZEN_NAMES


def _split(counts):
    base = {}
    frozen = {}
    for key, count in counts.items():
        if _frozen(key[0]):
            frozen[key] = count
        else:
            base[key] = count
    return base, frozen


def _emit_dict(name, counts, header):
    lines = [header, f"{name}: dict[tuple[str, str, str, str], int] = {{"]
    current = None
    for key in sorted(counts):
        file, function, collection, op = key
        if file != current:
            current = file
            lines.append(f"    # {file}")
        lines.append(f"    ({file!r}, {function!r}, {collection!r}, {op!r}): {counts[key]},")
    lines.append("}")
    return "\n".join(lines)


def render(counts):
    """Allowlist kaynağı. Aynı sayımda bayt bayt aynı metin."""
    base, frozen = _split(counts)
    parts = [
        _DOC,
        "from __future__ import annotations",
        "",
        "# (dosya, fonksiyon, koleksiyon, op) -> adet. Satır numarası anahtarda yoktur.",
        "# Elle yalnız silme yapın. Yeni ihlal company_id, TenantDB veya \"# tenant-ok: neden\" ister.",
        "",
        _emit_dict("TENANT_SCOPE_BASELINE", base, "# Taban. Yeni anahtar eklemeyin; liste yalnız küçülür."),
        "",
        _emit_dict(
            "TENANT_SCOPE_FROZEN",
            frozen,
            "# rbac.py ve addons.py: sahibin onayı olmadan değişmez. Bu dosyalar düzeltilmez, yalnız listelenir.",
        ),
        "",
    ]
    return "\n".join(parts)


def load_tables(path):
    with open(path, encoding="utf-8") as handle:
        tree = ast.parse(handle.read(), filename=path)
    found = {}
    for node in tree.body:
        target = None
        value = None
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target = node.target.id
            value = node.value
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target = node.targets[0].id
            value = node.value
        if target in ("TENANT_SCOPE_BASELINE", "TENANT_SCOPE_FROZEN") and value is not None:
            found[target] = ast.literal_eval(value)
    return found


def _fmt(key, code, base):
    file, function, collection, op = key
    return f"{file} {function} {collection} {op} kod={code} taban={base}"


def _diff(left, right):
    yeni = []
    bayat = []
    for key in sorted(set(left) | set(right)):
        code = left.get(key, 0)
        base = right.get(key, 0)
        if code > base:
            yeni.append((key, code, base))
        elif code < base:
            bayat.append((key, code, base))
    return yeni, bayat


def _print_diff(label, yeni, bayat):
    if not yeni and not bayat:
        return 0
    print(f"{label} yeni {len(yeni)}")
    for key, code, base in yeni:
        print(_fmt(key, code, base))
    print(f"{label} bayat {len(bayat)}")
    for key, code, base in bayat:
        print(_fmt(key, code, base))
    return 1


def _print_summary(findings):
    buckets = {"ok": 0, "missing": 0, "unclear": 0, "dynamic": 0, "escaped": 0}
    per_file = {}
    for item in findings:
        if item.status in buckets:
            buckets[item.status] += 1
        if item.status in ("missing", "unclear"):
            per_file.setdefault(item.file, []).append(item)
    print(f"toplam {sum(buckets.values())}")
    print(f"ok {buckets['ok']}")
    print(f"missing {buckets['missing']}")
    print(f"unclear {buckets['unclear']}")
    print(f"dynamic {buckets['dynamic']}")
    print(f"kacis {buckets['escaped']}")
    counts = baseline_counts(findings)
    print(f"benzersiz {len(counts)}")
    print(f"dosya {len({key[0] for key in counts})}")
    order = sorted(per_file, key=lambda name: (-len(per_file[name]), name))
    for name in order:
        tally = {}
        for item in per_file[name]:
            key = (item.function, item.collection, item.op)
            tally[key] = tally.get(key, 0) + 1
        print(f"# {name} {len(per_file[name])}")
        for key in sorted(tally)[:15]:
            function, collection, op = key
            print(f"{name} {function} {collection} {op} {tally[key]}")


def _scan_counts(root):
    return baseline_counts(scan(root or _BACKEND))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Kiracı kapsamı statik tabanı")
    parser.add_argument("--write", nargs="?", const="", default=None, metavar="PATH")
    parser.add_argument("--check", nargs="?", const="", default=None, metavar="PATH")
    parser.add_argument("--root", default=None)
    args = parser.parse_args(argv)
    root = args.root or _BACKEND

    if args.write is not None:
        path = args.write or _ALLOWLIST
        text = render(_scan_counts(root))
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        return 0

    if args.check is not None:
        path = args.check or _ALLOWLIST
        tables = load_tables(path)
        base, frozen = _split(_scan_counts(root))
        failed = _print_diff("taban", *_diff(base, tables.get("TENANT_SCOPE_BASELINE", {})))
        failed |= _print_diff("frozen", *_diff(frozen, tables.get("TENANT_SCOPE_FROZEN", {})))
        if not failed:
            print("temiz")
        return 1 if failed else 0

    _print_summary(scan(root))
    return 0


if __name__ == "__main__":
    sys.exit(main())
