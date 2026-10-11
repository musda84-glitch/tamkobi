import {
  BANK_MATCH_MODES,
  PERSONNEL_PAY_KINDS,
  expenseCategoryOptionLabel,
  isPersonnelExpenseCategory,
} from "./bankMatchModes";

describe("bankMatchModes", () => {
  test("does not include Cari + Fatura (invoice)", () => {
    const keys = BANK_MATCH_MODES.map(([k]) => k);
    expect(keys).toEqual(["contact", "transfer", "category", "expense"]);
    expect(keys).not.toContain("invoice");
    expect(BANK_MATCH_MODES.map(([, l]) => l)).not.toContain("Cari + Fatura");
  });

  test("detects Personel category and labels it Personel", () => {
    expect(isPersonnelExpenseCategory("Personel Masrafı")).toBe(true);
    expect(isPersonnelExpenseCategory("Personel")).toBe(true);
    expect(isPersonnelExpenseCategory("Yakıt")).toBe(false);
    expect(expenseCategoryOptionLabel("Personel Masrafı")).toBe("Personel");
    expect(expenseCategoryOptionLabel("Yakıt")).toBe("Yakıt");
  });

  test("personnel pay kinds cover masraf/avans/mesai/maaş", () => {
    expect(PERSONNEL_PAY_KINDS.map(([k]) => k)).toEqual(["expense", "advance", "overtime", "salary"]);
    expect(PERSONNEL_PAY_KINDS.map(([, l]) => l)).toEqual(["Masraf", "Avans", "Mesai", "Maaş"]);
  });
});
