"""Kod içi çağrılar Depends nesnesi değil core fonksiyonlarını kullanmalı."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _call_names(tree: ast.AST):
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Await) and isinstance(node.value, ast.Call):
            fn = node.value.func
            if isinstance(fn, ast.Name):
                out.append(fn.id)
            elif isinstance(fn, ast.Attribute):
                out.append(fn.attr)
    return out


def test_no_direct_await_of_route_wrappers():
    """create_invoice / create_quote / pay_expense / unpay_expense route'ları
    doğrudan await edilmemeli — core kullanılmalı."""
    banned = {"create_invoice", "create_quote", "pay_expense", "unpay_expense"}
    offenders = []
    for path in ROOT.rglob("*.py"):
        if "tests" in path.parts or path.name.startswith("test_"):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for name in _call_names(tree):
            if name in banned:
                offenders.append(f"{path.relative_to(ROOT)}: await {name}(...)")
    assert not offenders, "Route Depends kırılımı riski:\n" + "\n".join(offenders)


def test_core_helpers_exist():
    import expenses
    import server

    assert callable(getattr(server, "_create_invoice_core", None))
    assert callable(getattr(server, "_create_quote_core", None))
    assert callable(getattr(expenses, "_pay_expense_core", None))
    assert callable(getattr(expenses, "_unpay_expense_core", None))
