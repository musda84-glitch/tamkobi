"""Personel portalı saha özellikleri: varsayılan kapalı, 403, şirket izolasyonu, denetim özeti."""
import asyncio
import copy

import company_audit
import rbac


def _personel(company_id="co_a"):
    return {
        "id": "usr_p",
        "role": "personel",
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


def _role(company_id, code="personel", features=None, permissions=None):
    return {
        "_id": f"role_{company_id}_{code}",
        "company_id": company_id,
        "code": code,
        "name": "Personel" if code == "personel" else code,
        "is_system": code in {r["code"] for r in rbac.DEFAULT_ROLES},
        "permissions": permissions or {"/atolye": "edit", "/sevk": "none", "/sayim": "none", "/saha": "view"},
        "features": features or {},
    }


def test_portal_features_default_off_except_admin():
    keys = rbac.PORTAL_FEATURE_KEYS
    assert {"portal_atolye", "portal_pick", "portal_sayim", "portal_saha", "portal_vehicles"} <= keys
    for code in ("personel", "manager", "warehouse", "production", "sales"):
        feats = rbac.role_features({"code": code, "features": {}})
        for key in keys:
            assert feats[key] is False, (code, key)
    admin = rbac.role_features({"code": "admin", "features": {}})
    assert all(admin[k] for k in keys)
    granted = rbac.role_features({"code": "personel", "features": {"portal_sayim": True}})
    assert granted["portal_sayim"] is True
    assert granted["portal_atolye"] is False


def test_personel_without_feature_is_denied_even_with_module_edit():
    user = _personel()
    role = _role("co_a", features={})
    path = "/api/production/work-orders"
    assert rbac.portal_field_allowed(user, role, "portal_atolye", "/atolye", path, "GET") is False
    assert rbac.portal_field_allowed(user, role, "portal_atolye", "/atolye", path, "POST") is False
    sayim = "/api/warehouses/stock-counts"
    assert rbac.portal_field_allowed(user, role, "portal_sayim", "/sayim", sayim, "GET") is False
    picks = "/api/order-picks/ord_1/scan"
    assert rbac.portal_field_allowed(user, role, "portal_pick", "/sevk", picks, "POST") is False


def test_personel_with_feature_can_access_even_if_module_is_none():
    user = _personel()
    role = _role("co_a", features={"portal_sayim": True, "portal_pick": True}, permissions={"/sayim": "none", "/sevk": "none"})
    assert rbac.portal_field_allowed(user, role, "portal_sayim", "/sayim", "/api/warehouses/stock-counts", "POST") is True
    assert rbac.portal_feature_grant(user, role, "portal_sayim", "/api/warehouses/stock-counts", "POST") is True
    assert rbac.portal_field_allowed(user, role, "portal_pick", "/sevk", "/api/order-picks", "GET") is True
    assert rbac.portal_field_allowed(user, role, "portal_atolye", "/atolye", "/api/production/work-orders", "GET") is False


def test_other_roles_keep_module_access_when_portal_flag_is_off():
    user = {"id": "usr_w", "role": "warehouse", "company_ids": ["co_a"], "active_company_id": "co_a"}
    role = {
        "code": "warehouse",
        "features": {},
        "permissions": rbac.backfill_permissions({"/sayim": "edit", "/sevk": "edit", "/vehicles": "edit", "/atolye": "view"}),
    }
    assert rbac.portal_field_allowed(user, role, "portal_sayim", "/sayim", "/api/warehouses/stock-counts", "POST") is True
    assert rbac.portal_feature_grant(user, role, "portal_sayim", "/api/warehouses/stock-counts", "POST") is False
    sales = {"id": "usr_s", "role": "sales", "company_ids": ["co_a"], "active_company_id": "co_a"}
    sales_role = {"code": "sales", "features": {}, "permissions": rbac.backfill_permissions({"/sayim": "none"})}
    assert rbac.portal_field_allowed(sales, sales_role, "portal_sayim", "/sayim", "/api/warehouses/stock-counts", "GET") is True
    assert rbac.portal_field_allowed(sales, sales_role, "portal_sayim", "/sayim", "/api/warehouses/stock-counts", "POST") is False


def test_other_company_role_does_not_grant(monkeypatch):
    class Col:
        def __init__(self):
            self.docs = []

        async def find_one(self, query):
            for doc in self.docs:
                if all(doc.get(k) == v for k, v in (query or {}).items()):
                    return copy.deepcopy(doc)
            return None

    class DB:
        def __init__(self):
            self.roles = Col()

    db = DB()
    db.roles.docs.append(_role("co_a", features={"portal_atolye": False}))
    db.roles.docs.append(_role("co_b", features={"portal_atolye": True}))

    async def _noop(_cid):
        return None

    monkeypatch.setattr(rbac, "_db", db)
    monkeypatch.setattr(rbac, "ensure_roles", _noop)

    async def _run():
        user = _personel("co_a")
        role_a = await rbac.role_for(user, "co_a")
        role_b = await rbac.role_for(user, "co_b")
        path = "/api/production/work-orders"
        assert rbac.role_features(role_a)["portal_atolye"] is False
        assert rbac.role_features(role_b)["portal_atolye"] is True
        assert rbac.portal_field_allowed(user, role_a, "portal_atolye", "/atolye", path, "GET") is False
        # Aynı kullanıcı kodu, başka şirketin rol belgesi A'yı açmaz.
        assert role_a["company_id"] == "co_a"
        assert role_b["company_id"] == "co_b"
        role_a["features"] = {"portal_atolye": True}
        assert rbac.portal_field_allowed(user, role_a, "portal_atolye", "/atolye", path, "GET") is True

    asyncio.run(_run())


def test_feature_change_is_audited():
    before = {"code": "personel", "name": "Personel", "features": {}}
    after = {"code": "personel", "name": "Personel", "features": {"portal_atolye": True, "portal_pick": False}}
    summary = company_audit.diff_summary(before, after)
    assert "Atölye" in summary
    assert "açıldı" in summary
    closed = company_audit.diff_summary(
        {"code": "personel", "features": {"portal_sayim": True}},
        {"code": "personel", "features": {"portal_sayim": False}},
    )
    assert "Stok Sayımı" in closed
    assert "kapatıldı" in closed


def test_portal_rule_matches_field_ops_only():
    assert rbac.portal_rule_for_path("/api/production/work-orders/stations", "GET")[1] == "portal_atolye"
    assert rbac.portal_rule_for_path("/api/production/work-orders/performance", "GET")[1] == "portal_atolye"
    assert rbac.portal_rule_for_path("/api/production/work-orders/shopfloor-settings", "GET")[1] == "portal_atolye"
    assert rbac.portal_rule_for_path("/api/order-picks/o1/scan", "POST")[1] == "portal_pick"
    assert rbac.portal_rule_for_path("/api/warehouses/stock-counts/c1", "GET")[1] == "portal_sayim"
    assert rbac.portal_rule_for_path("/api/vehicles/v1", "GET")[1] == "portal_vehicles"
    assert rbac.portal_rule_for_path("/api/vehicles/v1", "DELETE") is None
    assert rbac.portal_rule_for_path("/api/production/work-orders/shopfloor-settings", "POST") is None
    assert rbac.portal_rule_for_path("/api/production/work-orders/shopfloor-settings", "PUT") is None
    assert rbac.portal_rule_for_path("/api/production/work-orders/performance", "POST") is None
    assert rbac.portal_rule_for_path("/api/warehouses") is None
    assert rbac.portal_rule_for_path("/api/production/recipes") is None
    assert rbac.portal_rule_for_path("/api/orders") is None


def _status(user, role, path, method):
    """Middleware kararı: özellik listesi veya mutation_allowed. 403 yönetici işlemi."""
    area = rbac.portal_area_for_path(path)
    assert area, path
    _prefix, feat, mod = area
    if not rbac.portal_field_allowed(user, role, feat, mod, path, method):
        return 403
    if method in ("GET", "HEAD"):
        return 200
    if rbac.portal_feature_grant(user, role, feat, path, method):
        return 200
    perms = (role or {}).get("permissions") or {}
    if rbac.mutation_allowed(mod, path, perms, method):
        return 200
    return 403


# Personel + özellik açıkken bile yönetici işlemi 403. Modül delete olsa da.
_ADMIN_OPS = (
    ("POST", "/api/vehicles"),
    ("PUT", "/api/vehicles/veh_1"),
    ("DELETE", "/api/vehicles/veh_1"),
    ("DELETE", "/api/warehouses/stock-counts/cnt_1"),
    ("PUT", "/api/production/work-orders/shopfloor-settings"),
    ("POST", "/api/production/work-orders/shopfloor-settings"),
    ("POST", "/api/production/work-orders/trash-completed"),
    ("POST", "/api/production/work-orders/wo_1/admin-trash"),
    ("POST", "/api/production/work-orders/trash-requests/req_1/decide"),
)

_FIELD_OPS = (
    ("POST", "/api/production/work-orders/shopfloor-unlock"),
    ("PUT", "/api/production/work-orders/wo_1/assign"),
    ("POST", "/api/production/work-orders/wo_1/start"),
    ("POST", "/api/production/work-orders/wo_1/pause"),
    ("POST", "/api/production/work-orders/wo_1/finish"),
    ("POST", "/api/production/work-orders/wo_1/trash-request"),
    ("POST", "/api/order-picks/ord_1/scan"),
    ("POST", "/api/order-picks/ord_1/adjust"),
    ("POST", "/api/order-picks/ord_1/notify-missing"),
    ("POST", "/api/order-picks/ord_1/complete"),
    ("POST", "/api/warehouses/stock-counts"),
    ("POST", "/api/warehouses/stock-counts/cnt_1/scan"),
    ("PUT", "/api/warehouses/stock-counts/cnt_1/items"),
    ("POST", "/api/warehouses/stock-counts/cnt_1/complete"),
    ("GET", "/api/vehicles"),
    ("GET", "/api/vehicles/veh_1"),
    ("GET", "/api/production/work-orders/performance"),
    ("GET", "/api/production/work-orders/shopfloor-settings"),
)


def test_personel_feature_on_admin_ops_are_403():
    user = _personel()
    role = _role(
        "co_a",
        features={k: True for k in rbac.PORTAL_FEATURE_KEYS},
        permissions={
            "/atolye": "delete",
            "/sevk": "delete",
            "/sayim": "delete",
            "/vehicles": "delete",
            "/saha": "view",
        },
    )
    for method, path in _ADMIN_OPS:
        assert _status(user, role, path, method) == 403, (method, path)
        assert rbac.portal_feature_grant(user, role, rbac.portal_area_for_path(path)[1], path, method) is False


def test_personel_feature_on_field_ops_stay_open():
    user = _personel()
    role = _role(
        "co_a",
        features={k: True for k in rbac.PORTAL_FEATURE_KEYS},
        permissions={"/atolye": "none", "/sevk": "none", "/sayim": "none", "/vehicles": "none"},
    )
    for method, path in _FIELD_OPS:
        assert _status(user, role, path, method) == 200, (method, path)


def test_other_roles_admin_ops_stay_on_module_matrix():
    user = {"id": "usr_w", "role": "warehouse", "company_ids": ["co_a"], "active_company_id": "co_a"}
    role = {
        "code": "warehouse",
        "features": {k: True for k in rbac.PORTAL_FEATURE_KEYS},
        "permissions": rbac.backfill_permissions({
            "/sayim": "delete", "/sevk": "edit", "/vehicles": "edit", "/atolye": "edit",
        }),
    }
    assert _status(user, role, "/api/vehicles", "POST") == 200
    assert _status(user, role, "/api/vehicles/veh_1", "DELETE") == 403
    assert _status(user, role, "/api/warehouses/stock-counts/cnt_1", "DELETE") == 200
    assert _status(user, role, "/api/production/work-orders/shopfloor-settings", "POST") == 200
    assert _status(user, role, "/api/production/work-orders/trash-completed", "POST") == 200
    assert rbac.portal_feature_grant(user, role, "portal_vehicles", "/api/vehicles", "POST") is False
    assert rbac.portal_feature_grant(user, role, "portal_atolye", "/api/production/work-orders/wo_1/admin-trash", "POST") is False
