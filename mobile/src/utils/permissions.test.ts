import { can, moduleOn, visibleModules } from "./permissions";

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
});
