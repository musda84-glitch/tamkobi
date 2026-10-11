"""Path-id tenant rotalarında şirket kontrolü (get_tenant_doc veya eşdeğeri) zorunlu."""
from __future__ import annotations

import ast
import re
from pathlib import Path

import tenant_idor_allowlist as allowlist

ROOT = Path(__file__).resolve().parents[1]
PATH_ID = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

GUARD_NAMES = {
    "get_tenant_doc",
    "assert_doc_company",
    "get_tenant_child",
    "assert_same_company",
    "user_may_access_company",
    "users_share_company",
    "require_inbox_company",
    "resolve_company_id",
    "_require_company_member",
    "_require_company_access",
    "_require_member",
    "require_company_admin",
}

CORE_OR_HELPER = {"_wo"}


def _norm_path(p: str) -> str:
    p = p if p.startswith("/") else f"/{p}"
    if p.startswith("/api/"):
        p = p[4:]
    return p


def _route_meta(deco_src: str):
    m = re.search(r'\.(get|post|put|patch|delete)\(\s*["\']([^"\']+)', deco_src)
    if not m:
        return None
    return m.group(1).upper(), _norm_path(m.group(2))


def _has_tenant_guard(fn: ast.AST) -> bool:
    for n in ast.walk(fn):
        if isinstance(n, ast.Name) and n.id in GUARD_NAMES:
            return True
        if isinstance(n, ast.Attribute) and n.attr in GUARD_NAMES:
            return True
    for n in ast.walk(fn):
        if isinstance(n, ast.Await) and isinstance(n.value, ast.Call):
            f = n.value.func
            if isinstance(f, ast.Name) and (f.id.endswith("_core") or f.id in CORE_OR_HELPER):
                return True
            if isinstance(f, ast.Attribute) and (f.attr.endswith("_core") or f.attr in GUARD_NAMES | CORE_OR_HELPER):
                return True
    return False


def _auto_skip(path: str) -> bool:
    if path.startswith("/public/") or path.startswith("/system/"):
        return True
    if "webhook" in path:
        return True
    if path.endswith("/pdf") or path.endswith("/xml") or "share-link" in path:
        return True
    return False


def _path_ids(path: str) -> list[str]:
    """Tüm path parametreleri (company_id dahil) — middleware-only uçlar allowlist'te."""
    return PATH_ID.findall(path)


def test_path_id_routes_have_tenant_guard_or_allowlist():
    # normalize allowlist paths
    allow = {(m, _norm_path(p)) for m, p in allowlist.TENANT_IDOR_ALLOWLIST}

    offenders = []
    scanned = 0
    for path in ROOT.rglob("*.py"):
        if "tests" in path.parts or path.name.startswith("test_"):
            continue
        try:
            src = path.read_text(encoding="utf-8")
            tree = ast.parse(src)
        except (OSError, SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            route = None
            for d in node.decorator_list:
                route = _route_meta(ast.get_source_segment(src, d) or "")
                if route:
                    break
            if not route:
                continue
            method, rpath = route
            if not _path_ids(rpath):
                continue
            if _auto_skip(rpath):
                continue
            scanned += 1
            if (method, rpath) in allow:
                continue
            if _has_tenant_guard(node):
                continue
            offenders.append(f"{path.relative_to(ROOT)}:{node.lineno} {method} {rpath} ({node.name})")

    assert scanned > 50, f"Tarama çok az rota buldu ({scanned}) — test bozulmuş olabilir"
    assert not offenders, (
        "Path-id tenant rotasında şirket kontrolü yok (get_tenant_doc / _require_company_member / …).\n"
        "Kasıtlı muafiyet için tenant_idor_allowlist.py güncelleyin.\n"
        + "\n".join(offenders[:80])
        + (f"\n… +{len(offenders) - 80} daha" if len(offenders) > 80 else "")
    )
