"""
Union merge artığı bırakmayan kod koruması.

Bu deponun PR'ları bir dönem çakışan satırların iki tarafını da saklayan bir
birleştirmeyle kapatıldı. Sonuç sözdizimi olarak geçerli olduğu için sessizce
canlıya çıktı: aynı fonksiyon iki kez tanımlandı ve ikincisi birincisini ezdi,
aynı sözlük anahtarı iki kez yazıldı, `return`'den sonra ikinci bir `return`
ulaşılmaz kaldı. Yani birleştirilmiş bir PR'ın etkisi kayboldu.

Buradaki testler o kalıpları yakalar; hepsi tek başına "bu kod ölü" demektir.
"""
import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
SKIP_DIRS = {"tests", "__pycache__", "venv", ".venv", "node_modules"}


def _sources():
    for p in sorted(BACKEND.rglob("*.py")):
        if SKIP_DIRS.isdisjoint(p.relative_to(BACKEND).parts):
            yield p


def _tree(path):
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _rel(path):
    return str(path.relative_to(BACKEND))


def _intentional_override(path, node) -> bool:
    """Bilerek yapılan yeniden tanım `# noqa: F811` ile işaretlenir."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return "noqa: F811" in lines[node.lineno - 1]


@pytest.mark.parametrize("path", list(_sources()), ids=_rel)
def test_no_duplicate_definitions_in_the_same_block(path):
    """Aynı blokta iki kez tanımlanan isimde ikincisi birincisini sessizce ezer."""
    dupes = []
    for parent in [_tree(path)] + [n for n in ast.walk(_tree(path)) if isinstance(n, ast.ClassDef)]:
        seen = {}
        for node in parent.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if any(getattr(d, "id", getattr(d, "attr", "")) == "overload" for d in node.decorator_list):
                continue
            if node.name in seen and not _intentional_override(path, node):
                dupes.append(f"{node.name} — satır {seen[node.name]} ve {node.lineno}")
            seen[node.name] = node.lineno
    assert not dupes, f"{_rel(path)}: aynı isim birden çok kez tanımlanmış: " + "; ".join(dupes)


@pytest.mark.parametrize("path", list(_sources()), ids=_rel)
def test_no_duplicate_keys_in_a_dict_literal(path):
    """Bir sözlükte tekrar eden anahtarda son değer kazanır; öncekiler kaybolur."""
    dupes = []
    for node in ast.walk(_tree(path)):
        if not isinstance(node, ast.Dict):
            continue
        seen = {}
        for k in node.keys:
            if not isinstance(k, ast.Constant) or not isinstance(k.value, str):
                continue
            if k.value in seen:
                dupes.append(f'"{k.value}" — satır {seen[k.value]} ve {k.lineno}')
            seen[k.value] = k.lineno
    assert not dupes, f"{_rel(path)}: sözlükte tekrar eden anahtar: " + "; ".join(dupes)


@pytest.mark.parametrize("path", list(_sources()), ids=_rel)
def test_no_statements_after_a_return(path):
    """`return`'den sonra gelen satır çalışmaz."""
    dead = []
    for node in ast.walk(_tree(path)):
        for field in ("body", "orelse", "finalbody"):
            block = getattr(node, field, None)
            if not isinstance(block, list):
                continue
            for i, stmt in enumerate(block[:-1]):
                if isinstance(stmt, (ast.Return, ast.Raise, ast.Continue, ast.Break)):
                    dead.append(f"satır {block[i + 1].lineno} ({type(stmt).__name__.lower()} sonrası)")
    assert not dead, f"{_rel(path)}: ulaşılmaz kod: " + "; ".join(dead)


def test_each_router_is_registered_once():
    """İki kez eklenen router aynı yolları iki kez kaydeder."""
    import server

    seen, dupes = set(), []
    for route in server.app.routes:
        key = (getattr(route, "path", None), tuple(sorted(getattr(route, "methods", None) or ())))
        if key in seen:
            dupes.append(f"{key[1]} {key[0]}")
        seen.add(key)
    assert not dupes, "aynı yol birden çok kez kaydedilmiş: " + "; ".join(sorted(dupes))
