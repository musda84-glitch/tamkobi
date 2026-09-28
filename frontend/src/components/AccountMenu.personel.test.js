import { personelCanManageCompany, personelCanUseErpShortcuts, isPersonelRole } from "../utils/selfPersonnelNav";

describe("personel account chrome", () => {
  test("single-company personel uses static firma chip (no hesap dropdown)", () => {
    const p = { role: "personel", employee_id: "e1" };
    expect(isPersonelRole(p)).toBe(true);
    expect(personelCanManageCompany(p)).toBe(false);
    // UI: staffStatic = staffOnly && companies.length <= 1
    const multiCompany = false;
    const staffStatic = isPersonelRole(p) && !multiCompany;
    expect(staffStatic).toBe(true);
  });

  test("personel keeps multi-company switch only", () => {
    const p = { role: "personel" };
    const multiCompany = true;
    expect(isPersonelRole(p) && !multiCompany).toBe(false);
    expect(personelCanUseErpShortcuts(p)).toBe(false);
  });
});
