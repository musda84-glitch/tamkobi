"""Kiracı koleksiyonunda yalnız `_id` taşıyan sorgular.

Yalnız AST okur. Ağ, veritabanı ve applog yoktur. Uygulama başlangıcında
import edilmez; test çağırır.

Yakalanan çağrı: find / find_one / update_one / update_many / delete_one /
delete_many / count_documents / aggregate. Sorgu sözlüğü tek anahtar olarak
`_id` içerir (`{"_id": {"$in": ...}}` dahil). aggregate için ilk `$match`.

`# id-ok: neden` çağrının satırında ya da bir üst satırda ise sayılmaz
(legacy kip bilinçli olarak company_id yazmaz).

Platform kapsamındaki koleksiyonlar sayılmaz. `db[degisken]` dinamiktir
ve koleksiyon adı boş string olarak kaydedilir.
"""
from __future__ import annotations

import ast
import os

from schema_catalog import COLLECTIONS, SCOPE_PLATFORM

_OPS = frozenset({
    "find",
    "find_one",
    "update_one",
    "update_many",
    "delete_one",
    "delete_many",
    "count_documents",
    "aggregate",
})
_SKIP_DIRS = frozenset({
    "tests",
    "scripts",
    "deploy",
    "__pycache__",
    "docker",
    "data",
    "fixtures",
    "mysql",
})
_DB_NAMES = frozenset({"db", "_db"})


class Finding:
    __slots__ = ("file", "function", "collection", "op", "line")

    def __init__(self, file, function, collection, op, line):
        self.file = file
        self.function = function
        self.collection = collection
        self.op = op
        self.line = line

    def key(self):
        return (self.file, self.function, self.collection, self.op)


def scan(root):
    root = os.path.abspath(root)
    findings = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            name for name in dirnames
            if name not in _SKIP_DIRS and not name.startswith(".")
        )
        for filename in sorted(filenames):
            if not filename.endswith(".py"):
                continue
            full = os.path.join(dirpath, filename)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            _scan_file(full, rel, findings)
    return findings


def baseline_counts(findings):
    counts = {}
    for item in findings:
        key = item.key()
        counts[key] = counts.get(key, 0) + 1
    return counts


def _scan_file(path, rel, findings):
    try:
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
    except (OSError, UnicodeDecodeError):
        return
    try:
        tree = ast.parse(source, filename=rel)
    except SyntaxError:
        return
    lines = source.splitlines()
    _walk(tree.body, "<module>", {}, {}, lines, rel, findings)


def _walk(body, function, aliases, assigns, lines, rel, findings):
    for stmt in body or []:
        _visit(stmt, function, aliases, assigns, lines, rel, findings)


def _visit(node, function, aliases, assigns, lines, rel, findings):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        _walk(node.body, node.name, dict(aliases), {}, lines, rel, findings)
        return
    if isinstance(node, ast.ClassDef):
        _walk(node.body, function, aliases, assigns, lines, rel, findings)
        return
    if isinstance(node, ast.Assign) and len(node.targets) == 1:
        target = node.targets[0]
        if isinstance(target, ast.Name):
            coll = _alias_collection(node.value)
            if coll is not None:
                aliases[target.id] = coll
                assigns.pop(target.id, None)
            elif isinstance(node.value, ast.Dict):
                assigns[target.id] = {"dict": node.value, "company_line": None}
            else:
                assigns.pop(target.id, None)
        elif _is_company_subscript(target) and target.value.id in assigns:
            assigns[target.value.id]["company_line"] = node.lineno
    if isinstance(node, ast.Call):
        _consider(node, function, aliases, assigns, lines, rel, findings)
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            _visit(child, function, aliases, assigns, lines, rel, findings)
            continue
        _visit(child, function, aliases, assigns, lines, rel, findings)


def _consider(call, function, aliases, assigns, lines, rel, findings):
    parsed = _call_target(call.func, aliases)
    if parsed is None:
        return
    collection, op = parsed
    if not _interesting(collection):
        return
    if _id_ok(lines, getattr(call, "lineno", 0) or 0):
        return
    query = _query_node(call, op)
    if not _is_id_only(query, assigns, getattr(call, "lineno", 0) or 0):
        return
    findings.append(Finding(rel, function, collection, op, call.lineno))


def _call_target(func, aliases):
    if not isinstance(func, ast.Attribute) or func.attr not in _OPS:
        return None
    obj = func.value
    if isinstance(obj, ast.Attribute) and isinstance(obj.value, ast.Name) and obj.value.id in _DB_NAMES:
        return obj.attr, func.attr
    if isinstance(obj, ast.Subscript) and isinstance(obj.value, ast.Name) and obj.value.id in _DB_NAMES:
        sl = obj.slice
        if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
            return sl.value, func.attr
        return "", func.attr
    if isinstance(obj, ast.Name) and obj.id in aliases:
        return aliases[obj.id], func.attr
    return None


def _alias_collection(value):
    if isinstance(value, ast.Attribute) and isinstance(value.value, ast.Name) and value.value.id in _DB_NAMES:
        return value.attr
    if isinstance(value, ast.Subscript) and isinstance(value.value, ast.Name) and value.value.id in _DB_NAMES:
        sl = value.slice
        if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
            return sl.value
        return ""
    return None


def _is_company_subscript(target):
    if not isinstance(target, ast.Subscript) or not isinstance(target.value, ast.Name):
        return False
    sl = target.slice
    return isinstance(sl, ast.Constant) and sl.value == "company_id"


def _query_node(call, op):
    if not call.args:
        return None
    arg = call.args[0]
    if op != "aggregate":
        return arg
    if not isinstance(arg, ast.List) or not arg.elts:
        return None
    first = arg.elts[0]
    if not isinstance(first, ast.Dict):
        return None
    for key, value in zip(first.keys, first.values):
        if isinstance(key, ast.Constant) and key.value == "$match":
            return value
    return None


def _is_id_only(node, assigns, lineno):
    if isinstance(node, ast.Name):
        bound = assigns.get(node.id)
        if not bound:
            return False
        company_line = bound.get("company_line")
        if company_line is not None and company_line < lineno:
            return False
        node = bound.get("dict")
    if not isinstance(node, ast.Dict) or len(node.keys) != 1:
        return False
    key = node.keys[0]
    return isinstance(key, ast.Constant) and key.value == "_id"


def _interesting(collection):
    if collection == "":
        return True
    meta = COLLECTIONS.get(collection)
    if not meta:
        return True
    return meta.get("scope") != SCOPE_PLATFORM


def _id_ok(lines, lineno):
    for number in (lineno, lineno - 1):
        if number < 1 or number > len(lines):
            continue
        text = lines[number - 1]
        if "id-ok" not in text:
            continue
        reason = text.split("id-ok", 1)[1].lstrip(":").strip()
        if reason:
            return True
    return False
