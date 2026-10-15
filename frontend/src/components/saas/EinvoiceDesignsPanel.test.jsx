import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { EinvoiceDesignsPanel } from "./EinvoiceDesignsPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const LIST = {
  kinds: [
    { id: "e_invoice", label: "e-Fatura" },
    { id: "e_archive", label: "e-Arşiv" },
    { id: "e_dispatch", label: "e-İrsaliye" },
  ],
  selected: {
    e_invoice: "einvoice_xslt_default_e_invoice",
    e_archive: "einvoice_xslt_default_e_archive",
    e_dispatch: "einvoice_xslt_default_e_dispatch",
  },
  items: [
    { id: "einvoice_xslt_default_e_invoice", name: "Varsayılan e-Fatura", kind: "e_invoice", is_builtin: true, is_selected: true, xslt_bytes: 170000 },
    { id: "einvoice_xslt_custom", name: "Özel e-Fatura", kind: "e_invoice", is_builtin: false, is_selected: false, xslt_bytes: 1200 },
    { id: "einvoice_xslt_default_e_archive", name: "Varsayılan e-Arşiv", kind: "e_archive", is_builtin: true, is_selected: true, xslt_bytes: 100000 },
    { id: "einvoice_xslt_default_e_dispatch", name: "Klasik (İşNet örneği)", kind: "e_dispatch", is_builtin: true, is_selected: true, xslt_bytes: 12000 },
  ],
};

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/system/companies")) {
      return Promise.resolve({ data: [{ id: "co_a", name: "A Firması" }, { id: "co_b", name: "B Firması" }] });
    }
    if (u.includes("/download")) return Promise.resolve({ data: new Blob(["<xsl:stylesheet/>"]) });
    if (u.includes("/export")) return Promise.resolve({ data: new Blob(['{"schema_version":1}']) });
    if (u.includes("/einvoice-designs/")) {
      return Promise.resolve({
        data: { ...LIST.items[0], xslt: "<xsl:stylesheet/>", layout: null, source: "xslt", is_platform: u.includes("company_id=") },
      });
    }
    if (u.includes("/system/einvoice-designs")) return Promise.resolve({ data: LIST });
    return Promise.resolve({ data: LIST });
  });
  axios.post.mockResolvedValue({
    data: {
      id: "einvoice_xslt_copy",
      name: "Varsayılan e-Fatura kopya",
      kind: "e_invoice",
      xslt: "<xsl:stylesheet/>",
      source: "xslt",
      items: LIST.items,
    },
  });
  axios.put.mockResolvedValue({
    data: { ...LIST.items[0], name: "Güncel", xslt: "<xsl:stylesheet/>", source: "xslt", layout: null },
  });
});

afterEach(() => {
  host.remove();
  jest.restoreAllMocks();
});

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

async function chooseCompany(value = "__platform__") {
  const sel = host.querySelector('[data-testid="einvoice-design-company-select"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  await flush();
}

test("lists designs, opens editor and has download", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<EinvoiceDesignsPanel />);
  });
  await flush();
  expect(host.querySelector('[data-testid="einvoice-design-company-select"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-company-hint"]')?.textContent).toMatch(/firma seçin/i);
  expect(host.querySelector('[data-testid="einvoice-design-row-einvoice_xslt_default_e_invoice"]')).toBeNull();
  await chooseCompany("__platform__");
  expect(host.querySelector('[data-testid="einvoice-designs-panel"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-row-einvoice_xslt_default_e_invoice"]')?.textContent).toContain("Varsayılan e-Fatura");
  expect(host.querySelector('[data-testid="einvoice-design-download-einvoice_xslt_default_e_invoice"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-row-einvoice_xslt_custom"]')?.textContent).toContain("Özel e-Fatura");
  expect(host.querySelector('[data-testid="einvoice-design-kind-e_archive"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-edit-einvoice_xslt_default_e_invoice"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="einvoice-design-canvas"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-preview"]')?.textContent).toContain("Fatura No");
  expect(host.querySelector('[data-testid="einvoice-design-xslt"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-tab-xslt"]').click();
  });
  expect(host.querySelector('[data-testid="einvoice-design-xslt"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-save"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-editor-download"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-export-tkdesign"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-import-btn"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-source-badge"]')?.textContent).toMatch(/XSLT/i);
});

test("save from xslt source omits layout payload", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<EinvoiceDesignsPanel />);
  });
  await flush();
  await chooseCompany("__platform__");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-edit-einvoice_xslt_default_e_invoice"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-tab-xslt"]').click();
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-save"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(axios.put).toHaveBeenCalled();
  const body = axios.put.mock.calls[0][1];
  expect(body.source).toBe("xslt");
  expect(body.layout).toBeNull();
  expect(body.xslt).toBeTruthy();
});

test("selected company uses system endpoint and does not call tenant designs API", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(<EinvoiceDesignsPanel />);
  });
  await flush();
  await chooseCompany("co_a");
  expect(axios.get.mock.calls.some((c) => String(c[0]).includes("/system/einvoice-designs") && String(c[0]).includes("company_id=co_a"))).toBe(true);
  expect(axios.get.mock.calls.some((c) => String(c[0]).includes("/einvoice/designs"))).toBe(false);
  expect(host.querySelector('[data-testid="einvoice-isnet-logo-hint"]')?.textContent).toMatch(/NetteFatura/);
  expect(host.querySelector('[data-testid="einvoice-design-upload-btn"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-new-btn"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-select-einvoice_xslt_custom"]').click();
  });
  await flush();
  expect(axios.post).toHaveBeenCalled();
  const selectUrl = String(axios.post.mock.calls[0][0]);
  expect(selectUrl).toContain("/system/einvoice-designs/einvoice_xslt_custom/select");
  expect(selectUrl).toContain("company_id=co_a");
  const body = axios.post.mock.calls[0][1];
  expect(body.company_id).toBe("co_a");
});

async function openInvoiceDesign() {
  const root = createRoot(host);
  await act(async () => {
    root.render(<EinvoiceDesignsPanel />);
  });
  await flush();
  await chooseCompany("__platform__");
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-edit-einvoice_xslt_default_e_invoice"]').click();
  });
  await flush();
  return root;
}

test("dirty kind switch cancelled keeps kind", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(false);
  await openInvoiceDesign();
  const name = host.querySelector('[data-testid="einvoice-design-name"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(name, "Kaydedilmedi");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-kind-e_dispatch"]').click();
  });
  expect(window.confirm).toHaveBeenCalledWith("Kaydedilmemiş değişiklikler kaybolacak. Devam?");
  expect(host.querySelector('[data-testid="einvoice-design-row-einvoice_xslt_default_e_invoice"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-kind-e_invoice"]').className).toMatch(/text-slate-900/);
  expect(host.querySelector('[data-testid="einvoice-design-canvas"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="einvoice-design-name"]')?.value).toBe("Kaydedilmedi");
});

test("xslt source canvas change cancelled keeps source", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(false);
  await openInvoiceDesign();
  expect(host.querySelector('[data-testid="einvoice-design-source-badge"]')?.textContent).toMatch(/XSLT/i);
  expect(host.querySelector('[data-testid="einvoice-design-block-iban"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="einvoice-design-hide-iban"]').click();
  });
  expect(window.confirm).toHaveBeenCalledWith("Görsel düzenleme kaydedilince elle yazılmış XSLT yerine üretilen XSLT kaydedilir");
  expect(host.querySelector('[data-testid="einvoice-design-source-badge"]')?.textContent).toMatch(/XSLT/i);
  expect(host.querySelector('[data-testid="einvoice-design-source-badge"]')?.textContent).not.toMatch(/görsel/i);
  expect(host.querySelector('[data-testid="einvoice-design-block-iban"]')).not.toBeNull();
});
