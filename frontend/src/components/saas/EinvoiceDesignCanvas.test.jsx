import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { EinvoiceDesignCanvas } from "./EinvoiceDesignCanvas";
import { defaultLayout, normalizeLayout } from "../../utils/einvoiceDesignLayout";

jest.mock("../../utils/compressImage", () => ({ compressImageFile: async (f) => f }));
jest.mock("qrcode.react", () => ({ QRCodeSVG: () => <svg data-testid="einvoice-design-qr-svg" /> }));

let host;
let last;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  last = defaultLayout("e_invoice");
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
  expect(host.querySelector('[data-testid="einvoice-design-palette-meta-ettn"]')).not.toBeNull();
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
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-meta-ettn"]').click();
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
  const lines = host.querySelector('[data-testid="einvoice-design-block-lines"]')?.textContent || "";
  expect(lines).toContain("Stok kodu");
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
  expect(host.querySelector('[data-testid="einvoice-design-block-balance"]')?.textContent).toContain("18.450,00 TL Borç");

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

test("font size control shrinks preview and is stored on layout", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(last.fontSize).toBe(12);
  expect(host.querySelector('[data-testid="einvoice-design-preview"]')?.style.fontSize).toBe("12px");
  expect(host.querySelector('[data-testid="einvoice-design-font-size-8"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-font-size-8"]').click();
  });
  expect(last.fontSize).toBe(8);
  expect(host.querySelector('[data-testid="einvoice-design-preview"]')?.style.fontSize).toBe("8px");
  expect(host.querySelector('[data-testid="einvoice-design-font-size"]')?.value).toBe("8");
});
