import { isCancelledInvoice, withoutCancelledInvoices } from "./invoiceStatus";

test("active invoices stay visible", () => {
  expect(isCancelledInvoice({ status: "approved", gib_status: "Gelen E-Fatura Onaylandı" })).toBe(false);
  expect(isCancelledInvoice({ status: "draft", gib_status: "Taslak" })).toBe(false);
  expect(isCancelledInvoice({ invoice_number: "OP1" })).toBe(false);
});

test("cancelled status and Gelen E-Fatura İptal are hidden", () => {
  expect(isCancelledInvoice({ status: "cancelled", invoice_number: "OP02026000000546" })).toBe(true);
  expect(isCancelledInvoice({ status: "void" })).toBe(true);
  expect(isCancelledInvoice({ status: "approved", gib_status: "Gelen E-Fatura İptal" })).toBe(true);
  expect(isCancelledInvoice({ status: "sent", gib_status: "İptal edildi" })).toBe(true);
  expect(isCancelledInvoice({ payment_status: "cancelled" })).toBe(true);
});

test("invoice list filter drops cancelled OP02026000000546", () => {
  const rows = [
    { invoice_number: "OP02026000000546", status: "cancelled", gib_status: "Gelen E-Fatura İptal", grand_total: 12498 },
    { invoice_number: "OP02026000000546", status: "approved", gib_status: "Gelen E-Fatura Onaylandı", grand_total: 12498 },
    { invoice_number: "TA202600000013", status: "sent", gib_status: "Onaylandı", grand_total: 260 },
  ];
  const shown = withoutCancelledInvoices(rows);
  expect(shown.some((i) => /iptal/i.test(i.gib_status))).toBe(false);
  expect(shown.map((i) => i.gib_status).sort()).toEqual(["Gelen E-Fatura Onaylandı", "Onaylandı"]);
});
