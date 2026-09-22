import { buildMiniInvoiceHtml, miniInvoiceSize } from "./miniInvoicePrint";
import { ORDER_BULK_ACTIONS, bulkActionNeedsSelection } from "./orderBulkActions";

test("bulk menu lists the order actions and only refresh works with an empty selection", () => {
  expect(ORDER_BULK_ACTIONS.map((a) => a.label)).toEqual([
    "Toplu E-Fatura Oluştur",
    "Toplu E-Fatura Yazdır",
    "Toplu Mini E-Fatura Yazdır (10X15cm)",
    "Toplu Mini E-Fatura Yazdır (8X20cm)",
    "Toplu HepsiJet Ortak Barkod Yazdır",
    "Toplu E-Fatura Gönder",
    "Toplu Fatura Oluştur",
    "Toplu Fatura Yazdır",
    "Toplu Kargo Etiketi Yazdır",
    "Toplu Mini Kargo Etiketi Yazdır",
    "Toplu Mini Kargo Etiketi Yazdır 10X10",
    "Toplu Fatura Tarihi Değiştir",
    "Toplu Sipariş Onayla",
    "Toplu Kargo Siparişi Oluştur",
    "Toplu E-Fatura XML'i İndir",
    "Toplu Fatura Linki gönder",
    "Siparişlerin Güncel Durumlarını Getir",
    "Toplu Navlungo Kargo Etiketi Yazdır",
    "Seçili Siparişleri İptal Et",
  ]);
  expect(bulkActionNeedsSelection("refresh")).toBe(false);
  expect(bulkActionNeedsSelection("cancel")).toBe(true);
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
