import { applyReceiptDraft, receiptAmountInput, receiptScanHint } from "./receiptScan";

describe("receiptScan", () => {
  it("formats amounts for number inputs", () => {
    expect(receiptAmountInput(2880)).toBe("2880");
    expect(receiptAmountInput(450.25)).toBe("450.25");
  });

  it("applies draft onto the collect form", () => {
    expect(applyReceiptDraft(
      { type: "inflow", amount: "", description: "Cari tahsilat", method: "cash" },
      { type: "outflow", amount: 450.25, description: "Cari ödeme" },
    )).toEqual({
      type: "outflow",
      amount: "450.25",
      description: "Cari ödeme",
      method: "cash",
    });
  });

  it("summarizes a read receipt", () => {
    expect(receiptScanHint({ type: "inflow", amount: 2880 })).toBe("Tahsilat okundu · 2880 ₺");
  });
});
