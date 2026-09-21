import { invoiceAsPrintOrder, invoicePdfFilename, invoicePrintDocType } from "./invoicePrint";
import { mergePrintTemplate, orderFormHtml } from "./orderPrint";

const invoice = {
  invoice_number: "SF-2026-0008",
  invoice_type: "sales",
  e_type: "e_archive",
  contact_name: "AHMET AĞDEMİR",
  issue_date: "2026-09-21",
  due_date: "2026-10-21",
  subtotal: 1000,
  vat_total: 200,
  grand_total: 1200,
  withholding_amount: 0,
  notes: "Peşin",
  items: [
    { product_name: "Koltuk", name: "Koltuk", quantity: 1, unit: "Adet", unit_price: 1000, unit_price_incl: 1200, total: 1000, total_incl: 1200, vat_rate: 20, barcode: "8690001111111" },
  ],
};

describe("invoicePrint", () => {
  it("maps a fatura onto the web PrintDocument invoice form", () => {
    const doc = invoiceAsPrintOrder(invoice);
    const html = orderFormHtml(doc, { name: "Matek", tax_office: "Kadıköy", tax_number: "123", iban: "TR00", bank_name: "Ziraat" }, {
      template: mergePrintTemplate({ layout: "classic" }),
      docType: "invoice",
    });
    expect(invoicePrintDocType(invoice)).toBe("invoice");
    expect(html).toContain("FATURA");
    expect(html).toContain("SF-2026-0008");
    expect(html).toContain("AHMET AĞDEMİR");
    expect(html).toContain("Resim");
    expect(html).toContain("Birim (KDV'siz)");
    expect(html).toContain("GENEL TOPLAM (KDV Dahil)");
    expect(html).toContain("data-print=\"invoice\"");
    expect(invoicePdfFilename(invoice)).toBe("SF-2026-0008.pdf");
  });

  it("uses the dispatch template for irsaliye", () => {
    const row = { ...invoice, invoice_type: "dispatch", invoice_number: "IRS-1" };
    expect(invoicePrintDocType(row)).toBe("dispatch");
    const html = orderFormHtml(invoiceAsPrintOrder(row), { name: "Matek" }, { docType: "dispatch" });
    expect(html).toContain("İRSALİYE");
    expect(html).toContain("IRS-1");
    expect(invoicePdfFilename(row)).toBe("IRS-1.pdf");
  });
});
