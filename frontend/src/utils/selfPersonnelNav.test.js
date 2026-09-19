import { hasSelfPersonnelRecord, isSelfPersonnelPath, selfPersonnelNavAllowed } from "./selfPersonnelNav";

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
});
