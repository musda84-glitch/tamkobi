import { mergePrintTemplate } from "./orderPrint";
import { isPdfContentType, isPdfMagic, quoteFormHtml, quoteFormText, quotePdfFilename, quotePrintDocument } from "./quotePrint";

const quote = {
  quote_number: "TKF-2026-0006",
  title: "Fiyat Teklifi",
  contact_name: "AHMET AĞDEMİR",
  issue_date: "2026-09-19",
  valid_until: "2026-10-19",
  notes: "Cari ve kalemlerle",
  terms: "Peşin",
  subtotal: 260,
  vat_total: 26,
  grand_total: 286,
  items: [
    {
      name: "Duvar Rafı",
      quantity: 1,
      unit_price: 260,
      unit_price_incl: 286,
      vat_rate: 10,
      unit: "Adet",
      barcode: "8690001111111",
      sku: "RAF-1",
      total: 260,
      total_incl: 286,
    },
  ],
};

const company = {
  name: "MATEK DEKORASYON MOBİLYA SAN.TİC.LTD.ŞTİ.",
  address: "Kayışdağı Mah.",
  city: "İstanbul",
  tax_office: "Kadıköy",
  tax_number: "123",
  iban: "TR00",
  bank_name: "Ziraat",
};

describe("quotePrint", () => {
  it("matches web PrintDocument quote layout", () => {
    const html = quoteFormHtml(quote, company);
    expect(html).toContain("FİYAT TEKLİFİ");
    expect(html).toContain("TKF-2026-0006");
    expect(html).toContain("AHMET AĞDEMİR");
    expect(html).toContain("Duvar Rafı");
    expect(html).toContain("MATEK DEKORASYON");
    expect(html).toContain("ŞTİ.");
    expect(html).toContain("Sayın");
    expect(html).toContain("Konu");
    expect(html).toContain("Fiyat Teklifi");
    expect(html).toContain("Geçerlilik");
    expect(html).toContain("Raf Yeri");
    expect(html).toContain("Barkod");
    expect(html).toContain("8690001111111");
    expect(html).toContain("Tutar (KDV Dahil)");
    expect(html).toContain("data-print-items=\"compact\"");
    expect(html).toContain("Toplam");
    expect(html).toContain("Net");
    expect(html).toContain("Kaşe / İmza");
    expect(html).toContain("Şartlar");
    expect(html).toContain("data-print=\"quote\"");
    expect(html).toContain("<svg");
    expect(quoteFormText(quote, company)).toMatch(/Toplam/);
    expect(quoteFormText(quote, company)).toContain("AHMET AĞDEMİR");
  });

  it("puts a service line photo only on the print form", () => {
    const html = quoteFormHtml({
      ...quote,
      items: [{
        name: "Montaj",
        quantity: 1,
        unit_price: 500,
        vat_rate: 20,
        unit: "Adet",
        is_service: true,
        print_image_url: "/api/files/hizmet.jpg",
      }],
    }, company, { template: mergePrintTemplate({ show_images: true }), mediaBase: "https://tamkobi.com" });
    expect(html).toContain("Montaj");
    expect(html).toContain("/api/files/hizmet.jpg");
    expect(html).toContain("<img");
  });

  it("uses the company quote print-template", () => {
    const html = quoteFormHtml(quote, company, {
      template: mergePrintTemplate({
        layout: "modern",
        title_override: "ÖZEL TEKLİF",
        hide_all_prices: true,
        show_signature: false,
        primary_color: "#0ea5e9",
      }),
    });
    expect(html).toContain("ÖZEL TEKLİF");
    expect(html).not.toContain("GENEL TOPLAM");
    expect(html).not.toContain("Kaşe / İmza");
    expect(html).toContain("background:#0ea5e9");
  });

  it("names the pdf after the quote number", () => {
    expect(quotePdfFilename(quote)).toBe("TKF-2026-0006.pdf");
    expect(quotePdfFilename({})).toBe("teklif.pdf");
  });

  it("wraps the teklif in a printable A4 document with utf-8", () => {
    const doc = quotePrintDocument("TKF-1", quoteFormHtml(quote, company));
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain('lang="tr"');
    expect(doc).toContain('charset="utf-8"');
    expect(doc).toContain("FİYAT TEKLİFİ");
    expect(doc).toContain("AHMET AĞDEMİR");
    expect(doc).toContain("size:A4");
  });

  it("detects PDF bytes and content types", () => {
    expect(isPdfMagic(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(isPdfMagic(new Uint8Array([0x00, 0x01]))).toBe(false);
    expect(isPdfContentType("application/pdf")).toBe(true);
    expect(isPdfContentType("application/json")).toBe(false);
  });
});
