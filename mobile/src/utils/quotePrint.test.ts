import { quoteFormHtml, quoteFormText, quotePdfFilename } from "./quotePrint";

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
});
