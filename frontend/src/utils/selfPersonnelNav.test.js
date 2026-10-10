import {
  hasSelfPersonnelRecord,
  isPersonelRole,
  isSelfPersonnelPath,
  personelAccountTabs,
  personelCanManageCompany,
  personelCanUseErpShortcuts,
  personelMenuPathAllowed,
  selfPersonnelNavAllowed,
  showHomeFinanceSummary,
  showProductionAiAdvisor,
} from "./selfPersonnelNav";

describe("selfPersonnelNav", () => {
  test("only Benim Sayfam and Mesaim are self-personnel paths", () => {
    expect(isSelfPersonnelPath("/personelim")).toBe(true);
    expect(isSelfPersonnelPath("/mesai")).toBe(true);
    expect(isSelfPersonnelPath("/personnel")).toBe(false);
    expect(isSelfPersonnelPath("/panel")).toBe(false);
  });

  test("hides self items when the user has no employee card", () => {
    const owner = { role: "admin", name: "Sarp" };
    expect(hasSelfPersonnelRecord(owner)).toBe(false);
    expect(selfPersonnelNavAllowed("/personelim", owner)).toBe(false);
    expect(selfPersonnelNavAllowed("/mesai", owner)).toBe(false);
    expect(selfPersonnelNavAllowed("/personnel", owner)).toBe(true);
  });

  test("shows self items when employee_id is linked", () => {
    const staff = { role: "sales", employee_id: "emp_1" };
    expect(hasSelfPersonnelRecord(staff)).toBe(true);
    expect(selfPersonnelNavAllowed("/personelim", staff)).toBe(true);
    expect(selfPersonnelNavAllowed("/mesai", staff)).toBe(true);
  });

  test("personel role menu allowlist matches mobile self modules", () => {
    const p = { role: "personel", employee_id: "e1" };
    expect(isPersonelRole(p)).toBe(true);
    expect(personelMenuPathAllowed("/mesai", p)).toBe(true);
    expect(personelMenuPathAllowed("/personelim", p)).toBe(true);
    expect(personelMenuPathAllowed("/atolye", p)).toBe(true);
    expect(personelMenuPathAllowed("/hesap", p)).toBe(true);
    expect(personelMenuPathAllowed("/invoices", p)).toBe(false);
    expect(personelMenuPathAllowed("/settings", p)).toBe(false);
    expect(personelMenuPathAllowed("/stock", p)).toBe(false);
    expect(personelMenuPathAllowed("/banking", { role: "admin" })).toBe(true);
    expect(personelMenuPathAllowed("/orders", null)).toBe(false);
  });

  test("personel cannot manage company settings or see finance home", () => {
    const p = { role: "personel", employee_id: "e1" };
    expect(personelCanManageCompany(p)).toBe(false);
    expect(personelCanManageCompany({ role: "admin" })).toBe(true);
    expect(personelCanUseErpShortcuts(p)).toBe(false);
    expect(personelCanUseErpShortcuts({ role: "admin" })).toBe(true);
    expect(personelCanUseErpShortcuts(null)).toBe(false);
    expect(showHomeFinanceSummary(p)).toBe(false);
    expect(showHomeFinanceSummary({ role: "sales", employee_id: "e2" })).toBe(false);
    expect(showHomeFinanceSummary({ role: "admin" })).toBe(true);
  });

  test("personel account tabs are profil (+ şirketler if multi)", () => {
    const p = { role: "personel" };
    expect(personelAccountTabs(p, 1)).toEqual(["profil"]);
    expect(personelAccountTabs(p, 2)).toEqual(["profil", "sirketler"]);
    expect(personelAccountTabs({ role: "admin" }, 1)).toContain("ayarlar");
  });

  test("hides production AI advisor from personel and production roles", () => {
    expect(showProductionAiAdvisor({ role: "admin" })).toBe(true);
    expect(showProductionAiAdvisor({ role: "manager" })).toBe(true);
    expect(showProductionAiAdvisor({ role: "admin", employee_id: "e1" })).toBe(false);
    expect(showProductionAiAdvisor({ role: "personel" })).toBe(false);
    expect(showProductionAiAdvisor({ role: "production" })).toBe(false);
    expect(showProductionAiAdvisor(null)).toBe(false);
  });
});
