import { emptyExpenseDraft } from "./finance";
import { applyExpensePrefill, applyExpenseScan, EXPENSE_SCAN_IDLE_HINT, expenseAmountInput, expenseScanHint, expenseScanNavParams } from "./expenseScan";

describe("expenseScan", () => {
  it("formats amounts and applies a slip draft", () => {
    expect(expenseAmountInput(1035.84)).toBe("1035,84");
    const next = applyExpenseScan(emptyExpenseDraft("2026-09-21"), {
      amount: 1035.84,
      vat_rate: 20,
      vat_included: true,
      description: "Motorin",
      category: "Yakıt",
      document_no: "44821",
      date: "2026-09-21",
    });
    expect(next).toMatchObject({
      amount: "1035,84",
      vat_rate: "20",
      vat_included: true,
      description: "Motorin",
      category: "Yakıt",
      document_no: "44821",
      date: "2026-09-21",
    });
    expect(expenseScanHint({ amount: 1035.84, category: "Yakıt" })).toBe("Yakıt fişi okundu · 1035,84 ₺");
    expect(EXPENSE_SCAN_IDLE_HINT).toMatch(/yapay zeka/i);
  });

  it("builds nav params and prefills the new-expense form", () => {
    const params = expenseScanNavParams({
      amount: 80,
      category: "Yemek",
      description: "Öğle yemeği",
      vat_rate: 10,
    }, { id: "c1" });
    expect(params).toMatchObject({
      amount: "80",
      category: "Yemek",
      description: "Öğle yemeği",
      vat_rate: "10",
      vat_included: "1",
      contact_id: "c1",
    });
    const filled = applyExpensePrefill(emptyExpenseDraft("2026-09-21"), params);
    expect(filled).toMatchObject({
      amount: "80",
      category: "Yemek",
      description: "Öğle yemeği",
      vat_rate: "10",
      vat_included: true,
      contact_id: "c1",
    });
  });
});
