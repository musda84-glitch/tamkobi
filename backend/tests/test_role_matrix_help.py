"""Role matrix: module help + level meta for Users & Roles UI."""


def test_module_help_covers_all_modules():
    import rbac

    keys = [k for k, _ in rbac.MODULES]
    assert keys
    for k in keys:
        assert k in rbac.MODULE_HELP, f"missing MODULE_HELP for {k}"
        assert len(rbac.MODULE_HELP[k]) >= 12, k
    # Web/mobil self-service Benim Sayfam yetkisi Mesaim üzerinden
    assert "personelim" in rbac.MODULE_HELP["/mesai"].lower() or "Benim Sayfam" in rbac.MODULE_HELP["/mesai"]


def test_features_have_help():
    import rbac

    for key, label, help_text in rbac.FEATURES:
        assert key and label
        assert len(help_text) >= 8, key


def test_level_meta():
    import rbac

    keys = [x["key"] for x in rbac.LEVEL_META]
    assert keys == list(rbac.LEVELS)
    assert all(x.get("help") for x in rbac.LEVEL_META)


def test_default_roles_cover_new_modules():
    import rbac

    sales = next(r for r in rbac.DEFAULT_ROLES if r["code"] == "sales")
    assert sales["permissions"].get("/saha") == "edit"
    assert sales["permissions"].get("/support") == "edit"
    assert sales["permissions"].get("/cheques") == "view"
    assert sales["permissions"].get("/banking") == "view"
    wh = next(r for r in rbac.DEFAULT_ROLES if r["code"] == "warehouse")
    assert wh["permissions"].get("/sevk") == "edit"
    assert wh["permissions"].get("/sayim") == "edit"
    assert wh["permissions"].get("/purchase-orders") == "edit"
    prod = next(r for r in rbac.DEFAULT_ROLES if r["code"] == "production")
    assert prod["permissions"].get("/atolye") == "edit"
