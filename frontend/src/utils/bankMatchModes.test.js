import {
  BANK_MATCH_MODES,
  PERSONNEL_PAY_KINDS,
  expenseCategoryOptionLabel,
  isPersonnelExpenseCategory,
} from "./bankMatchModes";

describe("bankMatchModes", () => {
  test("does not include Cari + Fatura (invoice)", () => {
    const keys = BANK_MATCH_MODES.map(([k]) => k);
    expect(keys).toEqual(["contact", "transfer", "category", "expense", "pos_settlement"]);
    expect(BANK_MATCH_MODES[BANK_MATCH_MODES.length - 1]).toEqual(["pos_settlement", "POS bloke çözümü"]);
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

  test("personnel pay kinds default to masraf iadesi", () => {
    expect(PERSONNEL_PAY_KINDS.map(([k]) => k)).toEqual(["reimburse", "advance", "salary", "overtime", "expense"]);
    expect(PERSONNEL_PAY_KINDS.map(([, l]) => l)).toEqual([
      "Masraf iadesi",
      "Avans",
      "Maaş",
      "Mesai",
      "Şirket masrafı (personel adına)",
    ]);
    expect(PERSONNEL_PAY_KINDS[0][0]).toBe("reimburse");
  });
});
