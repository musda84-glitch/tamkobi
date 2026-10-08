import { paymentAskMessage, shouldAskPaymentAfterSave } from "./invoiceAskPayment";

describe("invoiceAskPayment", () => {
  test("asks for sales with balance due", () => {
    expect(shouldAskPaymentAfterSave({ invoice_type: "sales", grand_total: 250000, paid_amount: 0 })).toBe(true);
  });

  test("skips dispatch / proforma / paid", () => {
    expect(shouldAskPaymentAfterSave({ invoice_type: "dispatch", grand_total: 100 })).toBe(false);
    expect(shouldAskPaymentAfterSave({ e_type: "e_dispatch", grand_total: 100 })).toBe(false);
    expect(shouldAskPaymentAfterSave({ invoice_type: "proforma", grand_total: 100 })).toBe(false);
    expect(shouldAskPaymentAfterSave({ invoice_type: "sales", grand_total: 100, paid_amount: 100 })).toBe(false);
  });

  test("message wording", () => {
    expect(paymentAskMessage({ invoice_type: "sales", invoice_number: "TA2026" })).toContain("tahsilat");
    expect(paymentAskMessage({ invoice_type: "purchase", invoice_number: "AL2026" })).toContain("ödeme");
  });
});
