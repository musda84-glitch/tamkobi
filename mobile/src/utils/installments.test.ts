import {
  emptyPlanDraft,
  groupInstallments,
  installmentSummary,
  chequeIdOfPayment,
  isChequePayment,
  isLockedPayment,
  lockedPaymentLabel,
  paymentEditFrom,
  paymentEditPayload,
  planPayload,
  remainingOf,
  termsPayload,
  validatePaymentEdit,
  validatePlanDraft,
} from "./installments";

const rows = [
  { id: "a1", invoice_id: "inv1", invoice_number: "SF-1", direction: "receivable", no: 1, total_count: 2, amount: 100, paid_amount: 100, status: "paid", due_date: "2026-01-10" },
  { id: "a2", invoice_id: "inv1", invoice_number: "SF-1", direction: "receivable", no: 2, total_count: 2, amount: 100, paid_amount: 25, status: "pending", due_date: "2026-02-10", is_overdue: true },
  { id: "b1", invoice_id: null, invoice_number: "AÇIK BAKİYE", direction: "payable", no: 1, total_count: 1, amount: 50, status: "pending", due_date: "2026-03-10" },
];

describe("installments", () => {
  it("summarises pending, overdue and remaining like web", () => {
    expect(installmentSummary(rows)).toEqual({ pending: 2, overdue: 1, remaining: 125 });
    expect(remainingOf(rows[1])).toBe(75);
    expect(remainingOf(rows[0])).toBe(0);
  });

  it("groups by invoice and keeps the balance plan separate", () => {
    const groups = groupInstallments(rows);
    expect(groups.map((g) => g.key)).toEqual(["inv1", "bal"]);
    expect(groups[0]).toMatchObject({ title: "SF-1", paidCount: 1, totalCount: 2, direction: "receivable" });
    expect(groups[1]).toMatchObject({ title: "AÇIK BAKİYE", direction: "payable" });
  });

  it("validates the plan against the open balance", () => {
    const d = emptyPlanDraft();
    expect(validatePlanDraft(d, 1200)).toBeNull();
    expect(validatePlanDraft({ ...d, count: "0" }, 1200)).toMatch(/en az 1/);
    expect(validatePlanDraft(d, 0)).toMatch(/bakiye yok/);
    expect(validatePlanDraft({ ...d, down_payment: "2000" }, 1200)).toMatch(/Peşinat/);
    expect(validatePlanDraft({ ...d, interval: "days", interval_days: "0" }, 1200)).toMatch(/Gün aralığı/);
    expect(validatePlanDraft({ ...d, first_due_date: "10.02.2026" }, 1200)).toMatch(/YYYY-AA-GG/);
  });

  it("builds the plan payload the API expects", () => {
    const body = planPayload({ count: "4", down_payment: "250,50", interval: "days", interval_days: "15", first_due_date: "2026-10-01" }, 1000);
    expect(body).toEqual({ total: 1000, count: 4, down_payment: 250.5, interval: "days", interval_days: 15, first_due_date: "2026-10-01" });
  });

  it("locks payments that belong to other modules", () => {
    expect(isLockedPayment({ source: "manual" })).toBe(false);
    expect(isLockedPayment({ source: "bank_sync" })).toBe(true);
    expect(lockedPaymentLabel({ source: "partner" })).toBe("Ortak");
    expect(lockedPaymentLabel({ virtual: true })).toBe("Çek");
    expect(lockedPaymentLabel({ source: "bank_sync" })).toBe("Banka");
    expect(isChequePayment({ source: "cheque", cheque_id: "c1" })).toBe(true);
    expect(isChequePayment({ source: "manual" })).toBe(false);
    expect(chequeIdOfPayment({ cheque_id: "abc" })).toBe("abc");
    expect(chequeIdOfPayment({ id: "cheque-virt-xyz" })).toBe("xyz");
  });

  it("validates and maps a payment edit", () => {
    const edit = paymentEditFrom({ id: "t1", amount: 150, date: "2026-02-03T00:00:00", description: "Kasa", account_id: "acc1" });
    expect(edit).toEqual({ id: "t1", amount: "150", date: "2026-02-03", description: "Kasa", account_id: "acc1" });
    expect(validatePaymentEdit(edit)).toBeNull();
    expect(validatePaymentEdit({ ...edit, amount: "0" })).toMatch(/Tutar/);
    expect(validatePaymentEdit({ ...edit, account_id: "" })).toMatch(/Kasa/);
    expect(paymentEditPayload(edit)).toEqual({ amount: 150, date: "2026-02-03", description: "Kasa", account_id: "acc1" });
  });

  it("maps vade form to apply-terms body", () => {
    expect(termsPayload({ days: "30", late_fee_rate: "1,5", apply_to_open_invoices: true })).toEqual({
      payment_term_days: 30,
      late_fee_rate: 1.5,
      apply_to_open_invoices: true,
    });
  });
});
