type PrintCall = { html?: string; uri?: string; width?: number; height?: number };

const printAsync = jest.fn<Promise<void>, [PrintCall]>(async () => undefined);
const printToFileAsync = jest.fn<Promise<{ uri: string }>, [PrintCall]>(async () => ({ uri: "file:///cache/out.pdf" }));
const shareAsync = jest.fn<Promise<void>, [string, { mimeType?: string }]>(async () => undefined);
const isAvailableAsync = jest.fn(async () => true);
const rnShare = jest.fn(async (_opts?: unknown) => ({ action: "sharedAction" }));
const platform = { OS: "android" };
const fileWrite = jest.fn(async (_bytes: Uint8Array) => undefined);

jest.mock("react-native", () => ({
  Platform: platform,
  Share: { share: (opts: unknown) => rnShare(opts) },
  Linking: { canOpenURL: jest.fn(async () => false), openURL: jest.fn(async () => undefined) },
}));

jest.mock("expo-print", () => ({
  printAsync: (opts: PrintCall) => printAsync(opts),
  printToFileAsync: (opts: PrintCall) => printToFileAsync(opts),
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => isAvailableAsync(),
  shareAsync: (uri: string, opts: { mimeType?: string }) => shareAsync(uri, opts),
}));

jest.mock("expo-file-system", () => ({
  File: class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = typeof parts[0] === "string" && parts.length === 1 && String(parts[0]).startsWith("file:")
        ? String(parts[0])
        : `file:///cache/${parts[parts.length - 1] || "file"}`;
    }
    create() { return this; }
    write(bytes: Uint8Array) { return fileWrite(bytes); }
    preview() { return Promise.resolve(); }
  },
  Paths: { cache: "file:///cache" },
}));

import { printCargoLabel, printOrderForm } from "./orderShare";

const order = {
  id: "ord-1",
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
  grand_total: 17550,
  order_date: "2026-09-06",
  items: [{ product_name: "Koltuk", quantity: 1, unit_price: 14625, total: 14625 }],
};

function pdfBlob(): Blob {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  return new Blob([bytes], { type: "application/pdf" });
}

function lastPrint(): PrintCall {
  const call = printAsync.mock.calls[printAsync.mock.calls.length - 1];
  if (!call?.[0]) throw new Error("printAsync was not called");
  return call[0];
}

describe("orderShare native print", () => {
  beforeEach(() => {
    platform.OS = "android";
    printAsync.mockClear().mockResolvedValue(undefined);
    printToFileAsync.mockClear().mockResolvedValue({ uri: "file:///cache/out.pdf" });
    shareAsync.mockClear();
    isAvailableAsync.mockClear().mockResolvedValue(true);
    rnShare.mockClear();
    fileWrite.mockClear();
    (globalThis as { fetch: typeof fetch }).fetch = jest.fn() as typeof fetch;
  });

  it("prints the sipariş formu as HTML, not a text share", async () => {
    const ok = await printOrderForm(order, { name: "Matek" }, null);
    expect(ok).toBe(true);
    expect(printAsync).toHaveBeenCalledTimes(1);
    const html = lastPrint().html || "";
    expect(html).toContain("SİPARİŞ FORMU");
    expect(html).toContain("11573451170");
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("window.print");
    expect(lastPrint().width).toBe(595);
    expect(rnShare).not.toHaveBeenCalled();
  });

  it("prints the thermal kargo etiketi as HTML when there is no official file", async () => {
    const kind = await printCargoLabel(order, { name: "Matek" }, null);
    expect(kind).toBe("thermal");
    expect(printAsync).toHaveBeenCalledTimes(1);
    const opts = lastPrint();
    expect(opts.html).toContain("ALICI");
    expect(opts.html).toContain("Hatice YILDIRIM");
    expect(opts.html).toContain("100mm 150mm");
    expect(opts.width).toBe(284);
    expect(opts.height).toBe(425);
    expect(rnShare).not.toHaveBeenCalled();
  });

  it("prints the official cargo PDF instead of sharing label text", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      headers: { get: () => "application/pdf" },
      blob: async () => pdfBlob(),
    });
    const kind = await printCargoLabel(order, { name: "Matek" }, { baseUrl: "https://tamkobi.com", token: "t" });
    expect(kind).toBe("official");
    expect(printAsync).toHaveBeenCalledWith({ uri: expect.stringContaining("kargo-11573451170.pdf") });
    expect(rnShare).not.toHaveBeenCalled();
    expect(lastPrint().html).toBeUndefined();
  });

  it("falls back to a PDF file share, still not text, if the printer dialog fails", async () => {
    printAsync.mockRejectedValue(new Error("no printer"));
    const ok = await printOrderForm(order, { name: "Matek" }, null);
    expect(ok).toBe(true);
    expect(printToFileAsync).toHaveBeenCalled();
    expect(shareAsync).toHaveBeenCalledWith(
      "file:///cache/out.pdf",
      expect.objectContaining({ mimeType: "application/pdf" }),
    );
    expect(rnShare).not.toHaveBeenCalled();
  });
});
