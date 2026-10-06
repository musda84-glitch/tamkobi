import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { EinvoiceDesignsPanel } from "./EinvoiceDesignsPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const LIST = {
  kinds: [{ id: "e_invoice", label: "e-Fatura" }, { id: "e_archive", label: "e-Arşiv" }],
  selected: { e_invoice: "einvoice_xslt_default_e_invoice", e_archive: "einvoice_xslt_default_e_archive" },
  items: [
    { id: "einvoice_xslt_default_e_invoice", name: "Varsayılan e-Fatura", kind: "e_invoice", is_builtin: true, is_selected: true, xslt_bytes: 170000 },
    { id: "einvoice_xslt_custom", name: "Özel e-Fatura", kind: "e_invoice", is_builtin: false, is_selected: false, xslt_bytes: 1200 },
    { id: "einvoice_xslt_default_e_archive", name: "Varsayılan e-Arşiv", kind: "e_archive", is_builtin: true, is_selected: true, xslt_bytes: 100000 },
  ],
};

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.endsWith("/system/einvoice-designs")) return Promise.resolve({ data: LIST });
    if (u.includes("/download")) return Promise.resolve({ data: new Blob(["<xsl:stylesheet/>"]) });
    if (u.includes("/einvoice-designs/")) return Promise.resolve({ data: { ...LIST.items[0], xslt: "<xsl:stylesheet/>" } });
    return Promise.resolve({ data: LIST });
  });
  axios.post.mockResolvedValue({ data: { id: "einvoice_xslt_copy", name: "Varsayılan e-Fatura kopya", kind: "e_invoice", xslt: "<xsl:stylesheet/>", items: LIST.items } });
  axios.put.mockResolvedValue({ data: { ...LIST.items[0], name: "Güncel", xslt: "<xsl:stylesheet/>" } });
});

afterEach(() => {
  host.remove();
});

test("lists designs, opens editor and has download", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<EinvoiceDesignsPanel />);
  });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="einvoice-designs-panel"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-row-einvoice_xslt_default_e_invoice"]')?.textContent).toContain("Varsayılan e-Fatura");
  expect(host.querySelector('[data-testid="einvoice-design-download-einvoice_xslt_default_e_invoice"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-row-einvoice_xslt_custom"]')?.textContent).toContain("Özel e-Fatura");
  expect(host.querySelector('[data-testid="einvoice-design-kind-e_archive"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-edit-einvoice_xslt_default_e_invoice"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="einvoice-design-xslt"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-save"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-editor-download"]')).not.toBeNull();
});
