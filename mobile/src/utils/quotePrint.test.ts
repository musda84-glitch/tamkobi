import { isPdfContentType, isPdfMagic, quoteFormHtml, quoteFormText, quotePdfFilename, quotePrintDocument } from "./quotePrint";

const quote = {
  quote_number: "TKF-2026-0006",
  title: "Fiyat Teklifi",
  contact_name: "AHMET AĞDEMİR",
  issue_date: "2026-09-19",
  valid_until: "2026-10-19",
  notes: "Cari ve kalemlerle",
  grand_total: 286,
  items: [
    { name: "Duvar Rafı", quantity: 1, unit_price: 260, vat_rate: 10, unit: "Adet" },
  ],
};

describe("quotePrint", () => {
  it("builds a fiyat teklifi with customer and totals", () => {
    const html = quoteFormHtml(quote, { name: "TamKobi" });
    expect(html).toContain("FİYAT TEKLİFİ");
    expect(html).toContain("TKF-2026-0006");
    expect(html).toContain("AHMET AĞDEMİR");
    expect(html).toContain("Duvar Rafı");
    expect(html).toContain("TamKobi");
    expect(quoteFormText(quote, { name: "TamKobi" })).toMatch(/Toplam/);
  });

  it("names the pdf after the quote number", () => {
    expect(quotePdfFilename(quote)).toBe("TKF-2026-0006.pdf");
    expect(quotePdfFilename({})).toBe("teklif.pdf");
  });

  it("wraps the teklif in a printable A4 document", () => {
    const doc = quotePrintDocument("TKF-1", quoteFormHtml(quote));
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain("FİYAT TEKLİFİ");
    expect(doc).toContain("size:A4");
  });

  it("detects PDF bytes and content types", () => {
    expect(isPdfMagic(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(isPdfMagic(new Uint8Array([0x00, 0x01]))).toBe(false);
    expect(isPdfContentType("application/pdf")).toBe(true);
    expect(isPdfContentType("application/json")).toBe(false);
  });
});
