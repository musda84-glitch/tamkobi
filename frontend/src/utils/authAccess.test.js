import {
  authPermPath,
  canAccessPath,
  erpShellReady,
  isAddonEnabled,
  isFeatureEnabled,
  isModuleEnabled,
} from "./authAccess";

describe("authAccess fail-closed", () => {
  test("canAccessPath denies when user is missing (loading / logged out)", () => {
    expect(canAccessPath(null, "/orders")).toBe(false);
    expect(canAccessPath(undefined, "/invoices", "edit")).toBe(false);
  });

  test("canAccessPath allows admin even without permissions map", () => {
    expect(canAccessPath({ role: "admin" }, "/settings", "delete")).toBe(true);
  });

  test("canAccessPath respects none / edit / delete levels", () => {
    const user = {
      role: "sales",
      permissions: { "/orders": "edit", "/invoices": "none", "/contacts": "delete" },
    };
    expect(canAccessPath(user, "/orders")).toBe(true);
    expect(canAccessPath(user, "/orders", "edit")).toBe(true);
    expect(canAccessPath(user, "/orders", "delete")).toBe(false);
    expect(canAccessPath(user, "/invoices")).toBe(false);
    expect(canAccessPath(user, "/contacts", "delete")).toBe(true);
  });

  test("canAccessPath denies non-admin without permissions object", () => {
    expect(canAccessPath({ role: "sales" }, "/orders")).toBe(false);
  });

  test("authPermPath aliases panel and personelim", () => {
    expect(authPermPath("/panel")).toBe("/");
    expect(authPermPath("/personelim")).toBe("/mesai");
    expect(authPermPath("/mesajlar")).toBe("/");
    expect(authPermPath("/orders")).toBe("/orders");
  });

  test("portal field features are off until granted, including for personel with module edit", () => {
    const personel = { role: "personel", permissions: { "/atolye": "edit", "/sayim": "none", "/sevk": "none" }, features: {} };
    expect(canAccessPath(personel, "/atolye")).toBe(false);
    expect(canAccessPath(personel, "/sayim")).toBe(false);
    expect(canAccessPath(personel, "/sevk", "edit")).toBe(false);
    expect(canAccessPath({ ...personel, features: { portal_atolye: true, portal_sayim: true } }, "/atolye", "edit")).toBe(true);
    expect(canAccessPath({ ...personel, features: { portal_sayim: true } }, "/sayim")).toBe(true);
    const warehouse = { role: "warehouse", permissions: { "/sayim": "edit" }, features: {} };
    expect(canAccessPath(warehouse, "/sayim", "edit")).toBe(true);
    const ordersOff = { role: "personel", permissions: { "/orders": "edit" }, features: {} };
    expect(canAccessPath(ordersOff, "/orders")).toBe(false);
    expect(canAccessPath(ordersOff, "/orders", "edit")).toBe(false);
    const ordersOn = { ...ordersOff, features: { portal_orders: true } };
    expect(canAccessPath(ordersOn, "/orders")).toBe(true);
    expect(canAccessPath(ordersOn, "/orders", "edit")).toBe(false);
    expect(canAccessPath(ordersOn, "/orders", "delete")).toBe(false);
    expect(isFeatureEnabled(personel, "portal_pick")).toBe(false);
    expect(isFeatureEnabled({ role: "admin" }, "portal_atolye")).toBe(true);
  });

  test("feature / module / addon fail closed without user", () => {
    expect(isFeatureEnabled(null, "header_invoice")).toBe(false);
    expect(isFeatureEnabled({ role: "personel", features: { account_companies: false } }, "account_companies")).toBe(false);
    expect(isFeatureEnabled({ role: "personel", features: { export_personal_data: true } }, "export_personal_data")).toBe(true);
    expect(isModuleEnabled(null, { modules: { "/orders": true } }, "/orders")).toBe(false);
    expect(isAddonEnabled(null, { addons: { "ai.advisor": true } }, "ai.advisor")).toBe(false);
  });

  test("module/addon stay open when matrix missing after login", () => {
    const user = { role: "sales", permissions: { "/orders": "view" } };
    expect(isModuleEnabled(user, null, "/orders")).toBe(true);
    expect(isModuleEnabled(user, {}, "/orders")).toBe(true);
    expect(isAddonEnabled(user, null, "ai.advisor")).toBe(true);
    expect(isModuleEnabled(user, { modules: { "/orders": false } }, "/orders")).toBe(false);
  });

  test("erpShellReady waits for auth and mesaim when employee linked", () => {
    expect(erpShellReady({ loading: true, authenticated: false, user: null })).toBe(false);
    expect(erpShellReady({ loading: false, authenticated: false, user: null })).toBe(false);
    expect(erpShellReady({ loading: false, authenticated: true, user: { role: "admin" } })).toBe(true);
    expect(erpShellReady({
      loading: false,
      authenticated: true,
      user: { role: "personel", employee_id: "e1" },
      mesaimReady: false,
    })).toBe(false);
    expect(erpShellReady({
      loading: false,
      authenticated: true,
      user: { role: "personel", employee_id: "e1" },
      mesaimReady: true,
    })).toBe(true);
  });
});
