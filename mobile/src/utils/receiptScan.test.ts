import { applyReceiptDraft, receiptAmountInput, receiptScanHint } from "./receiptScan";

describe("receiptAmountInput", () => {
  it("formats integers and kuruş", () => {
    expect(receiptAmountInput(2880)).toBe("2880");
    expect(receiptAmountInput(1250.5)).toBe("1250,50");
    expect(receiptAmountInput(1250.5, ".")).toBe("1250.50");
    expect(receiptAmountInput(0)).toBe("");
  });
});

describe("applyReceiptDraft", () => {
  it("fills type, amount and description", () => {
    const next = applyReceiptDraft(
      { type: "inflow", amount: "", description: "Cari tahsilat", account_id: "a1" },
      { type: "outflow", amount: 450.25, description: "Cari ödeme" },
    );
    expect(next).toEqual({
      type: "outflow",
      amount: "450,25",
      description: "Cari ödeme",
      account_id: "a1",
    });
  });

  it("keeps form when draft is empty", () => {
    const form = { type: "inflow" as const, amount: "10", description: "x" };
    expect(applyReceiptDraft(form, null)).toBe(form);
  });
});

describe("receiptScanHint", () => {
  it("summarizes a read receipt", () => {
    expect(receiptScanHint({ type: "inflow", amount: 2880, description: "Cari tahsilat" }))
      .toBe("Tahsilat okundu · 2880 ₺");
  });
});
