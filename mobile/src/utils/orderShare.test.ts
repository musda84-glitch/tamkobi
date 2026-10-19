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

import { embedPrintImages, printCargoLabel, printInvoiceForm, printOrderForm } from "./orderShare";
import { printQuoteForm } from "./quoteShare";

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

  it("prints the sipariş formu as PDF share first (native), not a text share", async () => {
    const ok = await printOrderForm(order, { name: "Matek" }, null);
    expect(ok).toBe(true);
    expect(printToFileAsync).toHaveBeenCalledTimes(1);
    const html = String(printToFileAsync.mock.calls[0]?.[0]?.html || "");
    expect(html).toContain("SİPARİŞ FORMU");
    expect(html).toContain("11573451170");
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("window.print");
    expect(html).not.toContain("<img ");
    expect(shareAsync).toHaveBeenCalledWith(
      "file:///cache/out.pdf",
      expect.objectContaining({ mimeType: "application/pdf" }),
    );
    expect(rnShare).not.toHaveBeenCalled();
  });

  it("omits unit price and amount columns when view_prices is off", async () => {
    const masked = {
      ...order,
      grand_total: 0,
      subtotal: 0,
      vat_total: 0,
      items: [{ product_name: "Koltuk", quantity: 2, unit_price: 0, total: 0, total_incl: 0 }],
    };
    const ok = await printOrderForm(masked, { name: "Matek" }, null, { showPrices: false });
    expect(ok).toBe(true);
    const html = String(printToFileAsync.mock.calls[0]?.[0]?.html || "");
    expect(html).toContain("Koltuk");
    expect(html).not.toContain("0,00 ₺");
    expect(html).not.toContain("Tutar (KDV Dahil)");
    expect(html).not.toContain("Birim (KDV'siz)");
    expect(html).not.toContain("data-print-grand-total");
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

  it("prints a fatura with the web invoice template, not a text share", async () => {
    const ok = await printInvoiceForm({
      invoice_number: "SF-1",
      invoice_type: "sales",
      contact_name: "Hatice YILDIRIM",
      issue_date: "2026-09-21",
      grand_total: 1200,
      items: [{ product_name: "Koltuk", quantity: 1, unit_price: 1000, total: 1000 }],
    }, { name: "Matek" }, null);
    expect(ok).toBe(true);
    const html = String(printToFileAsync.mock.calls[0]?.[0]?.html || "");
    expect(html).toContain("FATURA");
    expect(html).toContain("SF-1");
    expect(html).toContain("data-print=\"invoice\"");
    expect(rnShare).not.toHaveBeenCalled();
  });

  it("falls back to printer dialog if PDF file share fails", async () => {
    printToFileAsync.mockRejectedValue(new Error("pdf fail"));
    const ok = await printOrderForm(order, { name: "Matek" }, null);
    expect(ok).toBe(true);
    expect(printAsync).toHaveBeenCalled();
    expect(rnShare).not.toHaveBeenCalled();
  });
});

const imageOrder = {
  ...order,
  items: [{ product_id: "p1", product_name: "Koltuk", quantity: 1, unit_price: 14625, total: 14625 }],
};

const client = { baseUrl: "https://tamkobi.com", token: "secret-token" };
const company = { id: "c1", name: "Matek" };

function jsonResponse(data: unknown) {
  const text = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    url: "",
    redirected: false,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    text: async () => text,
    json: async () => data,
    blob: async () => new Blob([text], { type: "application/json" }),
  };
}

function pngResponse() {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return {
    ok: true,
    status: 200,
    url: "",
    redirected: false,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "image/png" : null) },
    blob: async () => new Blob([bytes], { type: "image/png" }),
    arrayBuffer: async () => bytes.buffer,
    text: async () => "",
  };
}

function fileCalls(): [string, { headers?: Record<string, string> }?][] {
  return (globalThis.fetch as jest.Mock).mock.calls.filter((call) => String(call[0]).includes("/api/files/"));
}

function installPrintFetch(opts?: {
  orderTemplate?: Record<string, unknown>;
  quoteTemplate?: Record<string, unknown>;
  products?: unknown[];
  files?: "png" | "error" | "hang";
}) {
  const orderTemplate = opts?.orderTemplate ?? { show_images: true, show_logo: false };
  const quoteTemplate = opts?.quoteTemplate ?? { show_images: true, show_logo: false };
  const products = opts?.products ?? [{ id: "p1", thumbnail_url: "/api/files/products/a.jpg" }];
  (globalThis.fetch as jest.Mock).mockImplementation(async (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    const u = String(url);
    if (u.includes("/api/files/")) {
      if (opts?.files === "error") {
        return { ok: false, status: 500, url: u, headers: { get: () => null }, text: async () => "", blob: async () => new Blob() };
      }
      if (opts?.files === "hang") {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort);
        });
      }
      return pngResponse();
    }
    if (u.includes("/print-templates")) {
      return jsonResponse({ order: orderTemplate, invoice: orderTemplate, dispatch: orderTemplate, quote: quoteTemplate });
    }
    if (u.includes("/products")) return jsonResponse(products);
    if (u.includes("/contacts")) return jsonResponse([]);
    if (u.includes("/companies/")) return jsonResponse({ id: "c1", name: "Matek" });
    return jsonResponse({});
  });
}

function printedHtml(): string {
  return String(printToFileAsync.mock.calls[0]?.[0]?.html || "");
}

function imgSrcs(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
}

describe("orderShare native print images", () => {
  beforeEach(() => {
    platform.OS = "android";
    printAsync.mockClear().mockResolvedValue(undefined);
    printToFileAsync.mockClear().mockResolvedValue({ uri: "file:///cache/out.pdf" });
    shareAsync.mockClear();
    isAvailableAsync.mockClear().mockResolvedValue(true);
    rnShare.mockClear();
    (globalThis as { fetch: typeof fetch }).fetch = jest.fn() as typeof fetch;
  });

  it("embeds product images as data urls when show_images is on", async () => {
    installPrintFetch();
    const ok = await printOrderForm(imageOrder, company, client);
    expect(ok).toBe(true);
    const urls = (globalThis.fetch as jest.Mock).mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes("/products"))).toBe(true);
    expect(fileCalls().map((call) => call[0])).toEqual([
      "https://tamkobi.com/api/files/products/a.jpg?w=128&fmt=jpg",
    ]);
    expect(fileCalls()[0]?.[1]?.headers?.Authorization).toBe("Bearer secret-token");
    const html = printedHtml();
    expect(html).toContain("<img");
    const srcs = imgSrcs(html);
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((src) => src.startsWith("data:image/"))).toBe(true);
    expect(html).not.toMatch(/<img\b[^>]*\ssrc=["']https?:/i);
  });

  it("skips product image fetches when show_images is off and embeds the logo only if show_logo is on", async () => {
    installPrintFetch({
      orderTemplate: { show_images: false, show_logo: true },
      products: [{ id: "p1", thumbnail_url: "/api/files/products/a.jpg" }],
    });
    const ok = await printOrderForm(imageOrder, { ...company, logo_url: "/api/files/brand/logo.png" }, client);
    expect(ok).toBe(true);
    const urls = (globalThis.fetch as jest.Mock).mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes("/products"))).toBe(true);
    expect(fileCalls().map((call) => String(call[0]))).toEqual([
      "https://tamkobi.com/api/files/brand/logo.png?w=128&fmt=jpg",
    ]);
    const html = printedHtml();
    expect(html).not.toContain("/api/files/products/a.jpg");
    expect(html).not.toContain("products/a.jpg");
    const srcs = imgSrcs(html);
    expect(srcs).toHaveLength(1);
    expect(srcs[0].startsWith("data:image/")).toBe(true);
    expect(html).toContain('alt="logo"');
  });

  it("still prints and drops the image when the file fetch fails", async () => {
    installPrintFetch({ files: "error" });
    const ok = await printOrderForm(imageOrder, company, client);
    expect(ok).toBe(true);
    const html = printedHtml();
    expect(html).toContain("SİPARİŞ FORMU");
    expect(html).toContain("Koltuk");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/src=["']https?:/i);
  });

  it("still prints and drops the image when the file fetch times out", async () => {
    jest.useFakeTimers();
    try {
      installPrintFetch({ files: "hang" });
      const pending = printOrderForm(imageOrder, company, client);
      await jest.advanceTimersByTimeAsync(4000);
      const ok = await pending;
      expect(ok).toBe(true);
      const html = printedHtml();
      expect(html).toContain("SİPARİŞ FORMU");
      expect(html).not.toContain("<img");
      expect(html).not.toMatch(/src=["']https?:/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it("fetches at most 40 images and leaves no remote src", async () => {
    let fetches = 0;
    (globalThis.fetch as jest.Mock).mockImplementation(async (url: string) => {
      fetches += 1;
      expect(String(url)).toContain("https://tamkobi.com/api/files/products/");
      expect(String(url)).toContain("?w=128&fmt=jpg");
      expect(String(url)).not.toMatch(/\?w=128&fmt=jpg.*\?/);
      return pngResponse();
    });
    const html = Array.from({ length: 45 }, (_, i) => `<img src="/api/files/products/${i}.jpg" alt="">`).join("");
    const out = await embedPrintImages(html, "https://tamkobi.com", "secret-token");
    expect(fetches).toBe(40);
    expect(imgSrcs(out)).toHaveLength(40);
    expect(imgSrcs(out).every((src) => src.startsWith("data:image/"))).toBe(true);
    expect(out).not.toMatch(/src=["']https?:/i);
    expect(out).not.toContain("/api/files/");
    const first = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(first[0]).toBe("https://tamkobi.com/api/files/products/0.jpg?w=128&fmt=jpg");
    expect(first[1]?.headers?.Authorization).toBe("Bearer secret-token");
  });

  it("sends the api base header the same way as other authenticated file fetches", async () => {
    const prevDocument = (globalThis as { document?: unknown }).document;
    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { document?: unknown }).document = {};
    (globalThis as { window?: { location?: { origin?: string } } }).window = {
      location: { origin: "http://localhost:8081" },
    };
    (globalThis.fetch as jest.Mock).mockImplementation(async () => pngResponse());
    try {
      await embedPrintImages(
        `<img src="https://tamkobi.com/api/files/products/a.jpg" alt="">`,
        "https://tamkobi.com",
        "secret-token",
      );
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe("http://localhost:8081/api/files/products/a.jpg?w=128&fmt=jpg");
      expect(init?.headers?.Authorization).toBe("Bearer secret-token");
      expect(init?.headers?.["x-tamkobi-api-base"]).toBe("https://tamkobi.com");
    } finally {
      if (prevDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = prevDocument;
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prevWindow;
    }
  });

  it("does not rewrite /api/files urls that already have a query", async () => {
    (globalThis.fetch as jest.Mock).mockImplementation(async () => pngResponse());
    const html = `<img src="https://tamkobi.com/api/files/products/a.jpg?t=9" alt="">`;
    const out = await embedPrintImages(html, "https://tamkobi.com", "secret-token");
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe("https://tamkobi.com/api/files/products/a.jpg?t=9");
    expect(imgSrcs(out)[0].startsWith("data:image/")).toBe(true);
  });

  it("keeps remote image urls on web", async () => {
    platform.OS = "web";
    const written: string[] = [];
    const prevDocument = (globalThis as { document?: unknown }).document;
    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { document?: unknown }).document = {};
    (globalThis as { window?: unknown }).window = {
      open: () => ({
        document: {
          write: (html: string) => { written.push(html); },
          close: () => undefined,
        },
      }),
    };
    installPrintFetch();
    try {
      const ok = await printOrderForm(imageOrder, company, client);
      expect(ok).toBe(true);
      const html = written.join("");
      expect(html).toContain("<img");
      expect(html).toContain("https://tamkobi.com/api/files/products/a.jpg");
      expect(html).not.toContain("data:image/");
      expect(html).not.toContain("?w=128");
      expect(fileCalls()).toHaveLength(0);
      expect(printToFileAsync).not.toHaveBeenCalled();
    } finally {
      platform.OS = "android";
      if (prevDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = prevDocument;
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prevWindow;
    }
  });

  it("embeds quote images on the same native print path", async () => {
    installPrintFetch({ quoteTemplate: { show_images: true, show_logo: false } });
    const ok = await printQuoteForm({
      quote_number: "TKF-1",
      contact_name: "AHMET",
      items: [{ product_id: "p1", name: "Raf", quantity: 1, unit_price: 10, vat_rate: 20, unit: "Adet" }],
    }, company, client);
    expect(ok).toBe(true);
    const html = String(printAsync.mock.calls[0]?.[0]?.html || "");
    expect(html).toContain("FİYAT TEKLİFİ");
    expect(imgSrcs(html).every((src) => src.startsWith("data:image/"))).toBe(true);
    expect(html).not.toMatch(/<img\b[^>]*\ssrc=["']https?:/i);
  });
});
