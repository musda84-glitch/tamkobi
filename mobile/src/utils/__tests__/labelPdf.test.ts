type PrintCall = { html?: string; width?: number; height?: number };

const printAsync = jest.fn<Promise<void>, [PrintCall]>(async () => undefined);
const printToFileAsync = jest.fn<Promise<{ uri: string }>, [PrintCall]>(async () => ({ uri: "file:///cache/etiket.pdf" }));
const shareAsync = jest.fn<Promise<void>, [string, { mimeType?: string; dialogTitle?: string }]>(async () => undefined);
const isAvailableAsync = jest.fn(async () => true);
const get = jest.fn();

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Alert: { alert: jest.fn() },
  Share: { share: jest.fn(async () => ({ action: "sharedAction" })) },
}));

jest.mock("expo-print", () => ({
  printAsync: (opts: PrintCall) => printAsync(opts),
  printToFileAsync: (opts: PrintCall) => printToFileAsync(opts),
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => isAvailableAsync(),
  shareAsync: (uri: string, opts: { mimeType?: string; dialogTitle?: string }) => shareAsync(uri, opts),
}));

jest.mock("expo-file-system", () => ({
  File: class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = `file:///cache/${parts[parts.length - 1] || "file"}`;
    }
    create() { return this; }
    write() { return Promise.resolve(); }
    preview() { return Promise.resolve(); }
  },
  Paths: { cache: "file:///cache" },
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("../../api/client", () => ({
  get: (...args: unknown[]) => get(...args),
  post: jest.fn(),
  put: jest.fn(),
}));

import { printProductLabelsPdf, printShipmentLabelsPdf } from "../labelPdf";

const client = { baseUrl: "https://example.com", token: null };

const companyTemplate = {
  id: "tpl-firma",
  name: "Firma",
  is_default: true,
  width_mm: 60,
  height_mm: 40,
  elements: [
    { type: "field", field: "text", text: "FIRMA-SABLON", x: 1, y: 1, w: 40, h: 6, font: 8 },
    { type: "field", field: "name", x: 1, y: 8, w: 50, h: 8, font: 10, bold: true },
    { type: "field", field: "price", x: 1, y: 18, w: 40, h: 8, font: 12, bold: true, vat: "incl" },
  ],
};

const product = {
  name: "Vida",
  sku: "V-1",
  barcode: "ABC-1",
  sale_price: 80,
  vat_rate: 0,
  price_includes_vat: true,
  label_template_id: "tpl-firma",
};

function labelCount(html: string): number {
  return html.split('data-testid="pick-product-label"').length - 1;
}

function lastHtml(calls: Array<[PrintCall]>): string {
  const html = calls[calls.length - 1]?.[0]?.html || "";
  if (!html) throw new Error("missing html");
  return html;
}

beforeEach(() => {
  printAsync.mockReset().mockResolvedValue(undefined);
  printToFileAsync.mockReset().mockResolvedValue({ uri: "file:///cache/etiket.pdf" });
  shareAsync.mockReset().mockResolvedValue(undefined);
  isAvailableAsync.mockReset().mockResolvedValue(true);
  get.mockReset();
});

describe("printProductLabelsPdf", () => {
  it("uses the company template when one exists, otherwise the builtin template", async () => {
    get.mockResolvedValue([companyTemplate]);
    await printProductLabelsPdf(client, "c1", [{ product, copies: 2, includePrice: true }], "print");
    expect(get).toHaveBeenCalledWith(client, "/label-templates", { company_id: "c1" });
    const companyHtml = lastHtml(printAsync.mock.calls);
    expect(companyHtml).toContain("FIRMA-SABLON");
    expect(companyHtml).toContain("Vida");
    expect(labelCount(companyHtml)).toBe(2);
    expect(printAsync.mock.calls[0][0]).toEqual(expect.objectContaining({ width: 227, height: 151 }));

    printAsync.mockClear();
    get.mockResolvedValue([]);
    await printProductLabelsPdf(client, "c1", [{
      product: { ...product, label_template_id: null },
      copies: 1,
      includePrice: true,
    }], "print");
    const builtinHtml = lastHtml(printAsync.mock.calls);
    expect(builtinHtml).not.toContain("FIRMA-SABLON");
    expect(builtinHtml).toContain("Vida");
    expect(builtinHtml).toContain("@page{size:50mm 30mm");
    expect(builtinHtml).toContain("<svg");
    expect(printAsync.mock.calls[0][0]).toEqual(expect.objectContaining({ width: 189, height: 113 }));
  });

  it("prints one label card per copy", async () => {
    get.mockResolvedValue([companyTemplate]);
    await printProductLabelsPdf(client, "c1", [{ product, copies: 3, includePrice: true }], "print");
    expect(labelCount(lastHtml(printAsync.mock.calls))).toBe(3);
  });

  it("calls system print, then falls back to a PDF file", async () => {
    get.mockResolvedValue([companyTemplate]);
    await printProductLabelsPdf(client, "c1", [{ product, copies: 1, includePrice: true }], "print");
    expect(printAsync).toHaveBeenCalledTimes(1);
    expect(printToFileAsync).not.toHaveBeenCalled();
    const px = { width: printAsync.mock.calls[0][0].width, height: printAsync.mock.calls[0][0].height };

    printAsync.mockRejectedValueOnce(new Error("yazıcı yok"));
    await printProductLabelsPdf(client, "c1", [{ product, copies: 1, includePrice: true }], "print");
    expect(printToFileAsync).toHaveBeenCalledTimes(1);
    expect(printToFileAsync.mock.calls[0][0]).toEqual(expect.objectContaining(px));
    expect(shareAsync).toHaveBeenCalledWith("file:///cache/etiket.pdf", expect.objectContaining({
      mimeType: "application/pdf",
    }));
  });

  it("shares a PDF directly in pdf mode", async () => {
    get.mockResolvedValue([companyTemplate]);
    const ok = await printProductLabelsPdf(client, "c1", [{ product, copies: 1, includePrice: true }], "pdf");
    expect(ok).toBe(true);
    expect(printAsync).not.toHaveBeenCalled();
    expect(printToFileAsync).toHaveBeenCalledTimes(1);
    expect(shareAsync).toHaveBeenCalledWith("file:///cache/etiket.pdf", expect.objectContaining({
      mimeType: "application/pdf",
      dialogTitle: expect.stringMatching(/\.pdf$/),
    }));
  });

  it("omits the price from the HTML when includePrice is false", async () => {
    get.mockResolvedValue([companyTemplate]);
    await printProductLabelsPdf(client, "c1", [{ product, copies: 1, includePrice: true }], "pdf");
    const withPrice = lastHtml(printToFileAsync.mock.calls);
    expect(withPrice).toContain("₺");
    expect(withPrice).toMatch(/80[,.]00/);

    printToFileAsync.mockClear();
    await printProductLabelsPdf(client, "c1", [{ product, copies: 1, includePrice: false }], "pdf");
    const withoutPrice = lastHtml(printToFileAsync.mock.calls);
    expect(withoutPrice).toContain("Vida");
    expect(withoutPrice).toContain("FIRMA-SABLON");
    expect(withoutPrice).not.toContain("₺");
    expect(withoutPrice).not.toMatch(/80[,.]00/);
  });
});

describe("printShipmentLabelsPdf", () => {
  it("prints one page per box with x/n text", async () => {
    const ok = await printShipmentLabelsPdf(client, "c1", {
      orderNo: "SIP-10",
      customer: "Ayşe Yılmaz",
      address: "Moda Cad. No 4",
      packageTotal: 3,
    }, "pdf");
    expect(ok).toBe(true);
    expect(printAsync).not.toHaveBeenCalled();
    const html = lastHtml(printToFileAsync.mock.calls);
    expect(labelCount(html)).toBe(3);
    expect(html).toContain("Koli 1/3");
    expect(html).toContain("Koli 2/3");
    expect(html).toContain("Koli 3/3");
    expect(html).toContain("SIP-10");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Moda Cad. No 4");
    expect(printToFileAsync.mock.calls[0][0]).toEqual(expect.objectContaining({ width: 378, height: 189 }));
    expect(shareAsync).toHaveBeenCalled();
  });

  it("uses system print for shipment labels and falls back to PDF", async () => {
    await printShipmentLabelsPdf(client, "c1", {
      orderNo: "SIP-2",
      customer: "Cari",
      address: "Adres",
      packageTotal: 2,
    }, "print");
    expect(printAsync).toHaveBeenCalledTimes(1);
    expect(lastHtml(printAsync.mock.calls)).toContain("Koli 1/2");
    expect(lastHtml(printAsync.mock.calls)).toContain("Koli 2/2");
    expect(printToFileAsync).not.toHaveBeenCalled();

    printAsync.mockRejectedValueOnce(new Error("iptal"));
    await printShipmentLabelsPdf(client, "c1", { orderNo: "SIP-2", packageTotal: 1 }, "print");
    expect(printToFileAsync).toHaveBeenCalledTimes(1);
    expect(shareAsync).toHaveBeenCalled();
  });
});
