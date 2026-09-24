import { applyExpenseScan, EXPENSE_SCAN_IDLE_HINT, expenseAmountInput, expenseScanHint } from "./expenseScan";

describe("expenseScan", () => {
  it("applies a slip onto the web masraf modal", () => {
    expect(expenseAmountInput(1035.84)).toBe("1035.84");
    expect(applyExpenseScan(
      { category: "Diğer", description: "", amount: "", vat_rate: 20, vat_included: false, document_no: "" },
      { amount: 1035.84, vat_rate: 20, vat_included: true, description: "Motorin", category: "Yakıt", document_no: "44821" },
    )).toMatchObject({
      amount: "1035.84",
      category: "Yakıt",
      description: "Motorin",
      vat_included: true,
      document_no: "44821",
    });
    expect(expenseScanHint({ amount: 80, category: "Yemek" })).toBe("Yemek fişi okundu · 80 ₺");
    expect(EXPENSE_SCAN_IDLE_HINT).toMatch(/yapay zeka/i);
  });
});
