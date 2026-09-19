import { can, hasSelfPersonnelRecord, isMoreLinkVisible, moduleOn, showFinanceSubstituteTabs, showSelfPersonnelTabs, visibleModules } from "./permissions";

describe("permissions", () => {
  it("admins see everything", () => {
    const user = { role: "admin", permissions: { "/saha": "none" } };
    expect(can(user, "/saha", "edit")).toBe(true);
    expect(visibleModules(user, null).some((m) => m.key === "saha")).toBe(true);
  });

  it("honors none vs edit", () => {
    const user = { role: "sales", permissions: { "/saha": "edit", "/invoices": "view", "/stock": "none" } };
    expect(can(user, "/saha", "edit")).toBe(true);
    expect(can(user, "/invoices", "edit")).toBe(false);
    expect(can(user, "/invoices", "view")).toBe(true);
    expect(can(user, "/stock")).toBe(false);
    expect(visibleModules(user, null).map((m) => m.key)).not.toContain("stock");
  });

  it("hides license-disabled modules", () => {
    const user = { role: "admin" };
    expect(moduleOn({ modules: { "/saha": false } }, "/saha")).toBe(false);
    expect(visibleModules(user, { modules: { "/saha": false } }).map((m) => m.key)).not.toContain("saha");
  });

  it("aliases Personelim to the Mesaim license/role key", () => {
    expect(moduleOn({ modules: { "/mesai": false } }, "/personelim")).toBe(false);
    expect(can({ role: "sales", permissions: { "/mesai": "none" } }, "/personelim")).toBe(false);
    expect(visibleModules({ role: "admin" }, null).some((m) => m.key === "personelim")).toBe(true);
    expect(visibleModules({ role: "admin" }, { modules: { "/mesai": false } }).map((m) => m.key)).not.toContain("personelim");
  });

  it("includes finance and sales modules", () => {
    const keys = visibleModules({ role: "admin" }, null).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["banking", "expenses", "quotes", "surveys", "projects", "personnel"]));
  });

  it("hides Personel & Bordro when the role has no personnel permission", () => {
    const warehouse = { role: "warehouse", permissions: { "/mesai": "view", "/personnel": "none" } };
    const production = { role: "production", permissions: { "/mesai": "view", "/production": "edit" } };
    const advisor = { role: "advisor", permissions: { "/personnel": "view", "/mesai": "view" } };
    const mesaiOnly = { modules: { "/personnel": false, "/mesai": true } };
    expect(isMoreLinkVisible({ path: "/personnel" }, warehouse, null)).toBe(false);
    expect(isMoreLinkVisible({ path: "/personnel" }, production, { modules: { "/mesai": true } })).toBe(false);
    expect(can(production, "/personnel")).toBe(false);
    expect(visibleModules(production, null).map((m) => m.key)).not.toContain("personnel");
    expect(isMoreLinkVisible({ path: "/personnel" }, advisor, null)).toBe(true);
    expect(isMoreLinkVisible({ path: "/personnel" }, { role: "admin" }, mesaiOnly)).toBe(false);
    expect(isMoreLinkVisible({ path: "/personnel" }, { role: "admin" }, { modules: { "/personnel": true } })).toBe(true);
    expect(isMoreLinkVisible({ path: "/settings" }, { role: "sales", permissions: { "/settings": "none" } }, null)).toBe(true);
  });

  it("swaps Mesaim/Benim Sayfam for Kasa/Cariler when there is no employee record", () => {
    const owner = { role: "admin" };
    const staff = { role: "sales", employee_id: "emp_1", permissions: { "/mesai": "view", "/contacts": "edit", "/banking": "view" } };
    expect(hasSelfPersonnelRecord(owner)).toBe(false);
    expect(showFinanceSubstituteTabs(owner)).toBe(true);
    expect(showSelfPersonnelTabs(owner, null)).toBe(false);
    expect(isMoreLinkVisible({ path: "/personelim" }, owner, null)).toBe(false);
    expect(isMoreLinkVisible({ path: "/banking" }, owner, null)).toBe(false);
    expect(isMoreLinkVisible({ path: "/contacts" }, owner, null)).toBe(false);

    expect(hasSelfPersonnelRecord(staff)).toBe(true);
    expect(showSelfPersonnelTabs(staff, null)).toBe(true);
    expect(showFinanceSubstituteTabs(staff)).toBe(false);
    expect(isMoreLinkVisible({ path: "/personelim" }, staff, null)).toBe(true);
    expect(isMoreLinkVisible({ path: "/banking" }, staff, null)).toBe(true);
    expect(isMoreLinkVisible({ path: "/contacts" }, staff, null)).toBe(true);
  });
});
