import {
  categoryIcon,
  expenseVendorName,
  groupExpensesByMonth,
} from "./expenseDisplay";

describe("expenseDisplay", () => {
  it("strips leading vendor labels and prefers contact_name", () => {
    expect(expenseVendorName({ description: "Firma Adı: ABC Ltd" })).toBe("ABC Ltd");
    expect(expenseVendorName({ description: "Gönderen:  X" })).toBe("X");
    expect(expenseVendorName({ description: "  satıcı:  Yılmaz  " })).toBe("Yılmaz");
    expect(expenseVendorName({ description: "FIRMA ADI: Mor Plastik" })).toBe("Mor Plastik");
    expect(expenseVendorName({
      contact_name: "ERSAY HOME",
      description: "Firma Adı: ABC Ltd",
      expense_number: "MSR-9",
    })).toBe("ERSAY HOME");
    expect(expenseVendorName({ contact_name: "  ", description: "Satıcı:", expense_number: "MSR-4" })).toBe("MSR-4");
    expect(expenseVendorName({ description: "   ", expense_number: "  " })).toBe("Masraf");
    expect(expenseVendorName({ description: "Ofis kirası" })).toBe("Ofis kirası");
  });

  it("groups by month newest first and sums totals per currency", () => {
    const groups = groupExpensesByMonth([
      { date: "2026-09-05", total: 1000, currency: "TRY", id: "sep" },
      { date: "2026-10-02", total: 40, currency: "TRY", id: "oct-a" },
      { date: "2026-10-18", total: 10, currency: "USD", id: "oct-b" },
      { date: "2026-10-18", total: 60, currency: "TRY", id: "oct-c" },
      { date: "", total: 5, currency: "TRY", id: "none" },
    ]);
    expect(groups.map((group) => group.key)).toEqual(["2026-10", "2026-09", "tarihsiz"]);
    expect(groups[0].label).toBe("Ekim 2026");
    expect(groups[0].items.map((row) => row.id)).toEqual(["oct-b", "oct-c", "oct-a"]);
    expect(groups[0].totals).toEqual([
      { currency: "TRY", amount: 100 },
      { currency: "USD", amount: 10 },
    ]);
    expect(groups[1].label).toBe("Eylül 2026");
    expect(groups[1].totals).toEqual([{ currency: "TRY", amount: 1000 }]);
    expect(groups[2].label).toBe("Tarihsiz");
    expect(groups[2].totals).toEqual([{ currency: "TRY", amount: 5 }]);
  });

  it("maps known categories and falls back to a receipt icon", () => {
    expect(categoryIcon("Yakıt")).toBe("car");
    expect(categoryIcon("Yemek")).toBe("restaurant");
    expect(categoryIcon("Kira")).toBe("home");
    expect(categoryIcon("Elektrik / Su / Doğalgaz")).toBe("flash");
    expect(categoryIcon("Fatura")).toBe("flash");
    expect(categoryIcon("Kargo / Nakliye")).toBe("cube");
    expect(categoryIcon("Diğer")).toBe("receipt-outline");
    expect(categoryIcon("")).toBe("receipt-outline");
    expect(categoryIcon("Bilinmeyen kalem")).toBe("receipt-outline");
  });
});
