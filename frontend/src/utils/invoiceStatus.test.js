import {
  isCancelledInvoice,
  withoutCancelledInvoices,
  invoicesForDisplay,
  isApprovingInvoice,
  APPROVING_INVOICE_BADGE,
  invoiceRowActionsDisabled,
} from "./invoiceStatus";

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
  expect(invoicesForDisplay(rows, false).map((i) => i.gib_status).sort()).toEqual(["Gelen E-Fatura Onaylandı", "Onaylandı"]);
  expect(invoicesForDisplay(rows, true)).toHaveLength(3);
  expect(invoicesForDisplay(rows, true).some((i) => i.status === "cancelled")).toBe(true);
});

test("show-cancelled checkbox hides cancelled by default and shows them when on", () => {
  const cancelled = { invoice_number: "X-1", status: "cancelled", gib_status: "İptal edildi" };
  const open = { invoice_number: "X-2", status: "approved", gib_status: "Onaylandı" };
  expect(invoicesForDisplay([cancelled, open], false).map((i) => i.invoice_number)).toEqual(["X-2"]);
  expect(invoicesForDisplay([cancelled, open], true).map((i) => i.invoice_number)).toEqual(["X-1", "X-2"]);
});

test("cancelling invoices are hidden like cancelled until the existing checkbox is on", () => {
  const cancelling = { invoice_number: "X-3", status: "cancelling" };
  const open = { invoice_number: "X-4", status: "approved" };
  expect(isCancelledInvoice(cancelling)).toBe(true);
  expect(invoicesForDisplay([cancelling, open], false).map((i) => i.invoice_number)).toEqual(["X-4"]);
  expect(invoicesForDisplay([cancelling, open], true).map((i) => i.invoice_number)).toEqual(["X-3", "X-4"]);
});

test("approving invoice shows Faturalaştırılıyor badge and disables row actions", () => {
  const approving = { invoice_number: "TA-APP", status: "approving", invoice_type: "sales", e_type: "e_archive" };
  const draft = { invoice_number: "TA-DR", status: "draft", invoice_type: "sales", e_type: "e_archive" };
  expect(isApprovingInvoice(approving)).toBe(true);
  expect(isApprovingInvoice(draft)).toBe(false);
  expect(APPROVING_INVOICE_BADGE).toBe("Faturalaştırılıyor…");
  expect(invoiceRowActionsDisabled(approving)).toBe(true);
  expect(invoiceRowActionsDisabled(draft)).toBe(false);
  expect(invoicesForDisplay([approving, draft], false).map((i) => i.invoice_number)).toEqual(["TA-APP", "TA-DR"]);
});
