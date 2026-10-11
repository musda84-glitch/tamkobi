import { BANK_MATCH_MODES, isPersonnelExpenseCategory } from "./bankMatchModes";

describe("bankMatchModes", () => {
  test("does not include Cari + Fatura (invoice)", () => {
    const keys = BANK_MATCH_MODES.map(([k]) => k);
    expect(keys).toEqual(["contact", "transfer", "category", "expense"]);
    expect(keys).not.toContain("invoice");
    expect(BANK_MATCH_MODES.map(([, l]) => l)).not.toContain("Cari + Fatura");
  });

  test("detects Personel Masrafı category", () => {
    expect(isPersonnelExpenseCategory("Personel Masrafı")).toBe(true);
    expect(isPersonnelExpenseCategory("personel")).toBe(true);
    expect(isPersonnelExpenseCategory("Yakıt")).toBe(false);
    expect(isPersonnelExpenseCategory("")).toBe(false);
  });
});
