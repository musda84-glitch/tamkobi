"""Kayıtlı GET /api rotaları görüntü kararında sınıflı olmalı. Ölü allowlist satırı kalmaz."""
import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-rbac-get-routes-covered-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

from fastapi.routing import APIRoute  # noqa: E402

import rbac  # noqa: E402

# server importu lisans korumasını rbac'a bağlar. Bu dosya yalnız rota
# tablosunu okur; sonraki testlerin gördüğü koruma aynı kalsın.
_LICENSE_GUARD = rbac._license_guard
import server  # noqa: E402

rbac.set_license_guard(_LICENSE_GUARD)


def _walk_get_paths(routes, found):
    for route in routes:
        if isinstance(route, APIRoute):
            methods = {str(method).upper() for method in (route.methods or ())}
            if "GET" in methods and route.path:
                found.append(route.path)
        children = getattr(route, "routes", None)
        if children:
            _walk_get_paths(children, found)


def _get_paths():
    found = []
    _walk_get_paths(server.app.routes, found)
    return found


def test_every_get_api_route_is_classified():
    api_paths = sorted({path for path in _get_paths() if path.startswith("/api")})
    assert api_paths, "GET /api rotası bulunamadı"
    uncovered = [path for path in api_paths if rbac.get_view_route_bucket(path) is None]
    assert not uncovered, "GET rotaları görüntü kararında kapsanmıyor:\n" + "\n".join(uncovered)


def test_shared_allowlist_templates_still_exist():
    paths = _get_paths()
    dead = []
    for _method, template in rbac.READ_SHARED_GET_ALLOWLIST:
        if not any(rbac.allowlist_template_matches(template, path) for path in paths):
            dead.append(template)
    assert not dead, "Allowlist şablonu artık bir GET rotasına denk gelmiyor:\n" + "\n".join(dead)


def test_cross_module_templates_still_exist():
    paths = [path for path in _get_paths() if path.startswith("/api")]
    dead = []
    for _method, template, _modules, _features, _personel_only in rbac.CROSS_MODULE_VIEW:
        if not any(rbac._portal_template_match(template, rbac._portal_norm_path(path)) for path in paths):
            dead.append(template)
    assert not dead, "Çapraz görüntü şablonu artık bir GET rotasına denk gelmiyor:\n" + "\n".join(dead)
