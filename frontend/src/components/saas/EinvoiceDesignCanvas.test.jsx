import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { EinvoiceDesignCanvas } from "./EinvoiceDesignCanvas";
import { defaultLayout } from "../../utils/einvoiceDesignLayout";

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
  expect(host.querySelector('[data-testid="einvoice-design-block-lines"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-iban"]')).toBeNull();

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

test("move down swaps header with next visible block", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-down-header"]').click();
  });
  expect(last.blocks[0].id).toBe("parties");
  expect(last.blocks[1].id).toBe("header");
});

test("adds stock, vat and GIB QR fields from palette", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
  expect(host.querySelector('[data-testid="einvoice-design-col-sku"]')).toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-col-show-sku"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-palette-qr"]')).not.toBeNull();
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
  expect(host.querySelector('[data-testid="einvoice-design-block-balance"]')?.textContent).toContain("18.450,00 TL Borç");
});
