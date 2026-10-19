import {
  cargoLabelCode,
  cargoLabelFilename,
  cargoLabelHtml,
  cargoLabelText,
  mergePrintTemplate,
  officialLabelFileMeta,
  orderFormHtml,
  orderFormText,
  orderPdfFilename,
  a4DocumentCss,
  printDocumentHtml,
  thermalLabelCss,
} from "./orderPrint";
import { receiptPrintHtml } from "./receiptPrint";

const order = {
  order_number: "11573451170",
  customer_name: "Hatice YILDIRIM",
  customer_phone: "555",
  shipping_address: "Moda Cad.",
  city: "İstanbul",
  district: "Kadıköy",
  channel: "trendyol",
  cargo_tracking_number: "TR123",
  cargo_barcode: "8690001928371",
  cargo_carrier: "Trendyol Express",
  cargo_label_url: "https://cdn.trendyol.com/label.pdf",
  grand_total: 17550,
  subtotal: 14625,
  vat_total: 2925,
  order_date: "2026-09-06",
  payment_type: "cod",
  customer_order_number: "TY-88",
  items: [{ product_name: "Koltuk", quantity: 1, unit_price: 14625, unit_price_incl: 17550, total: 14625, total_incl: 17550, vat_rate: 20, sku: "KOL-1", barcode: "8690001111111" }],
};

describe("orderPrint", () => {
  it("builds a sipariş formu like web PrintDocument", () => {
    const html = orderFormHtml(order, { name: "Matek", tax_office: "Kadıköy", tax_number: "123", iban: "TR00", bank_name: "Ziraat" });
    expect(html).toContain("SİPARİŞ FORMU");
    expect(html).toContain("11573451170");
    expect(html).toContain("Hatice YILDIRIM");
    expect(html).toContain("Koltuk");
    expect(html).toContain("Raf Yeri");
    expect(html).toContain("Barkod");
    expect(html).toContain("Tutar (KDV Dahil)");
    expect(html).toContain("İndirim (%)");
    expect(html).toContain("data-print-items=\"compact\"");
    expect(html).toContain("Toplam");
    expect(html).toContain("Net");
    expect(html).toContain("Sayın");
    expect(html).toContain("VKN");
    expect(html).toContain("TY-88");
    expect(html).toContain("Kaşe / İmza");
    expect(html).toContain("<svg");
    expect(orderFormText(order, { name: "Matek" })).toMatch(/Toplam/);
  });

  it("prints quote extras like web PrintDocument", () => {
    const html = orderFormHtml(
      { ...order, title: "Fiyat Teklifi", valid_until: "2026-10-19", terms: "Peşin" } as typeof order,
      { name: "Matek" },
      { docType: "quote" },
    );
    expect(html).toContain("FİYAT TEKLİFİ");
    expect(html).toContain("Geçerlilik");
    expect(html).toContain("Konu");
    expect(html).toContain("Şartlar");
    expect(html).toContain("data-print=\"quote\"");
  });

  it("honors company print-template layout and hidden prices", () => {
    const html = orderFormHtml(order, { name: "Matek" }, {
      template: mergePrintTemplate({ layout: "modern", hide_all_prices: true, title_override: "SEVK LİSTESİ", show_signature: false }),
    });
    expect(html).toContain("SEVK LİSTESİ");
    expect(html).not.toContain("data-print-grand-total");
    expect(html).not.toContain("Kaşe / İmza");
    expect(html).toContain("background:#059669");
  });

  it("prints invoices with the wide web form and invoice title", () => {
    const html = orderFormHtml(
      { ...order, invoice_number: "SF-1", e_type: "e_archive", contact_name: "Hatice YILDIRIM" } as typeof order,
      { name: "Matek", tax_office: "Kadıköy", tax_number: "123", iban: "TR00" },
      { docType: "invoice" },
    );
    expect(html).toContain("FATURA");
    expect(html).toContain("SF-1");
    expect(html).toContain("Resim");
    expect(html).toContain("Birim (KDV'siz)");
    expect(html).toContain("GENEL TOPLAM (KDV Dahil)");
    expect(html).toContain("data-print-items=\"wide\"");
    expect(html).toContain("data-print=\"invoice\"");
  });

  it("prints dispatch forms and honors A5 paper + contact balance", () => {
    const html = orderFormHtml(order, { name: "Matek" }, {
      docType: "dispatch",
      contactBalance: 1240,
      template: mergePrintTemplate({ paper: "A5", title_override: "" }),
    });
    expect(html).toContain("İRSALİYE");
    expect(html).toContain("data-print-paper=\"A5\"");
    expect(html).toContain("Resim");
    const a5 = printDocumentHtml("İrsaliye", html, "a4", "A5");
    expect(a5).toContain("size:A5");
    expect(a5).toContain("margin:10mm");
  });

  it("shows the web current-balance sentence on compact forms", () => {
    const html = orderFormHtml(order, { name: "Matek" }, { contactBalance: 1240 });
    expect(html).toContain("Güncel bakiyeniz: 1.240,00 ₺");
    expect(html).toContain("data-print-balance");
  });

  it("builds a 100×150 thermal kargo etiketi with CODE128", () => {
    const html = cargoLabelHtml(order, { name: "Matek", address: "Atölye", phone: "0212" });
    expect(html).toContain('class="label"');
    expect(html).toContain("ALICI");
    expect(html).toContain("GÖNDERİCİ");
    expect(html).toContain("8690001928371");
    expect(html).toContain("Matek");
    expect(html).toContain("TRENDYOL");
    expect(html).toContain("KAPIDA ÖDEME");
    expect(html).toContain("<svg");
    expect(html).toContain("Kadıköy / İstanbul");
    expect(cargoLabelCode(order)).toBe("8690001928371");
    expect(cargoLabelText(order).includes("8690001928371")).toBe(true);
    expect(thermalLabelCss()).toContain("100mm 150mm");
  });

  it("prefers cargo barcode over tracking for the printed code", () => {
    expect(cargoLabelCode({ cargo_tracking_number: "TR", cargo_barcode: "8691" })).toBe("8691");
    expect(cargoLabelCode({ order_number: "1157" })).toBe("1157");
  });

  it("wraps native print HTML without window.print script", () => {
    const form = printDocumentHtml("Sipariş 1157", orderFormHtml(order, { name: "Matek" }), "a4");
    expect(form).toContain("<!doctype html>");
    expect(form).toContain("SİPARİŞ FORMU");
    expect(form).toContain("size:A4");
    expect(form).not.toContain("window.print");
    const label = printDocumentHtml("Kargo 1157", cargoLabelHtml(order, { name: "Matek" }), "thermal");
    expect(label).toContain("100mm 150mm");
    expect(label).toContain('class="label"');
    expect(label).not.toContain("window.print");
  });

  it("keeps one-page order, quote, dispatch, invoice and receipt prints on one page", () => {
    const kinds = ["order", "quote", "dispatch", "invoice", "receipt"] as const;
    for (const kind of kinds) {
      const paper = kind === "dispatch" ? "A5" : "A4";
      const css = a4DocumentCss(paper);
      const body = kind === "receipt"
        ? receiptPrintHtml({ id: "r1", type: "inflow", amount: 10, description: "Tahsilat" })
        : orderFormHtml(order, { name: "Matek" }, { docType: kind === "quote" ? "quote" : kind === "invoice" ? "invoice" : kind === "dispatch" ? "dispatch" : "order" });
      const doc = printDocumentHtml(kind, body, "a4", paper);
      expect(doc).toContain(css);
      expect(css).toContain("height:auto");
      expect(css).toContain("min-height:0");
      expect(css).not.toContain("100vh");
      expect(css).not.toContain("297mm");
      expect(css).toContain(":last-child{break-after:auto;page-break-after:auto}");
      expect(css).toContain(".print-footer:empty{display:none;height:0;margin:0;padding:0}");
      expect(css).toContain("margin:10mm");
      expect(css).toContain("--print-content-pad:8mm");
      expect((10 + 8) * 2).toBeLessThan(297);
      expect(doc).not.toContain("100vh");
      expect(doc).not.toContain("297mm");
      if (kind !== "receipt") {
        expect(body).toContain("height:auto");
        expect(body).toContain("min-height:0");
        expect(body).toContain("print-footer");
      } else {
        expect(doc).toContain("TAHSİLAT MAKBUZU");
      }
    }
  });

  it("keeps relative product and logo urls on the media base and honors show_images", () => {
    const doc = {
      ...order,
      items: [{ ...order.items[0], product_id: "p1", thumbnail_url: "/api/files/products/a.jpg" }],
    };
    const company = { name: "Matek", logo_url: "/api/files/brand/logo.png" };
    const shown = orderFormHtml(doc, company, {
      mediaBase: "https://tamkobi.com",
      template: mergePrintTemplate({ show_images: true, show_logo: true }),
    });
    expect(shown).toContain("https://tamkobi.com/api/files/products/a.jpg");
    expect(shown).toContain("https://tamkobi.com/api/files/brand/logo.png");
    expect(shown).toContain("<img");
    const bare = orderFormHtml({
      ...order,
      items: [{ ...order.items[0], thumbnail_url: "photo.jpg" }],
    }, { name: "Matek" }, { mediaBase: "https://tamkobi.com/" });
    expect(bare).toContain("https://tamkobi.com/api/files/photo.jpg");
    const hidden = orderFormHtml(doc, company, {
      mediaBase: "https://tamkobi.com",
      template: mergePrintTemplate({ show_images: false, show_logo: true }),
    });
    expect(hidden).not.toContain("/api/files/products/a.jpg");
    expect(hidden).toContain("https://tamkobi.com/api/files/brand/logo.png");
    const omitted = orderFormHtml(doc, company, {
      mediaBase: "https://tamkobi.com",
      omitRemoteImages: true,
      template: mergePrintTemplate({ show_images: true, show_logo: true }),
    });
    expect(omitted).not.toContain("<img");
    expect(omitted).not.toContain("/api/files/");
  });

  it("names pdf files after the order number", () => {
    expect(orderPdfFilename(order)).toBe("11573451170.pdf");
    expect(cargoLabelFilename(order)).toBe("kargo-11573451170.pdf");
    expect(orderPdfFilename({})).toBe("siparis.pdf");
  });

  it("detects official cargo label mime from type or magic", () => {
    expect(officialLabelFileMeta("application/pdf")).toEqual({ mime: "application/pdf", ext: "pdf", kind: "pdf" });
    expect(officialLabelFileMeta("image/png")).toEqual({ mime: "image/png", ext: "png", kind: "image" });
    expect(officialLabelFileMeta("", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toEqual({
      mime: "application/pdf",
      ext: "pdf",
      kind: "pdf",
    });
    expect(officialLabelFileMeta("", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({
      mime: "image/png",
      ext: "png",
      kind: "image",
    });
    expect(officialLabelFileMeta("application/octet-stream")).toEqual({
      mime: "application/octet-stream",
      ext: "bin",
      kind: "file",
    });
  });
});
