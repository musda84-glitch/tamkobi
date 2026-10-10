import { buildMiniInvoiceHtml, miniInvoiceSize } from "./miniInvoicePrint";
import {
  ORDER_BULK_ACTIONS,
  ORDER_BULK_ACTION_IDS,
  orderBulkHandlerKind,
  bulkActionNeedsSelection,
  orderBulkEInvoiceEligible,
  orderDocumentDate,
  orderHasOldDocumentDate,
  ordersHaveOldDocumentDate,
  orderRowId,
  todayYmd,
} from "./orderBulkActions";

test("bulk menu lists the order actions and only refresh works with an empty selection", () => {
  expect(ORDER_BULK_ACTIONS.map((a) => a.label)).toEqual([
    "Toplu E-Fatura Oluştur",
    "Toplu E-Fatura Yazdır",
    "Toplu Mini E-Fatura Yazdır (10X15cm)",
    "Toplu Mini E-Fatura Yazdır (8X20cm)",
    "Toplu E-Fatura Gönder",
    "Toplu Fatura Oluştur",
    "Toplu Fatura Yazdır",
    "Toplu Kargo Etiketi Yazdır",
    "Toplu Mini Kargo Etiketi Yazdır",
    "Toplu Mini Kargo Etiketi Yazdır 10X10",
    "Toplu Fatura Tarihi Değiştir",
    "Toplu Sipariş Onayla",
    "Toplu Kargola",
    "Toplu E-Fatura XML'i İndir",
    "Toplu E-Fatura PDF İndir",
    "Toplu Fatura Linki gönder",
    "Siparişlerin Güncel Durumlarını Getir",
    "Seçili Siparişleri İptal Et",
  ]);
  expect(ORDER_BULK_ACTIONS.map((a) => a.id)).not.toContain("hepsijet");
  expect(ORDER_BULK_ACTIONS.map((a) => a.id)).not.toContain("navlungo");
  expect(ORDER_BULK_ACTIONS.map((a) => a.id)).toContain("kargola");
  expect(bulkActionNeedsSelection("refresh")).toBe(false);
  expect(bulkActionNeedsSelection("cancel")).toBe(true);
  // Her menü satırının handler yönlendirmesi tanımlı
  for (const id of ORDER_BULK_ACTION_IDS) {
    expect(orderBulkHandlerKind(id)).toBeTruthy();
  }
  expect(orderBulkHandlerKind("kargola")).toBe("loop");
  expect(orderBulkHandlerKind("einvoice_create")).toBe("modal_einvoice");
  expect(orderBulkHandlerKind("einvoice_send")).toBe("modal_einvoice");
  expect(orderBulkHandlerKind("mini_10x15")).toBe("immediate");
  expect(orderBulkHandlerKind("mini_8x20")).toBe("immediate");
  expect(orderBulkHandlerKind("xml")).toBe("immediate");
  expect(orderBulkHandlerKind("efatura_pdf")).toBe("immediate");
  expect(orderBulkHandlerKind("cargo_mini")).toBe("immediate");
  expect(orderBulkHandlerKind("approve")).toBe("loop");
  expect(orderBulkHandlerKind("cancel")).toBe("loop");
  expect(orderBulkHandlerKind("navlungo")).toBeNull();
});

test("order bulk helpers resolve row id and skip issued e-invoices", () => {
  expect(orderRowId({ id: "a" })).toBe("a");
  expect(orderRowId({ _id: "b" })).toBe("b");
  expect(orderBulkEInvoiceEligible({ einvoice_state: "sent" })).toBe(false);
  expect(orderBulkEInvoiceEligible({ order_status: "pending" })).toBe(false);
  expect(orderBulkEInvoiceEligible({ is_invoiced: false })).toBe(false);
  expect(orderBulkEInvoiceEligible({ is_invoiced: true })).toBe(false);
  expect(orderBulkEInvoiceEligible({ is_invoiced: true, invoice_id: "inv1" })).toBe(true);
  expect(orderBulkEInvoiceEligible({ is_invoiced: true, einvoice_state: "sent" })).toBe(false);
});

test("old document dates trigger the bulk e-invoice date prompt", () => {
  expect(todayYmd(new Date("2026-10-05T12:00:00"))).toBe("2026-10-05");
  expect(orderDocumentDate({ invoice_date: "2026-09-01" })).toBe("2026-09-01");
  expect(orderDocumentDate({ order_date: "2026-09-02T18:00:00Z" })).toBe("2026-09-02");
  expect(orderHasOldDocumentDate({ invoice_date: "2026-10-04" }, "2026-10-05")).toBe(true);
  expect(orderHasOldDocumentDate({ invoice_date: "2026-10-05" }, "2026-10-05")).toBe(false);
  expect(ordersHaveOldDocumentDate([
    { invoice_date: "2026-10-05" },
    { order_date: "2026-09-20" },
  ], "2026-10-05")).toBe(true);
});

test("mini invoice slip uses the requested paper size", () => {
  expect(miniInvoiceSize("8x20")).toEqual({ w: 80, h: 200, label: "8×20 cm" });
  const html = buildMiniInvoiceHtml(
    [{ order_number: "SIP-1", invoice_number: "FAT-1", customer_name: "Mustafa", items: [{ product_name: "Raf", quantity: 1, total: 100 }], grand_total: 110, currency: "USD" }],
    { name: "TamKobi" },
    "10x15"
  );
  expect(html).toContain("size:100mm 150mm");
  expect(html).toContain("Mustafa");
  expect(html).toContain("FAT-1");
  expect(html).toContain("USD");
  expect(html).not.toContain(" ₺");
});

test("mini invoice defaults to TRY suffix", () => {
  const html = buildMiniInvoiceHtml(
    [{ invoice_number: "FAT-2", items: [], grand_total: 50 }],
    { name: "TamKobi" }
  );
  expect(html).toContain("₺");
});
