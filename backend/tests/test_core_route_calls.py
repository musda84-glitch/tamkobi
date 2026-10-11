"""Depends parametreli route fonksiyonları kod içinden doğrudan await edilmemeli."""
from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _is_depends_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    fn = node.func
    if isinstance(fn, ast.Name) and fn.id == "Depends":
        return True
    if isinstance(fn, ast.Attribute) and fn.attr == "Depends":
        return True
    return False


def _defaults_include_depends(args: ast.arguments) -> bool:
    for d in list(args.defaults) + list(args.kw_defaults):
        if d is not None and _is_depends_call(d):
            return True
    return False


def _depends_by_module(tree: ast.AST) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            if _defaults_include_depends(node.args):
                names.add(node.name)
    return names


def _await_targets(tree: ast.AST):
    """(kind, name, module_or_None) — kind: 'name' | 'modattr'."""
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Await) and isinstance(node.value, ast.Call)):
            continue
        fn = node.value.func
        if isinstance(fn, ast.Name):
            yield "name", fn.id, None
        elif isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
            # self.x / client.x gibi örnek metotları atla; yalnızca modül.attr
            if fn.value.id == "self":
                continue
            yield "modattr", fn.attr, fn.value.id


def test_no_direct_await_of_depends_routes():
    """Depends(...) parametreli route: bare await name(...) veya await mod.name(...).

    Örnek metot çağrıları (self.list_companies, client.update_order) hariç.
    """
    depends_names: set[str] = set()
    depends_in_module: dict[str, set[str]] = {}
    py_files = []
    for path in ROOT.rglob("*.py"):
        if "tests" in path.parts or path.name.startswith("test_"):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, SyntaxError, UnicodeDecodeError):
            continue
        py_files.append((path, tree))
        names = _depends_by_module(tree)
        if names:
            depends_names |= names
            depends_in_module[path.stem] = names

    assert depends_names, "Depends'li route bulunamadı — tarama bozuk olabilir"

    offenders = []
    for path, tree in py_files:
        for kind, name, mod in _await_targets(tree):
            if kind == "name" and name in depends_names:
                offenders.append(f"{path.relative_to(ROOT)}: await {name}(...)")
            elif kind == "modattr" and mod in depends_in_module and name in depends_in_module[mod]:
                offenders.append(f"{path.relative_to(ROOT)}: await {mod}.{name}(...)")

    assert not offenders, (
        "Depends'li route doğrudan await ediliyor (core kullanın):\n" + "\n".join(sorted(set(offenders)))
    )


def test_known_cores_exist():
    import cheques
    import expenses
    import server
    import tax_obligations

    for mod, names in (
        (server, (
            "_create_invoice_core", "_create_quote_core", "_create_project_core",
            "_record_invoice_payment_core", "_create_match_rule_core",
            "_delete_order_core", "_sync_bank_connection_core",
            "_pay_payroll_core", "_update_bonus_core", "_sync_ecommerce_channel_core",
            "_complete_production_order_core", "_create_expense_slip_from_invoice_core",
        )),
        (expenses, ("_pay_expense_core", "_unpay_expense_core")),
        (cheques, ("_cancel_cheque_core",)),
        (tax_obligations, ("_import_tax_doc_core",)),
    ):
        for n in names:
            assert callable(getattr(mod, n, None)), f"{mod.__name__}.{n} yok"
    import edocs
    assert callable(getattr(edocs, "_set_lines_core", None)), "edocs._set_lines_core yok"
