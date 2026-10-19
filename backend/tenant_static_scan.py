"""Kiracı koleksiyonu çağrılarının statik taraması.

Yalnız AST okur. Ağ, veritabanı ve applog yoktur. Uygulama başlangıcında
import edilmez; test ve `scripts/tenant_scope_baseline.py` çağırır.

İhlal, collection_kind'i tenant ya da unknown olan bir çağrıda company_id
kısıtının görülememesidir. Tanıma kuralları tenant_scope._evaluate ile
aynı op kümesini izler: sorgu op'larında 1. argüman (distinct'te sorgu
2. argüman), insert'te doküman, replace_one'da sorgu ve doküman,
aggregate'te ilk aşama $match, changed_since'te company_id argümanı,
upsert=True update'te $set / $setOnInsert içindeki company_id.
"""
from __future__ import annotations

import ast
import os

from tenant_scope import collection_kind

_QUERY_OPS = frozenset({
    "find",
    "find_one",
    "count_documents",
    "delete_one",
    "delete_many",
})
_UPDATE_OPS = frozenset({
    "update_one",
    "update_many",
    "update_one_atomic",
    "find_one_and_update",
})
_OPS = _QUERY_OPS | _UPDATE_OPS | frozenset({
    "distinct",
    "replace_one",
    "insert_one",
    "insert_many",
    "aggregate",
    "changed_since",
})
_SKIP_DIRS = frozenset({
    "tests",
    "scripts",
    "__pycache__",
    "data",
    "fixtures",
    "mysql",
    "docker",
})
_SKIP_FILES = frozenset({
    "mysql_store.py",
    "tenant_db.py",
    "tenant_scope.py",
    "tenant_static_scan.py",
})
_MAX_STEPS = 3
_UNCLEAR = object()


class Finding:
    """Bir db.<koleksiyon>.<op> çağrısı. Anahtara satır girmez."""

    __slots__ = ("file", "function", "collection", "op", "status", "line")

    def __init__(self, file, function, collection, op, status, line):
        self.file = file
        self.function = function
        self.collection = collection
        self.op = op
        self.status = status
        self.line = line

    def __repr__(self):
        return (
            f"Finding({self.file!r}, {self.function!r}, {self.collection!r}, "
            f"{self.op!r}, {self.status!r}, {self.line!r})"
        )


class _Scan:
    def __init__(self, rel, comments, findings):
        self.rel = rel
        self.comments = comments
        self.findings = findings


class _Block:
    def __init__(self, parent, scan, function, classes, seq, in_class_body=False):
        self.parent = parent
        self.scan = scan
        self.function = function
        self.classes = classes
        self.seq = seq
        self.in_class_body = in_class_body
        self.unscoped = 0 if parent is None else parent.unscoped
        self.events = {}
        self.assign_counts = {}

    def child(self, unscoped_add=0):
        block = _Block(
            self,
            self.scan,
            self.function,
            self.classes,
            self.seq,
            self.in_class_body,
        )
        block.unscoped = self.unscoped + unscoped_add
        return block

    def tick(self):
        self.seq[0] += 1
        return self.seq[0]

    def root(self):
        block = self
        while block.parent is not None:
            block = block.parent
        return block

    def add_assign(self, name, expr, rebind=True):
        seq = self.tick()
        self.events.setdefault(name, []).append((seq, "assign", expr))
        if rebind:
            counts = self.root().assign_counts
            counts[name] = counts.get(name, 0) + 1

    def add_company(self, name):
        seq = self.tick()
        self.events.setdefault(name, []).append((seq, "company", None))


def scan(root):
    """root altındaki .py dosyalarını tara. file, root'a göre '/' ayraçlıdır."""
    root = os.path.abspath(root)
    findings = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            name for name in dirnames
            if name not in _SKIP_DIRS and not name.startswith(".")
        )
        for filename in sorted(filenames):
            if not filename.endswith(".py") or filename in _SKIP_FILES:
                continue
            full = os.path.join(dirpath, filename)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            _scan_file(full, rel, findings)
    return findings


def baseline_counts(findings):
    """İhlal (missing + unclear) adetleri. (dosya, fonksiyon, koleksiyon, op) -> n."""
    counts = {}
    for item in findings:
        if item.status not in ("missing", "unclear"):
            continue
        key = (item.file, item.function, item.collection, item.op)
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
    scan = _Scan(rel, _comment_reasons(source), findings)
    root = _Block(None, scan, "<module>", [], [0], False)
    for stmt in tree.body:
        _walk_stmt(stmt, root)


def _comment_reasons(source):
    """Satır -> tenant-ok nedeni. İşaret var ama neden boşsa değer ''.

    Dize ve üç tırnak içindeki # işaretleri yorum sayılmaz.
    """
    if "tenant-ok" not in source:
        return {}
    found = {}
    i = 0
    n = len(source)
    line = 1
    quote = None
    while i < n:
        ch = source[i]
        if ch == "\n":
            line += 1
            i += 1
            continue
        if quote:
            if quote in ("'''", '"""'):
                if source.startswith(quote, i):
                    quote = None
                    i += 3
                    continue
                i += 1
                continue
            if ch == "\\" and i + 1 < n:
                i += 2
                if source[i - 1] == "\n":
                    line += 1
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        opened = _open_string(source, i)
        if opened is not None:
            quote = opened[0]
            i = opened[1]
            continue
        if ch == "#":
            end = source.find("\n", i)
            if end < 0:
                end = n
            reason = _tenant_ok_reason(source[i:end])
            if reason is not None:
                prev = found.get(line)
                if prev is None or (not prev and reason):
                    found[line] = reason
            i = end
            continue
        i += 1
    return found


def _open_string(source, i):
    j = i
    prefix = ""
    while j < len(source) and source[j] in "rRuUbBfF":
        prefix += source[j].lower()
        j += 1
        if len(prefix) > 2:
            return None
    if not prefix and j == i:
        pass
    if j >= len(source) or source[j] not in "'\"":
        return None
    if prefix and any(ch not in "rubf" for ch in prefix):
        return None
    if prefix.count("r") > 1 or prefix.count("b") > 1 or prefix.count("f") > 1 or prefix.count("u") > 1:
        return None
    if "b" in prefix and ("u" in prefix or "f" in prefix):
        return None
    mark = source[j]
    if source.startswith(mark * 3, j):
        return mark * 3, j + 3
    return mark, j + 1


def _tenant_ok_reason(text):
    body = text[1:].strip() if text.startswith("#") else text.strip()
    marker = "tenant-ok"
    if not body.startswith(marker):
        return None
    rest = body[len(marker):].lstrip()
    if not rest.startswith(":"):
        return None
    return rest[1:].strip()


def _walk_stmt(stmt, ctx):
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
        _walk_function(stmt, ctx)
        return
    if isinstance(stmt, ast.ClassDef):
        _walk_class(stmt, ctx)
        return
    if isinstance(stmt, (ast.With, ast.AsyncWith)):
        for item in stmt.items:
            _walk_expr(item.context_expr, ctx)
        add = 1 if any(_is_unscoped(item.context_expr) for item in stmt.items) else 0
        inner = ctx.child(add)
        for item in stmt.items:
            if item.optional_vars is not None:
                _bind_store(item.optional_vars, None, inner)
        for sub in stmt.body:
            _walk_stmt(sub, inner)
        return
    if isinstance(stmt, ast.If):
        _walk_expr(stmt.test, ctx)
        body = ctx.child()
        for sub in stmt.body:
            _walk_stmt(sub, body)
        orelse = ctx.child()
        for sub in stmt.orelse:
            _walk_stmt(sub, orelse)
        return
    if isinstance(stmt, (ast.For, ast.AsyncFor)):
        _walk_expr(stmt.iter, ctx)
        inner = ctx.child()
        _bind_store(stmt.target, None, inner)
        for sub in stmt.body:
            _walk_stmt(sub, inner)
        orelse = ctx.child()
        for sub in stmt.orelse:
            _walk_stmt(sub, orelse)
        return
    if isinstance(stmt, ast.While):
        _walk_expr(stmt.test, ctx)
        inner = ctx.child()
        for sub in stmt.body:
            _walk_stmt(sub, inner)
        orelse = ctx.child()
        for sub in stmt.orelse:
            _walk_stmt(sub, orelse)
        return
    if isinstance(stmt, ast.Try):
        _walk_try(stmt, ctx)
        return
    if isinstance(stmt, getattr(ast, "TryStar", ())):
        _walk_try(stmt, ctx)
        return
    if isinstance(stmt, ast.Match):
        _walk_expr(stmt.subject, ctx)
        for case in stmt.cases:
            inner = ctx.child()
            _bind_match(case.pattern, inner)
            if case.guard is not None:
                _walk_expr(case.guard, inner)
            for sub in case.body:
                _walk_stmt(sub, inner)
        return
    if isinstance(stmt, ast.Assign):
        _walk_expr(stmt.value, ctx)
        for target in stmt.targets:
            _bind_store(target, stmt.value, ctx)
        return
    if isinstance(stmt, ast.AnnAssign):
        if stmt.annotation is not None:
            _walk_expr(stmt.annotation, ctx)
        if stmt.value is not None:
            _walk_expr(stmt.value, ctx)
            _bind_store(stmt.target, stmt.value, ctx)
        return
    if isinstance(stmt, ast.AugAssign):
        _walk_expr(stmt.target, ctx)
        _walk_expr(stmt.value, ctx)
        if isinstance(stmt.target, ast.Name):
            ctx.add_assign(stmt.target.id, None)
        return
    if isinstance(stmt, ast.Delete):
        for target in stmt.targets:
            if isinstance(target, ast.Name):
                ctx.add_assign(target.id, None)
            else:
                _walk_expr(target, ctx)
        return
    if isinstance(stmt, ast.Return):
        if stmt.value is not None:
            _walk_expr(stmt.value, ctx)
        return
    if isinstance(stmt, ast.Expr):
        _walk_expr(stmt.value, ctx)
        return
    if isinstance(stmt, ast.Assert):
        _walk_expr(stmt.test, ctx)
        if stmt.msg is not None:
            _walk_expr(stmt.msg, ctx)
        return
    if isinstance(stmt, ast.Raise):
        if stmt.exc is not None:
            _walk_expr(stmt.exc, ctx)
        if stmt.cause is not None:
            _walk_expr(stmt.cause, ctx)
        return
    if isinstance(stmt, getattr(ast, "TypeAlias", ())):
        _walk_expr(stmt.value, ctx)
        return
    if isinstance(stmt, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal, ast.Pass, ast.Break, ast.Continue)):
        return
    for child in ast.iter_child_nodes(stmt):
        if isinstance(child, ast.stmt):
            _walk_stmt(child, ctx)
        elif isinstance(child, ast.expr):
            _walk_expr(child, ctx)


def _walk_try(stmt, ctx):
    inner = ctx.child()
    for sub in stmt.body:
        _walk_stmt(sub, inner)
    for handler in stmt.handlers:
        if handler.type is not None:
            _walk_expr(handler.type, ctx)
        arm = ctx.child()
        if handler.name:
            arm.add_assign(handler.name, None, rebind=False)
        for sub in handler.body:
            _walk_stmt(sub, arm)
    orelse = ctx.child()
    for sub in stmt.orelse:
        _walk_stmt(sub, orelse)
    final = ctx.child()
    for sub in stmt.finalbody:
        _walk_stmt(sub, final)


def _walk_function(stmt, ctx):
    for deco in stmt.decorator_list:
        _walk_expr(deco, ctx)
    _walk_arguments(stmt.args, ctx)
    if stmt.returns is not None:
        _walk_expr(stmt.returns, ctx)
    if ctx.in_class_body and ctx.classes:
        function = ".".join([*ctx.classes, stmt.name])
        classes = list(ctx.classes)
    else:
        function = stmt.name
        classes = []
    inner = _Block(None, ctx.scan, function, classes, [0], False)
    for sub in stmt.body:
        _walk_stmt(sub, inner)


def _walk_class(stmt, ctx):
    for deco in stmt.decorator_list:
        _walk_expr(deco, ctx)
    for base in stmt.bases:
        _walk_expr(base, ctx)
    for kw in stmt.keywords:
        _walk_expr(kw.value, ctx)
    inner = ctx.child()
    inner.classes = [*ctx.classes, stmt.name]
    inner.in_class_body = True
    for sub in stmt.body:
        _walk_stmt(sub, inner)


def _walk_arguments(args, ctx):
    for default in args.defaults:
        _walk_expr(default, ctx)
    for default in args.kw_defaults:
        if default is not None:
            _walk_expr(default, ctx)
    pool = list(args.posonlyargs) + list(args.args) + list(args.kwonlyargs)
    if args.vararg is not None:
        pool.append(args.vararg)
    if args.kwarg is not None:
        pool.append(args.kwarg)
    for arg in pool:
        if arg.annotation is not None:
            _walk_expr(arg.annotation, ctx)


def _walk_expr(node, ctx):
    if node is None:
        return
    if isinstance(node, ast.Call):
        _walk_expr(node.func, ctx)
        for arg in node.args:
            _walk_expr(arg, ctx)
        for kw in node.keywords:
            _walk_expr(kw.value, ctx)
        kind = _classify_call(node)
        if kind is not None:
            _record_call(node, kind, ctx)
        return
    if isinstance(node, ast.NamedExpr):
        _walk_expr(node.value, ctx)
        if isinstance(node.target, ast.Name):
            ctx.add_assign(node.target.id, node.value)
        else:
            _walk_expr(node.target, ctx)
        return
    if isinstance(node, ast.Lambda):
        inner = ctx.child()
        for name in _arg_names(node.args):
            inner.add_assign(name, None, rebind=False)
        _walk_expr(node.body, inner)
        return
    if isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
        inner = ctx.child()
        for gen in node.generators:
            _walk_expr(gen.iter, ctx)
            _bind_store(gen.target, None, inner, rebind=False)
            for test in gen.ifs:
                _walk_expr(test, inner)
        if isinstance(node, ast.DictComp):
            _walk_expr(node.key, inner)
            _walk_expr(node.value, inner)
        else:
            _walk_expr(node.elt, inner)
        return
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.expr):
            _walk_expr(child, ctx)


def _arg_names(args):
    names = []
    for arg in list(args.posonlyargs) + list(args.args) + list(args.kwonlyargs):
        names.append(arg.arg)
    if args.vararg is not None:
        names.append(args.vararg.arg)
    if args.kwarg is not None:
        names.append(args.kwarg.arg)
    return names


def _bind_store(target, value, ctx, rebind=True):
    if target is None:
        return
    if isinstance(target, ast.Name):
        ctx.add_assign(target.id, value, rebind=rebind)
        return
    if isinstance(target, ast.Starred):
        _bind_store(target.value, None, ctx, rebind=rebind)
        return
    if isinstance(target, (ast.Tuple, ast.List)):
        for elt in target.elts:
            _bind_store(elt, None, ctx, rebind=rebind)
        return
    if (
        isinstance(target, ast.Subscript)
        and isinstance(target.value, ast.Name)
        and _const_str(target.slice) == "company_id"
    ):
        ctx.add_company(target.value.id)
        return
    _walk_expr(target, ctx)


def _bind_match(pattern, ctx):
    for node in ast.walk(pattern):
        if isinstance(node, ast.MatchAs) and node.name:
            ctx.add_assign(node.name, None)
        elif isinstance(node, getattr(ast, "MatchStar", ()) ) and getattr(node, "name", None):
            ctx.add_assign(node.name, None)


def _is_unscoped(node):
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
        return False
    if node.func.attr != "unscoped":
        return False
    reason = None
    if node.args and not isinstance(node.args[0], ast.Starred):
        reason = node.args[0]
    for kw in node.keywords:
        if kw.arg == "reason":
            reason = kw.value
    return (
        isinstance(reason, ast.Constant)
        and isinstance(reason.value, str)
        and bool(reason.value.strip())
    )


def _ends_db(node):
    if isinstance(node, ast.Name):
        return node.id.endswith("db")
    if isinstance(node, ast.Attribute):
        return node.attr.endswith("db")
    return False


def _classify_call(node):
    func = node.func
    if not isinstance(func, ast.Attribute) or func.attr not in _OPS:
        return None
    op = func.attr
    base = func.value
    if isinstance(base, ast.Attribute) and _ends_db(base.value):
        return ("named", base.attr, op)
    if isinstance(base, ast.Subscript) and _ends_db(base.value):
        key = _const_str(base.slice)
        if key is None:
            return ("dynamic", "", op)
        return ("named", key, op)
    if isinstance(base, ast.Call) and _is_getattr_db(base):
        return ("dynamic", "", op)
    return None


def _is_getattr_db(node):
    func = node.func
    if isinstance(func, ast.Name) and func.id == "getattr":
        return bool(node.args) and _ends_db(node.args[0])
    return False


def _record_call(node, kind, ctx):
    tag, collection, op = kind
    if tag == "dynamic":
        _emit(ctx, node, "", op, "dynamic")
        return
    if collection_kind(collection) not in ("tenant", "unknown"):
        return
    pos = ctx.tick()
    status = _status_of(node, op, ctx, pos)
    if status in ("missing", "unclear") and _escaped(node, ctx):
        status = "escaped"
    _emit(ctx, node, collection, op, status)


def _emit(ctx, node, collection, op, status):
    ctx.scan.findings.append(Finding(
        ctx.scan.rel,
        ctx.function,
        collection,
        op,
        status,
        getattr(node, "lineno", 0) or 0,
    ))


def _escaped(node, ctx):
    if ctx.unscoped:
        return True
    reasons = ctx.scan.comments
    found = []
    for line in (getattr(node, "lineno", 0) or 0, (getattr(node, "lineno", 0) or 0) - 1):
        if line in reasons:
            found.append(reasons[line])
    return any(reason for reason in found)


def _status_of(call, op, ctx, pos):
    if op in _QUERY_OPS:
        return _eval_query(_arg(call, 0, ("query",)), ctx, pos)
    if op == "distinct":
        return _eval_query(_arg(call, 1, ("query",)), ctx, pos)
    if op in _UPDATE_OPS:
        query = _eval_query(_arg(call, 0, ("query",)), ctx, pos)
        update = _eval_update(_arg(call, 1, ("update",)), ctx, pos)
        return _merge_update(query, update, _upsert(call, op))
    if op == "replace_one":
        query = _eval_query(_arg(call, 0, ("query",)), ctx, pos)
        doc = _eval_doc(_arg(call, 1, ("replacement", "doc")), ctx, pos, many=False)
        return _merge_required(query, doc)
    if op == "insert_one":
        return _eval_doc(_arg(call, 0, ("doc", "docs")), ctx, pos, many=False)
    if op == "insert_many":
        return _eval_doc(_arg(call, 0, ("doc", "docs")), ctx, pos, many=True)
    if op == "aggregate":
        return _eval_pipeline(_arg(call, 0, ("pipeline",)), ctx, pos)
    if op == "changed_since":
        return _eval_company(_arg(call, 1, ("company_id",)), ctx, pos)
    return "unclear"


def _arg(call, index, names):
    for kw in call.keywords:
        if kw.arg in names:
            return kw.value
    starred = any(isinstance(arg, ast.Starred) for arg in call.args)
    if starred:
        return _UNCLEAR
    if index < len(call.args):
        return call.args[index]
    if any(kw.arg is None for kw in call.keywords):
        return _UNCLEAR
    return None


def _upsert(call, op):
    if op not in ("update_one", "update_many", "find_one_and_update"):
        return False
    for kw in call.keywords:
        if kw.arg == "upsert":
            return _bool_const(kw.value)
    if any(isinstance(arg, ast.Starred) for arg in call.args):
        return None
    if len(call.args) >= 3:
        return _bool_const(call.args[2])
    return False


def _bool_const(node):
    if isinstance(node, ast.Constant) and node.value is True:
        return True
    if isinstance(node, ast.Constant) and node.value is False:
        return False
    return None


def _eval_query(node, ctx, pos):
    if node is None:
        return "missing"
    if node is _UNCLEAR:
        return "unclear"
    return _eval(node, ctx, 0, pos, "query")


def _eval_doc(node, ctx, pos, many):
    if node is None:
        return "missing"
    if node is _UNCLEAR:
        return "unclear"
    return _eval(node, ctx, 0, pos, "docs" if many else "doc")


def _eval_update(node, ctx, pos):
    if node is None:
        return "missing"
    if node is _UNCLEAR:
        return "unclear"
    return _eval(node, ctx, 0, pos, "update")


def _eval_pipeline(node, ctx, pos):
    if node is None:
        return "missing"
    if node is _UNCLEAR:
        return "unclear"
    return _eval(node, ctx, 0, pos, "pipeline")


def _eval_company(node, ctx, pos):
    if node is None:
        return "missing"
    if node is _UNCLEAR:
        return "unclear"
    if isinstance(node, ast.Constant):
        if node.value is None:
            return "missing"
        if isinstance(node.value, str) and not node.value.strip():
            return "missing"
        return "ok"
    if isinstance(node, ast.Name):
        found = _lookup(node.id, ctx, pos, 1)
        if found[0] == "expr" and isinstance(found[1], ast.Constant):
            return _eval_company(found[1], ctx, found[2])
        return "ok"
    if isinstance(node, ast.NamedExpr):
        return _eval_company(node.value, ctx, pos)
    return "ok"


def _merge_presence(left, right):
    if left == "ok" or right == "ok":
        return "ok"
    if left == "unclear" or right == "unclear":
        return "unclear"
    return "missing"


def _merge_required(left, right):
    if left == "missing" or right == "missing":
        return "missing"
    if left == "unclear" or right == "unclear":
        return "unclear"
    return "ok"


def _merge_update(query, update, upsert):
    if upsert is True:
        return _merge_presence(query, update)
    if upsert is False:
        return query
    if query == "ok":
        return "ok"
    if query == "missing" and update == "missing":
        return "missing"
    return "unclear"


def _eval(node, ctx, depth, pos, mode):
    if isinstance(node, ast.NamedExpr):
        return _eval(node.value, ctx, depth, pos, mode)
    if isinstance(node, ast.Name):
        return _eval_name(node.id, ctx, depth + 1, pos, mode)
    if isinstance(node, ast.Constant):
        if node.value is None:
            return "missing"
        return "unclear"
    if isinstance(node, ast.Dict):
        return _eval_dict(node, ctx, depth, pos, mode)
    if isinstance(node, (ast.List, ast.Tuple)):
        return _eval_seq(node, ctx, depth, pos, mode)
    if isinstance(node, (ast.Call, ast.DictComp, ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.Starred)):
        return "unclear"
    if isinstance(node, (ast.Attribute, ast.Subscript, ast.BinOp, ast.BoolOp, ast.UnaryOp,
                         ast.IfExp, ast.Compare, ast.JoinedStr, ast.Lambda, ast.Await,
                         ast.Yield, ast.YieldFrom, ast.Set)):
        return "unclear"
    return "unclear"


def _eval_name(name, ctx, depth, pos, mode):
    if depth > _MAX_STEPS:
        return "unclear"
    if ctx.root().assign_counts.get(name, 0) > 1:
        return "unclear"
    found = _lookup(name, ctx, pos, depth)
    if found[0] == "missing":
        return "unclear"
    if found[0] == "ok":
        if mode == "update":
            return "unclear"
        return "ok"
    if found[0] != "expr":
        return "unclear"
    expr, assign_pos, company_after = found[1], found[2], found[3]
    if company_after and mode in ("query", "doc"):
        return "ok"
    status = _eval(expr, ctx, depth, assign_pos, mode)
    if company_after and mode == "update":
        if isinstance(expr, ast.Dict) and _dollar_keys(expr):
            return status
        if status == "unclear":
            return "unclear"
        return "ok"
    return status


def _lookup(name, ctx, pos, depth):
    """(kind, expr, assign_pos, company_after). kind: ok | expr | missing."""
    block = ctx
    while block is not None:
        events = [item for item in block.events.get(name, ()) if item[0] < pos]
        if events:
            return _from_events(events, depth)
        block = block.parent
    return ("missing", None, pos, False)


def _from_events(events, depth):
    last_assign = -1
    for index, item in enumerate(events):
        if item[1] == "assign":
            last_assign = index
    company_after = any(item[1] == "company" for item in events[last_assign + 1:])
    assigns = [item for item in events if item[1] == "assign"]
    if company_after and (len(assigns) != 1 or assigns[0][2] is None):
        return ("ok", None, events[-1][0], True)
    if company_after and len(assigns) == 1 and assigns[0][2] is not None:
        seq, _kind, expr = assigns[0]
        return ("expr", expr, seq, True)
    if len(assigns) != 1 or assigns[0][2] is None:
        return ("missing", None, 0, False)
    seq, _kind, expr = assigns[0]
    if depth > _MAX_STEPS:
        return ("missing", None, seq, False)
    return ("expr", expr, seq, False)


def _eval_dict(node, ctx, depth, pos, mode):
    proven, opaque = _proven(node)
    if mode == "pipeline":
        if "$match" in proven:
            return _eval(proven["$match"], ctx, depth, pos, "query")
        return "unclear" if opaque else "missing"
    if mode == "update":
        return _eval_update_dict(proven, opaque, ctx, depth, pos)
    if "company_id" in proven and mode in ("query", "doc", "docs"):
        return "ok"
    if mode == "query" and "$and" in proven:
        status = _eval_and(proven["$and"], ctx, depth, pos)
        if status == "ok" or not opaque:
            return status
        if status == "missing":
            return "unclear"
        return status
    if "company_id" in proven:
        return "ok"
    if opaque:
        return "unclear"
    return "missing"


def _eval_update_dict(proven, opaque, ctx, depth, pos):
    dollar = [key for key in proven if key.startswith("$")]
    op_status = _operator_company(proven, ctx, depth, pos)
    if op_status == "ok":
        return "ok"
    if not dollar and not opaque:
        return "ok" if "company_id" in proven else "missing"
    if not dollar and opaque:
        if "company_id" in proven:
            return "ok"
        return "unclear" if op_status == "unclear" else "unclear"
    if op_status == "unclear" or opaque:
        return "unclear"
    return "missing"


def _operator_company(proven, ctx, depth, pos):
    statuses = []
    for key in ("$set", "$setOnInsert"):
        if key not in proven:
            continue
        statuses.append(_eval(proven[key], ctx, depth, pos, "doc"))
    if any(status == "ok" for status in statuses):
        return "ok"
    if any(status == "unclear" for status in statuses):
        return "unclear"
    return "missing"


def _eval_and(node, ctx, depth, pos):
    seq = _follow_seq(node, ctx, depth, pos)
    if isinstance(seq, str):
        return seq
    if not isinstance(seq, (ast.List, ast.Tuple)):
        return "unclear"
    if not seq.elts:
        return "missing"
    statuses = []
    for elt in seq.elts:
        if isinstance(elt, ast.Starred):
            statuses.append("unclear")
        else:
            statuses.append(_eval(elt, ctx, depth, pos, "query"))
    if any(status == "ok" for status in statuses):
        return "ok"
    if any(status == "unclear" for status in statuses):
        return "unclear"
    return "missing"


def _follow_seq(node, ctx, depth, pos):
    current = node
    current_pos = pos
    steps = depth
    while isinstance(current, ast.Name):
        steps += 1
        if steps > _MAX_STEPS:
            return "unclear"
        found = _lookup(current.id, ctx, current_pos, steps)
        if found[0] == "ok":
            return "ok"
        if found[0] != "expr":
            return "unclear"
        current = found[1]
        current_pos = found[2]
    if isinstance(current, (ast.List, ast.Tuple, ast.Dict)):
        return current
    if isinstance(current, (ast.Call, ast.DictComp, ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.Starred)):
        return "unclear"
    return "unclear"


def _eval_seq(node, ctx, depth, pos, mode):
    if mode == "docs":
        if not node.elts:
            return "ok"
        statuses = []
        for elt in node.elts:
            if isinstance(elt, ast.Starred):
                statuses.append("unclear")
            else:
                statuses.append(_eval(elt, ctx, depth, pos, "doc"))
        if any(status == "missing" for status in statuses):
            return "missing"
        if any(status == "unclear" for status in statuses):
            return "unclear"
        return "ok"
    if mode == "update":
        if not node.elts:
            return "missing"
        statuses = []
        for elt in node.elts:
            if isinstance(elt, ast.Starred):
                statuses.append("unclear")
            else:
                statuses.append(_eval(elt, ctx, depth, pos, "update"))
        if any(status == "ok" for status in statuses):
            return "ok"
        if any(status == "unclear" for status in statuses):
            return "unclear"
        return "missing"
    if mode == "pipeline":
        if not node.elts:
            return "missing"
        first = node.elts[0]
        if isinstance(first, ast.Starred):
            return "unclear"
        return _eval(first, ctx, depth, pos, "pipeline")
    return "unclear"


def _proven(node):
    last_spread = -1
    for index, key in enumerate(node.keys):
        if key is None:
            last_spread = index
    proven = {}
    opaque = last_spread >= 0
    for index, key in enumerate(node.keys):
        if key is None:
            continue
        name = _const_str(key)
        if name is None:
            opaque = True
            continue
        if index > last_spread:
            proven[name] = node.values[index]
        else:
            opaque = True
    return proven, opaque


def _dollar_keys(node):
    proven, _opaque = _proven(node)
    return any(key.startswith("$") for key in proven)


def _const_str(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None
