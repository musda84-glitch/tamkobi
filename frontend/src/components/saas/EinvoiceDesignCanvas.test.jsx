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
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("Fatura numarası");
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent).toContain("Düzenleme tarihi");
  expect(host.querySelector('[data-testid="einvoice-design-palette-meta-invoice_date"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-meta-issue_time"]')).not.toBeNull();
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
    host.querySelector('[data-testid="einvoice-design-show-meta-invoice_date"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-show-meta-issue_time"]').click();
  });
  const meta = host.querySelector('[data-testid="einvoice-design-block-meta"]')?.textContent || "";
  expect(meta).toContain("SIP-2026-0142");
  expect(meta).toContain("Sipariş numarası");
  expect(meta).toContain("Fatura numarası");
  expect(meta).toContain("Fatura tarihi");
  expect(meta).toContain("Düzenleme tarihi");
  expect(meta).toContain("Düzenleme zamanı");
  expect(meta).toContain("14:32:05");
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
  expect(totals).toContain("300,00");
  expect(totals).toContain("15.600,00");
});

test("adds stock, vat and GIB QR fields from palette", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-col-sku"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-col-show-sku"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-qr"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-gib_seal"]')).not.toBeNull();
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
    host.querySelector('[data-testid="einvoice-design-show-gib_seal"]').click();
  });
  const seal = host.querySelector('[data-testid="einvoice-design-gib-seal"]');
  expect(seal).not.toBeNull();
  expect(seal?.textContent).toContain("e-FATURA");
  expect(seal?.querySelector("img")?.getAttribute("alt")).toBe("E-Fatura Logo");
  expect(seal?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
});

test("GIB seal caption follows e-Arşiv kind", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <EinvoiceDesignCanvas
        layout={normalizeLayout({ kind: "e_archive", blocks: [{ id: "gib_seal" }] }, "e_archive")}
        kind="e_archive"
        onChange={(n) => { last = n; }}
      />
    );
  });
  const seal = host.querySelector('[data-testid="einvoice-design-gib-seal"]');
  expect(seal?.textContent).toContain("e-Arşiv Fatura");
  expect(seal?.querySelector("img")?.getAttribute("alt")).toBe("E-Arşiv Logo");
});

test("meta fields stack vertically at 1/3 width", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  const full = host.querySelector('[data-testid="einvoice-design-meta-grid"]');
  expect(full?.className).toContain("grid-cols-4");
  expect(full?.className).not.toContain("grid-cols-1");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-span-meta-4"]').click();
  });
  expect(last.blocks.find((b) => b.id === "meta").span).toBe(4);
  expect(host.querySelector('[data-testid="einvoice-design-block-meta"]').className).toContain("col-span-4");
  const stacked = host.querySelector('[data-testid="einvoice-design-meta-grid"]');
  expect(stacked?.className).toContain("grid-cols-1");
  expect(stacked?.textContent).toContain("Düzenleme tarihi");
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
