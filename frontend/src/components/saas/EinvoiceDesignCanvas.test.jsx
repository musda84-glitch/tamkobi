import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { EinvoiceDesignCanvas } from "./EinvoiceDesignCanvas";
import { defaultLayout, normalizeLayout } from "../../utils/einvoiceDesignLayout";
import { prepareStampFile } from "../../utils/einvoiceStampImage";

jest.mock("../../utils/compressImage", () => ({ compressImageFile: async (f) => f }));
jest.mock("qrcode.react", () => ({ QRCodeSVG: () => <svg data-testid="einvoice-design-qr-svg" /> }));
jest.mock("../../utils/einvoiceStampImage", () => {
  const actual = jest.requireActual("../../utils/einvoiceStampImage");
  return {
    ...actual,
    prepareStampFile: jest.fn(),
  };
});
jest.mock("../../utils/einvoiceXsltPreview", () => {
  const actual = jest.requireActual("../../utils/einvoiceXsltPreview");
  return {
    ...actual,
    transformXsltToHtml: (xslt, xml) => {
      const text = String(xslt || "");
      const xmlText = String(xml || "");
      if (text.includes("DespatchAdvice") && !xmlText.includes("DespatchAdvice")) return "";
      const m = text.match(/<div class="inv-stamp"[\s\S]*?<\/div>/);
      const stack = text.includes('class="inv-stack"') ? "inv-stack" : "";
      const id = (xmlText.match(/<(?:[\w.-]+:)?ID>([^<]*)<\/(?:[\w.-]+:)?ID>/) || [])[1] || "";
      const leak = /EmbeddedDocumentBinaryObject/i.test(xmlText) ? "EMBED-LEAK" : "";
      return `<html><body><div id="real-xml">${stack}${id}${leak}${m ? m[0] : "NO-STAMP"}</div></body></html>`;
    },
  };
});

let host;
let last;

const STAMP_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  last = defaultLayout("e_invoice");
  prepareStampFile.mockReset();
  prepareStampFile.mockImplementation(async () => ({ dataUrl: STAMP_PNG, warning: "" }));
});

afterEach(() => {
  host.remove();
});

const Harness = () => {
  const [layout, setLayout] = useState(() => defaultLayout("e_invoice"));
  last = layout;
  return (
    <EinvoiceDesignCanvas
      layout={layout}
      kind="e_invoice"
      onChange={(n) => {
        last = n;
        setLayout(n);
      }}
    />
  );
};

test("renders preview blocks and can hide then restore from palette", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-canvas"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-preview"]')?.textContent).toContain("ABC2026000000001");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("Fatura No");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("Fatura Tarihi");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("Özelleştirme No");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("Fatura Tipi");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("İrsaliye No");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("Son Ödeme Tarihi");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("TR1.2");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("SF-414808");
  expect(host.querySelector('[data-testid="einvoice-design-palette-meta-date"]')).not.toBeNull();
  // ETTN varsayılan açık (ayrı blok); palette yalnızca gizlenince görünür
  expect(host.querySelector('[data-testid="einvoice-design-palette-ettn"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-ettn"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).not.toContain("550e8400");
  expect(host.querySelector('[data-testid="einvoice-design-block-invoice_no"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-order_no"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-supplier"]')?.textContent).toContain("Örnek Yazılım A.Ş.");
  expect(host.querySelector('[data-testid="einvoice-design-block-header"]')?.textContent).not.toContain("Örnek Yazılım A.Ş.");
  expect(host.querySelector('[data-testid="einvoice-design-palette-header-supplier_name"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-logo"]')?.textContent).toContain("Logo");
  expect(host.querySelector('[data-testid="einvoice-design-logo-size-72"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-customer"]')?.textContent).toContain("Alıcı Ticaret Ltd. Şti.");
  expect(host.querySelector('[data-testid="einvoice-design-block-parties"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-lines"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-lines"]')?.textContent).toContain("Adet");
  expect(host.querySelector('[data-testid="einvoice-design-block-lines"]')?.textContent).not.toContain("C62");
  expect(host.querySelector('[data-testid="einvoice-design-palette-iban"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-meta-order_no"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-total-exemption"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent).toContain("Mal Hizmet Toplam Tutarı");
  expect(host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent).toContain("Toplam İskonto");
  expect(host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent).toContain("KDV Matrahı");
  expect(host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent).toContain("Hesaplanan (%20)");
  expect(host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent).toContain("Vergiler Dahil Toplam Tutar");
  expect(host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent).toContain("Ödenecek Tutar");
  expect(host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent).toContain("13.000,00 TL");
  expect(host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent).toContain("15.600,00 TL");

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-hide-iban"]').click();
  });
  expect(last.blocks.find((b) => b.id === "iban").hidden).toBe(true);
  expect(host.querySelector('[data-testid="einvoice-design-palette-iban"]')).not.toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-iban"]').click();
  });
  expect(last.blocks.find((b) => b.id === "iban").hidden).toBe(false);
  expect(host.querySelector('[data-testid="einvoice-design-block-iban"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-note-text"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-iban-text"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-notes"]')?.textContent).toContain("İşbu belge elektronik olarak düzenlenmiştir.");
  expect(host.querySelector('[data-testid="einvoice-design-note-hint"]')?.textContent).toMatch(/Fatura notu/);
  expect(host.querySelector('[data-testid="einvoice-design-iban-hint"]')?.textContent).toMatch(/Şirket/);

  const note = host.querySelector('[data-testid="einvoice-design-note-text"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(note, "Teslimat kapıda.");
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(last.noteText).toBe("Teslimat kapıda.");
  expect(host.querySelector('[data-testid="einvoice-design-block-notes"]')?.textContent).toContain("Teslimat kapıda.");

  const iban = host.querySelector('[data-testid="einvoice-design-iban-text"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(iban, "TR330006100519786457841326");
    iban.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(last.ibanText).toBe("TR330006100519786457841326");
});

test("shows uploaded XSLT in the preview iframe", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <EinvoiceDesignCanvas
        layout={defaultLayout("e_invoice")}
        kind="e_invoice"
        xsltHtml={"<html><body><div>Acme XSLT kağıdı</div></body></html>"}
        preferXsltPreview
        onChange={(n) => { last = n; }}
      />
    );
  });
  const frame = host.querySelector('[data-testid="einvoice-design-preview"]');
  expect(frame?.tagName).toBe("IFRAME");
  expect(frame?.getAttribute("srcdoc") || frame?.srcdoc).toContain("Acme XSLT kağıdı");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-paper-layout"]').click();
  });
  expect(host.querySelector('[data-testid="einvoice-design-block-lines"]')).not.toBeNull();
});

test("move down swaps header with next visible block", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-down-header"]').click();
  });
  expect(last.blocks[0].id).toBe("supplier");
  expect(last.blocks[1].id).toBe("header");
});

test("span buttons, order number and extra totals", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(last.blocks.find((b) => b.id === "header").span).toBe(12);
  expect(host.querySelector('[data-testid="einvoice-design-block-header"]').className).toContain("col-span-12");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-span-header-6"]').click();
  });
  expect(last.blocks.find((b) => b.id === "header").span).toBe(6);
  expect(host.querySelector('[data-testid="einvoice-design-block-header"]').className).toContain("col-span-6");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-meta-order_no"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-meta-date"]').click();
  });
  const meta = host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent || "";
  expect(meta).toContain("SIP-2026-0142");
  expect(meta).toContain("Sipariş No");
  expect(meta).toContain("Fatura No");
  expect(meta).toContain("Fatura Tarihi");
  expect(meta).toContain("Düzenleme tarihi");
  expect(meta).toContain("Fatura Saati");
  expect(meta).toContain("14:32:05");
  expect(meta).toContain("06 - 10 - 2026");
  expect(host.querySelector('[data-testid="einvoice-design-meta-row-number"]')?.className || "").not.toMatch(/uppercase/);
  expect(host.querySelector('[data-testid="einvoice-design-meta-row-number"]')?.textContent).toContain("Fatura No:");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-total-exemption"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-total-tevkifat"]').click();
  });
  const totals = host.querySelector('[data-testid="einvoice-design-block-totals"]')?.textContent || "";
  expect(totals).toContain("Toplam İskonto");
  expect(totals).toContain("KDV Matrahı");
  expect(totals).toContain("Hesaplanan (%20)");
  expect(totals).toContain("Vergiler Dahil Toplam Tutar");
  expect(totals).toContain("İstisna");
  expect(totals).toContain("Hesaplanan KDV Tevkifat");
  expect(totals).toContain("Ödenecek Tutar");
  expect(totals).toContain("300,00 TL");
  expect(totals).toContain("15.600,00 TL");
  expect(totals).toContain("2.600,00 TL");
  expect(totals).toContain("13.000,00 TL");
});

test("adds stock, vat and GIB QR fields from palette", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-col-sku"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-col-show-sku"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-qr"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-gib_seal_invoice"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-gib_seal_archive"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-spacer"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-balance"]')).not.toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-col-show-sku"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-col-show-vat"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-col-show-barcode"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-col-show-discount"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-col-show-net_price"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-col-show-unit"]').click();
  });
  const lines = host.querySelector('[data-testid="einvoice-design-block-lines"]')?.textContent || "";
  expect(lines).toContain("Birim");
  expect(lines).toContain("Adet");
  expect(lines).not.toContain("C62");
  expect(lines).toContain("Stok Kodu");
  expect(lines).toContain("YZL-001");
  expect(lines).toContain("Barkod");
  expect(lines).toContain("İskonto");
  expect(lines).toContain("KDV");
  expect(lines).toContain("KDV'siz fiyat");
  expect(last.lineCols.find((c) => c.id === "sku").hidden).toBe(false);

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-qr"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-balance"]').click();
  });
  expect(host.querySelector('[data-testid="einvoice-design-qr"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-qr-size-96"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-qr"]')?.textContent).toContain("Boyut");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-qr-size-160"]').click();
  });
  expect(last.qrSize).toBe(160);
  expect(host.querySelector('[data-testid="einvoice-design-qr"]')?.parentElement?.textContent).not.toContain("550e8400");
  expect(host.querySelector('[data-testid="einvoice-design-qr"]')?.parentElement?.textContent).not.toMatch(/GİB KAREKOD/i);
  const balanceBlock = host.querySelector('[data-testid="einvoice-design-block-balance"]');
  expect(balanceBlock?.textContent).toContain("18.450,00 TL Borç");
  expect(balanceBlock?.innerHTML).not.toMatch(/1px solid/);
  expect(host.querySelector('[data-testid="einvoice-design-balance"]')?.getAttribute("style")).toMatch(/dashed/);

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-gib_seal_invoice"]').click();
  });
  const seal = host.querySelector('[data-testid="einvoice-design-gib-seal-invoice"]');
  expect(seal).not.toBeNull();
  expect(seal?.textContent).toContain("e-FATURA");
  expect(seal?.querySelector("img")?.getAttribute("alt")).toBe("E-Fatura Logo");
  expect(seal?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-gib_seal_archive"]').click();
  });
  const archiveSeal = host.querySelector('[data-testid="einvoice-design-gib-seal-archive"]');
  expect(archiveSeal).not.toBeNull();
  expect(archiveSeal?.textContent).toContain("e-Arşiv Fatura");
  expect(archiveSeal?.querySelector("img")?.getAttribute("alt")).toBe("E-Arşiv Logo");

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-spacer"]').click();
  });
  expect(host.querySelector('[data-testid="einvoice-design-spacer"]')?.textContent).toContain("Boş alan");
  expect(host.querySelector('[data-testid="einvoice-design-block-spacer"]').className).toContain("col-span-4");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-span-spacer-12"]').click();
  });
  expect(last.blocks.find((b) => b.id === "spacer").span).toBe(12);
  expect(host.querySelector('[data-testid="einvoice-design-block-spacer"]').className).toContain("col-span-12");
});

test("ETTN is a separate palette block, not a fatura bilgileri field", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-block-ettn"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-ettn"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).not.toContain("ETTN");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).not.toContain("550e8400");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-hide-ettn"]').click();
  });
  expect(host.querySelector('[data-testid="einvoice-design-palette-ettn"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-ettn"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-ettn"]').click();
  });
  const box = host.querySelector('[data-testid="einvoice-design-ettn"]');
  expect(box).not.toBeNull();
  expect(box?.className).toMatch(/flex/);
  expect(box?.textContent).toContain("ETTN");
  expect(box?.textContent).toContain("550e8400-e29b-41d4-a716-446655440000");
  expect(box?.querySelector(".break-all")?.style.fontSize).toBe("18px");
  expect(box?.querySelector(".break-all")?.previousElementSibling?.textContent).toBe("ETTN");
  expect(host.querySelector('[data-testid="einvoice-design-ettn-font-sizes"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-ettn"]').className).toContain("col-span-12");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).not.toContain("550e8400");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-ettn-font-size-12"]').click();
  });
  expect(last.ettnFontSize).toBe(12);
  expect(last.blocks.find((b) => b.id === "ettn").fontSize).toBe(12);
  expect(host.querySelector('[data-testid="einvoice-design-ettn"] .break-all')?.style.fontSize).toBe("12px");
  expect(host.querySelector('[data-testid="einvoice-design-block-font-ettn"]')).not.toBeNull();
});

test("GIB e-Arşiv seal can be added next to e-Fatura seal", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <EinvoiceDesignCanvas
        layout={normalizeLayout({ kind: "e_archive", blocks: [{ id: "gib_seal_archive" }] }, "e_archive")}
        kind="e_archive"
        onChange={(n) => { last = n; }}
      />
    );
  });
  const seal = host.querySelector('[data-testid="einvoice-design-gib-seal-archive"]');
  expect(seal?.textContent).toContain("e-Arşiv Fatura");
  expect(seal?.querySelector("img")?.getAttribute("alt")).toBe("E-Arşiv Logo");
});

test("meta fields stay a vertical GIB list at any width", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  const full = host.querySelector('[data-testid="einvoice-design-meta-grid"]');
  expect(full?.tagName).toBe("TABLE");
  expect(full?.querySelectorAll("tr").length).toBeGreaterThanOrEqual(8);
  expect(full?.textContent).toContain("Özelleştirme No:");
  expect(full?.textContent).toContain("Fatura No:");
  expect(full?.textContent).not.toContain("BELGE NUMARASI");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-span-meta-4"]').click();
  });
  expect(last.blocks.find((b) => b.id === "meta").span).toBe(4);
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]').className).toContain("col-span-4");
  const stacked = host.querySelector('[data-testid="einvoice-design-meta-grid"]');
  expect(stacked?.tagName).toBe("TABLE");
  expect(stacked?.textContent).toContain("Fatura Tarihi:");
  expect(stacked?.querySelector("td")?.className).toContain("font-normal");
});

test("logo size buttons update preview height", async () => {
  const LogoHarness = () => {
    const [layout, setLayout] = useState(() => normalizeLayout({ logo: "data:image/png;base64,aaa" }, "e_invoice"));
    last = layout;
    return (
      <EinvoiceDesignCanvas
        layout={layout}
        kind="e_invoice"
        onChange={(n) => {
          last = n;
          setLayout(n);
        }}
      />
    );
  };
  const root = createRoot(host);
  await act(async () => {
    root.render(<LogoHarness />);
  });
  const img = host.querySelector('[data-testid="einvoice-design-logo"] img');
  expect(img?.getAttribute("alt")).toBe("logo");
  expect(img?.style.height).toBe("72px");
  expect(host.querySelector('[data-testid="einvoice-design-logo-size-120"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-logo-size-120"]').click();
  });
  expect(last.logoSize).toBe(120);
  expect(host.querySelector('[data-testid="einvoice-design-logo"] img')?.style.height).toBe("120px");
});

test("header can show supplier name under the logo", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-header-value-supplier_name"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-header-supplier_name"]').click();
  });
  expect(host.querySelector('[data-testid="einvoice-design-header-value-supplier_name"]')?.textContent).toBe("Örnek Yazılım A.Ş.");
  expect(host.querySelector('[data-testid="einvoice-design-block-header"]')?.textContent).toContain("Örnek Yazılım A.Ş.");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-header-supplier_address"]').click();
  });
  expect(host.querySelector('[data-testid="einvoice-design-header-value-supplier_address"]')?.textContent).toContain("Kadıköy");
});

test("each block has its own font size; global toolbar stays the paper default", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(last.fontSize).toBe(12);
  expect(host.querySelector('[data-testid="einvoice-design-preview"]')?.style.fontSize).toBe("12px");
  expect(host.querySelector('[data-testid="einvoice-design-block-font-meta"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-block-font-customer"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-font-size-8"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-font-size-8"]').click();
  });
  expect(last.fontSize).toBe(12);
  expect(last.blocks.find((b) => b.id === "meta").fontSize).toBe(8);
  expect(host.querySelector('[data-testid="einvoice-design-preview"]')?.style.fontSize).toBe("12px");
  expect(host.querySelector('[data-testid="einvoice-design-font-size"]')?.value).toBe("12");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-block-font-size-customer-14"]').click();
  });
  expect(last.blocks.find((b) => b.id === "customer").fontSize).toBe(14);
  expect(last.blocks.find((b) => b.id === "meta").fontSize).toBe(8);
  await act(async () => {
    const sel = host.querySelector('[data-testid="einvoice-design-block-font-family-lines"]');
    sel.value = "Arial";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(last.blocks.find((b) => b.id === "lines").font).toBe("Arial");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-font-size"]').value = "9";
    host.querySelector('[data-testid="einvoice-design-font-size"]').dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(last.fontSize).toBe(9);
  expect(last.blocks.find((b) => b.id === "meta").fontSize).toBe(8);
});

async function showStamp() {
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-stamp"]').click();
  });
}

async function chooseStampFile() {
  const input = host.querySelector('[data-testid="einvoice-design-stamp-input"]');
  const file = new File([new Uint8Array([1, 2, 3])], "kase.png", { type: "image/png" });
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("stamp section is added from hidden blocks and supports width, order and hide", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-block-stamp"]')).toBeNull();
  const palette = host.querySelector('[data-testid="einvoice-design-palette-stamp"]');
  expect(palette?.textContent).toContain("Kaşe / İmza");
  expect(palette?.textContent).toContain("Ekle");
  await showStamp();
  expect(last.blocks.find((b) => b.id === "stamp").hidden).toBe(false);
  expect(host.querySelector('[data-testid="einvoice-design-stamp"]')?.textContent).toContain("Kaşe / İmza");
  expect(host.querySelector('[data-testid="einvoice-design-stamp-upload"]')?.textContent).toContain("Resim yükle");
  expect(host.querySelector('[data-testid="einvoice-design-block-font-stamp"]')).toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-span-stamp-4"]').click();
  });
  expect(last.blocks.find((b) => b.id === "stamp").span).toBe(4);
  expect(host.querySelector('[data-testid="einvoice-design-block-stamp"]').className).toContain("col-span-4");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-span-stamp-12"]').click();
  });
  expect(last.blocks.find((b) => b.id === "stamp").span).toBe(12);
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-span-stamp-6"]').click();
  });
  expect(last.blocks.find((b) => b.id === "stamp").span).toBe(6);

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-up-stamp"]').click();
  });
  expect(last.blocks.findIndex((b) => b.id === "stamp")).toBeLessThan(last.blocks.findIndex((b) => b.id === "iban"));

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-hide-stamp"]').click();
  });
  expect(last.blocks.find((b) => b.id === "stamp").hidden).toBe(true);
  expect(host.querySelector('[data-testid="einvoice-design-palette-stamp"]')).not.toBeNull();
});

test("stamp upload embeds the image, size and align, and warns past the limit", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  await showStamp();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-stamp-knockout"]').click();
  });
  expect(last.stampKnockoutWhite).toBe(true);
  await chooseStampFile();
  expect(prepareStampFile).toHaveBeenCalled();
  const opts = prepareStampFile.mock.calls[prepareStampFile.mock.calls.length - 1][1];
  expect(opts.knockoutWhite).toBe(true);
  expect(last.stampImage).toBe(STAMP_PNG);
  expect(host.querySelector('[data-testid="einvoice-design-stamp-img"]')?.getAttribute("src")).toBe(STAMP_PNG);
  expect(host.querySelector('[data-testid="einvoice-design-stamp-clear"]')?.textContent).toContain("Resmi kaldır");

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-stamp-size-200"]').click();
  });
  expect(last.stampSize).toBe(200);
  expect(host.querySelector('[data-testid="einvoice-design-stamp-img"]')?.style.width).toBe("200px");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-stamp-align-left"]').click();
  });
  expect(last.stampAlign).toBe("left");
  expect(host.querySelector('[data-testid="einvoice-design-stamp"]').className).toContain("items-start");

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-preview-real-xml"]').click();
  });
  const frame = host.querySelector('[data-testid="einvoice-design-preview"]');
  expect(frame?.tagName).toBe("IFRAME");
  const srcdoc = frame?.getAttribute("srcdoc") || frame?.srcdoc || "";
  expect(srcdoc).toContain(STAMP_PNG);
  expect(srcdoc).toContain('alt="Kaşe / İmza"');
  expect(srcdoc).toContain("width:200px");

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-paper-layout"]').click();
  });
  prepareStampFile.mockResolvedValueOnce({
    dataUrl: "",
    warning: "Kaşe görseli 150 KB sınırını aşıyor. Daha küçük bir PNG veya JPG seçin.",
  });
  await chooseStampFile();
  expect(host.querySelector('[data-testid="einvoice-design-stamp-warn"]')?.textContent).toMatch(/150 KB/);
  expect(last.stampImage).toBe(STAMP_PNG);

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-stamp-clear"]').click();
  });
  expect(last.stampImage).toBe("");
  expect(host.querySelector('[data-testid="einvoice-design-stamp-img"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-stamp-clear"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-stamp"]')?.textContent).toContain("Resim yükle");
});

test("dispatch preview produces iframe and hides the error box", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <EinvoiceDesignCanvas
        layout={defaultLayout("e_dispatch")}
        kind="e_dispatch"
        onChange={(n) => { last = n; }}
      />
    );
  });
  expect(host.querySelector('[data-testid="einvoice-design-preview-real-xml"]')?.textContent).toBe("Önizle (örnek XML)");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-preview-real-xml"]').click();
  });
  const frame = host.querySelector('[data-testid="einvoice-design-preview"]');
  expect(frame?.tagName).toBe("IFRAME");
  expect(host.querySelector('[data-testid="einvoice-design-real-xml-error"]')).toBeNull();
});

test("Kaşe stacks under GİB e-Arşiv and the real XML preview matches", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).not.toContain("ETTN");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-gib_seal_archive"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-stamp"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-place-stamp"]').click();
  });
  const below = host.querySelector('[data-testid="einvoice-design-place-stamp-below-gib_seal_archive"]');
  const above = host.querySelector('[data-testid="einvoice-design-place-stamp-above-gib_seal_archive"]');
  expect(below?.textContent).toContain("Altına yerleştir");
  expect(above?.textContent).toContain("Üstüne yerleştir");
  await act(async () => {
    below.click();
  });
  expect(last.blocks.find((b) => b.id === "stamp").stack).toBe("gib_seal_archive");
  expect(last.blocks.find((b) => b.id === "stamp").span).toBe(4);
  const col = host.querySelector('[data-testid="einvoice-design-column-gib_seal_archive-stamp"]');
  expect(col).not.toBeNull();
  expect(col.className).toContain("col-span-4");
  expect(col.className).toContain("h-full");
  expect(col.className).toContain("justify-start");
  expect(col.parentElement?.className).toContain("items-stretch");
  const stackedIds = [...col.children]
    .map((el) => el.getAttribute("data-testid"))
    .filter((id) => id && id.startsWith("einvoice-design-block-"));
  expect(stackedIds).toEqual([
    "einvoice-design-block-gib_seal_archive",
    "einvoice-design-block-stamp",
  ]);
  expect(host.querySelector('[data-testid="einvoice-design-block-stamp"]').className).not.toContain("col-span-");

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-up-stamp"]').click();
  });
  const flipped = host.querySelector('[data-testid="einvoice-design-column-stamp-gib_seal_archive"]');
  expect(flipped).not.toBeNull();
  const flippedIds = [...flipped.children]
    .map((el) => el.getAttribute("data-testid"))
    .filter((id) => id && id.startsWith("einvoice-design-block-"));
  expect(flippedIds[0]).toBe("einvoice-design-block-stamp");
  expect(flippedIds[1]).toBe("einvoice-design-block-gib_seal_archive");

  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-preview-real-xml"]').click();
  });
  const srcdoc = host.querySelector('[data-testid="einvoice-design-preview"]')?.getAttribute("srcdoc")
    || host.querySelector('[data-testid="einvoice-design-preview"]')?.srcdoc
    || "";
  expect(srcdoc).toContain("inv-stack");
  expect(srcdoc).toContain('class="inv-stamp"');
});

async function pickXmlFile(file) {
  const input = host.querySelector('[data-testid="einvoice-design-xml-upload-input"]');
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function srcDoc() {
  const frame = host.querySelector('[data-testid="einvoice-design-preview"]');
  return frame?.getAttribute("srcdoc") || frame?.srcdoc || "";
}

test("uploaded Invoice XML is shown in the preview iframe", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-xml-upload"]')?.textContent).toContain("XML yükle");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cac:AdditionalDocumentReference>
    <cbc:ID>xslt-ref</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/xml">SECRETBASE64PAYLOAD</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cbc:ID>GIB202600000042</cbc:ID>
</Invoice>`;
  await pickXmlFile(new File([xml], "fatura.xml", { type: "text/xml" }));
  const frame = host.querySelector('[data-testid="einvoice-design-preview"]');
  expect(frame?.tagName).toBe("IFRAME");
  expect(srcDoc()).toContain("GIB202600000042");
  expect(srcDoc()).not.toContain("SECRETBASE64PAYLOAD");
  expect(srcDoc()).not.toContain("EMBED-LEAK");
  expect(host.querySelector('[data-testid="einvoice-design-xml-use-sample"]')?.textContent).toContain("Örneğe dön");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-xml-use-sample"]').click();
  });
  expect(srcDoc()).toContain("ABC2026000000001");
  expect(srcDoc()).not.toContain("GIB202600000042");
  expect(host.querySelector('[data-testid="einvoice-design-xml-use-sample"]')).toBeNull();
});

test("DespatchAdvice XML is rejected for an e-invoice design", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<n1:DespatchAdvice xmlns:n1="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>IRS2026999</cbc:ID>
</n1:DespatchAdvice>`;
  await pickXmlFile(new File([xml], "irsaliye.xml", { type: "text/xml" }));
  const err = host.querySelector('[data-testid="einvoice-design-xml-upload-error"]');
  expect(err?.textContent).toMatch(/uyuşmuyor/);
  expect(err?.textContent).toMatch(/DespatchAdvice/);
  expect(err?.textContent).toMatch(/Invoice/);
  expect(host.querySelector("iframe")).toBeNull();
  expect(srcDoc()).not.toContain("IRS2026999");
});

test("XML larger than 2 MB is rejected", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "buyuk.xml", { type: "text/xml" });
  expect(file.size).toBeGreaterThan(2 * 1024 * 1024);
  await pickXmlFile(file);
  expect(host.querySelector('[data-testid="einvoice-design-xml-upload-error"]')?.textContent).toMatch(/2 MB/);
  expect(host.querySelector("iframe")).toBeNull();
});
