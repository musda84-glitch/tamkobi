const alert = jest.fn();
const get = jest.fn();
const templateLabelDocumentHtml = jest.fn((..._args: unknown[]) => ({ html: "<html></html>", widthMm: 50, heightMm: 30 }));
const written: Uint8Array[] = [];
let tcpFail: Error | null = null;

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Alert: {
    alert: (...args: unknown[]) => alert(...args),
  },
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

jest.mock("react-native-tcp-socket", () => ({
  __esModule: true,
  createConnection() {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    return {
      write(data: Uint8Array, _enc?: string, cb?: () => void) {
        written.push(Uint8Array.from(data));
        cb?.();
      },
      on(event: string, cb: (arg?: unknown) => void) {
        handlers[event] = cb;
        if (event === "connect") {
          queueMicrotask(() => {
            if (tcpFail) handlers.error?.(tcpFail);
            else cb();
          });
        }
      },
      destroy() {},
    };
  },
}));

jest.mock("../api/client", () => ({
  get: (...args: unknown[]) => get(...args),
}));

jest.mock("./ethernetPrinter", () => ({
  tryPrintLabelEthernet: jest.fn(async () => false),
}));

jest.mock("./labelPrinter", () => {
  const actual = jest.requireActual("./labelPrinter");
  return {
    ...actual,
    resolveLabelPrinter: jest.fn(async () => ({ host: "", port: 9100 })),
    printShipmentLabels: jest.fn(async () => ({ bytes: 1 })),
  };
});

jest.mock("./labelMedia", () => ({
  embedLabelHtmlImages: jest.fn(async (html: string) => html),
}));

jest.mock("./nativePrint", () => ({
  htmlToPdfFile: jest.fn(async () => false),
  printHtmlNative: jest.fn(async () => true),
}));

jest.mock("./orderPrint", () => ({
  safePrintFilename: (raw: unknown, fallback: string) => String(raw || fallback),
}));

jest.mock("./labelTemplateHtml", () => ({
  templateLabelDocumentHtml: (...args: unknown[]) => templateLabelDocumentHtml(...args),
}));

import { tryPrintLabelEthernet } from "./ethernetPrinter";
import { printShipmentLabels, resolveLabelPrinter } from "./labelPrinter";
import { loadTemplates, printPickProductLabels } from "./pickLabelPrint";
import { mmToDots } from "./tspl";

function tsplPayloads(): string[] {
  return written.map((bytes) => new TextDecoder("latin1").decode(bytes));
}

const printerSettings = {
  name: "Xprinter XP-490B",
  host: "192.168.1.117",
  port: 9100,
  widthMm: 100,
  heightMm: 50,
  gapMm: 3,
  dpi: 203 as const,
  textMode: "codepage" as const,
};

const client = { baseUrl: "https://example.com", token: null };
const FETCH_MSG = "Etiket şablonları alınamadı (oturum/firma). Hazır şablonla basılsın mı?";

type AlertButton = { text?: string; style?: string; onPress?: () => void };

beforeEach(() => {
  alert.mockReset();
  get.mockReset();
  written.length = 0;
  tcpFail = null;
  templateLabelDocumentHtml.mockClear();
  (resolveLabelPrinter as jest.Mock).mockReset();
  (resolveLabelPrinter as jest.Mock).mockResolvedValue({ host: "", port: 9100 });
  (printShipmentLabels as jest.Mock).mockClear();
  (tryPrintLabelEthernet as jest.Mock).mockReset();
  (tryPrintLabelEthernet as jest.Mock).mockResolvedValue(false);
});

describe("loadTemplates", () => {
  it("returns the fetch error instead of an empty silent list", async () => {
    const err = new Error("401");
    get.mockRejectedValue(err);
    await expect(loadTemplates(client, "c1")).resolves.toEqual({ list: [], error: err });
    expect(get).toHaveBeenCalledWith(client, "/label-templates", { company_id: "c1" });
  });

  it("returns the template list when the request succeeds", async () => {
    get.mockResolvedValue([{ id: "tpl_def", is_default: true }]);
    await expect(loadTemplates(client, "c1")).resolves.toEqual({
      list: [{ id: "tpl_def", is_default: true }],
      error: null,
    });
  });
});

describe("printPickProductLabels", () => {
  const line = {
    product_id: "p1",
    product_name: "MDF",
    ordered_qty: 1,
    label_template_id: "tpl_stock",
  };

  it("does not print when template fetch fails and the user declines", async () => {
    get.mockRejectedValue(new Error("down"));
    alert.mockImplementation((title: unknown, _message?: unknown, buttons?: AlertButton[]) => {
      if (title === FETCH_MSG) buttons?.find((button) => button.style === "cancel")?.onPress?.();
    });
    await expect(printPickProductLabels([line], { name: "Firma", id: "c1" }, "S1", {
      client,
      companyId: "c1",
    })).resolves.toEqual({ count: 0, ok: false });
    expect(alert).toHaveBeenCalledWith(FETCH_MSG, undefined, expect.any(Array), expect.any(Object));
    expect(templateLabelDocumentHtml).not.toHaveBeenCalled();
  });

  it("prints the builtin template when the user confirms a fetch error", async () => {
    get.mockRejectedValue(new Error("down"));
    alert.mockImplementation((title: unknown, _message?: unknown, buttons?: AlertButton[]) => {
      if (title === FETCH_MSG) buttons?.find((button) => button.text === "Bas")?.onPress?.();
    });
    const res = await printPickProductLabels(
      [{ product_id: "p9", product_name: "Vida", ordered_qty: 1 }],
      { name: "Firma", id: "c1" },
      "S1",
      { client, companyId: "c1" },
    );
    expect(res.count).toBe(1);
    const group = templateLabelDocumentHtml.mock.calls[0][1] as unknown as Array<{ tpl: { id?: string } }>;
    expect(group[0].tpl.id).toBe("builtin-50x30");
  });

  it("warns once when the assigned template is missing and uses the default", async () => {
    get.mockResolvedValue([
      { id: "tpl_def", name: "Varsayılan", is_default: true, width_mm: 50, height_mm: 30 },
      { id: "tpl_other", name: "Diğer", width_mm: 40, height_mm: 20 },
    ]);
    const res = await printPickProductLabels([
      { ...line, label_template_id: "missing", ordered_qty: 2 },
      { ...line, label_template_id: "missing", ordered_qty: 1 },
    ], { name: "Firma", id: "c1" }, "S1", { client, companyId: "c1" });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith("MDF: atanan etiket şablonu bulunamadı, varsayılan kullanıldı");
    expect(res.count).toBe(3);
    const group = templateLabelDocumentHtml.mock.calls[0][1] as unknown as Array<{ tpl: { id: string } }>;
    expect(group.every((job) => job.tpl.id === "tpl_def")).toBe(true);
  });

  it("prints the stock card template when it is assigned", async () => {
    get.mockResolvedValue([
      { id: "tpl_def", name: "Varsayılan", is_default: true, width_mm: 50, height_mm: 30 },
      { id: "tpl_stock", name: "Stok", width_mm: 60, height_mm: 40 },
    ]);
    const res = await printPickProductLabels([line], { name: "Firma", id: "c1" }, "S1", {
      client,
      companyId: "c1",
    });
    expect(alert).not.toHaveBeenCalled();
    expect(res.count).toBe(1);
    const group = templateLabelDocumentHtml.mock.calls[0][1] as unknown as Array<{ tpl: { id: string } }>;
    expect(group[0].tpl.id).toBe("tpl_stock");
  });

  it("prints each product on the saved IP printer and groups copies into one job", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue(printerSettings);
    get.mockResolvedValue([
      { id: "tpl_def", name: "Varsayılan", is_default: true, width_mm: 50, height_mm: 30 },
    ]);
    const res = await printPickProductLabels([
      {
        product_id: "p1",
        product_name: "MDF",
        sku: "MDF-18",
        barcode: "869111",
        sale_price: 125.5,
        ordered_qty: 2,
      },
      {
        product_id: "p2",
        product_name: "Vida",
        sku: "V-1",
        ordered_qty: 1,
      },
    ], { name: "Firma", id: "c1" }, "S1", { client, companyId: "c1" });

    expect(res).toEqual({ count: 3, ok: true });
    expect(resolveLabelPrinter).toHaveBeenCalledWith(client, "c1");
    const payloads = tsplPayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toContain("SIZE 50 mm,30 mm");
    expect(payloads[0]).not.toContain("SIZE 100 mm,50 mm");
    expect(payloads[0]).toContain("MDF");
    expect(payloads[0]).toContain("869111");
    expect(payloads[0]).toContain("125.50 TL");
    expect(payloads[0]).toContain("PRINT 2,1");
    expect(payloads[1]).toContain("Vida");
    expect(payloads[1]).toContain("V-1");
    expect(payloads[1]).toContain("PRINT 1,1");
    expect(printShipmentLabels).not.toHaveBeenCalled();
    expect(templateLabelDocumentHtml).not.toHaveBeenCalled();
    expect(tryPrintLabelEthernet).not.toHaveBeenCalled();
  });

  it("prints the stock template size and elements on the IP printer", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue(printerSettings);
    get.mockResolvedValue([
      { id: "tpl_def", name: "Varsayılan", is_default: true, width_mm: 50, height_mm: 30, elements: [
        { type: "field", field: "name", x: 1, y: 1, font: 8 },
      ] },
      {
        id: "tpl_stock",
        name: "Stok",
        width_mm: 60,
        height_mm: 40,
        elements: [
          { type: "field", field: "name", x: 2, y: 1.5, font: 10, bold: true },
          { type: "barcode", x: 2, y: 9, h: 12, showText: true },
          { type: "field", field: "sku", x: 2, y: 24, font: 7 },
        ],
      },
    ]);
    const res = await printPickProductLabels([{
      ...line,
      sku: "MDF-18",
      barcode: "869111",
      sale_price: 80,
    }], { name: "Firma", id: "c1" }, "S1", { client, companyId: "c1" });

    expect(res).toEqual({ count: 1, ok: true });
    expect(alert).not.toHaveBeenCalled();
    const [payload] = tsplPayloads();
    const x = mmToDots(2, 203);
    const nameY = mmToDots(1.5, 203);
    const barY = mmToDots(9, 203);
    const barH = Math.max(40, mmToDots(12, 203));
    expect(payload).toContain("SIZE 60 mm,40 mm");
    expect(payload).toContain("GAP 3 mm,0 mm");
    expect(payload).toContain("CODEPAGE 1254");
    expect(payload).not.toContain("SIZE 100 mm,50 mm");
    expect(payload).toContain(`TEXT ${x},${nameY},"3",0,2,2,"MDF"`);
    expect(payload).toContain(`BARCODE ${x},${barY},"128",${barH},1,0,2,2,"869111"`);
    expect(payload).toContain("MDF-18");
    expect(payload).toContain("PRINT 1,1");
    expect(templateLabelDocumentHtml).not.toHaveBeenCalled();
  });

  it("splits IP jobs when two lines use different templates", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue(printerSettings);
    get.mockResolvedValue([
      {
        id: "tpl_stock",
        width_mm: 60,
        height_mm: 40,
        elements: [{ type: "field", field: "name", x: 2, y: 2, font: 10 }],
      },
      {
        id: "tpl_narrow",
        width_mm: 40,
        height_mm: 20,
        elements: [{ type: "field", field: "sku", x: 1.5, y: 1, font: 7 }],
      },
    ]);
    const res = await printPickProductLabels([
      { product_id: "p1", product_name: "MDF", sku: "M1", barcode: "869111", label_template_id: "tpl_stock", ordered_qty: 1 },
      { product_id: "p2", product_name: "Vida", sku: "V-9", barcode: "869222", label_template_id: "tpl_narrow", ordered_qty: 2 },
    ], { name: "Firma", id: "c1" }, "S1", { client, companyId: "c1" });

    expect(res).toEqual({ count: 3, ok: true });
    const payloads = tsplPayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toContain("SIZE 60 mm,40 mm");
    expect(payloads[0]).toContain("MDF");
    expect(payloads[0]).toContain("PRINT 1,1");
    expect(payloads[1]).toContain("SIZE 40 mm,20 mm");
    expect(payloads[1]).toContain("V-9");
    expect(payloads[1]).toContain("PRINT 2,1");
    expect(payloads[0]).not.toContain("SIZE 40 mm,20 mm");
    expect(payloads[1]).not.toContain("SIZE 60 mm,40 mm");
  });

  it("uses the default template on the IP printer when the assigned one is missing", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue(printerSettings);
    get.mockResolvedValue([
      {
        id: "tpl_def",
        name: "Varsayılan",
        is_default: true,
        width_mm: 70,
        height_mm: 35,
        elements: [{ type: "field", field: "name", x: 3, y: 3, font: 10 }],
      },
    ]);
    const res = await printPickProductLabels([
      { ...line, label_template_id: "missing", ordered_qty: 2 },
    ], { name: "Firma", id: "c1" }, "S1", { client, companyId: "c1" });
    expect(res).toEqual({ count: 2, ok: true });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith("MDF: atanan etiket şablonu bulunamadı, varsayılan kullanıldı");
    const [payload] = tsplPayloads();
    expect(payload).toContain("SIZE 70 mm,35 mm");
    expect(payload).toContain("PRINT 2,1");
    expect(payload).not.toContain("SIZE 100 mm,50 mm");
  });

  it("falls back to the builtin 50x30 template on the IP printer when nothing is saved", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue(printerSettings);
    get.mockResolvedValue([]);
    const res = await printPickProductLabels([
      { product_id: "p9", product_name: "Vida", sku: "V-1", label_template_id: "gone", ordered_qty: 1 },
    ], { name: "Firma", id: "c1" }, "S1", { client, companyId: "c1" });
    expect(res).toEqual({ count: 1, ok: true });
    expect(alert).toHaveBeenCalledWith("Vida: atanan etiket şablonu bulunamadı, varsayılan kullanıldı");
    const [payload] = tsplPayloads();
    expect(payload).toContain("SIZE 50 mm,30 mm");
    expect(payload).toContain("Vida");
    expect(payload).not.toContain("SIZE 100 mm,50 mm");
    expect(templateLabelDocumentHtml).not.toHaveBeenCalled();
  });

  it("asks before printing the builtin template when label templates fail and a host is set", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue(printerSettings);
    get.mockRejectedValue(new Error("down"));
    alert.mockImplementation((title: unknown, _message?: unknown, buttons?: AlertButton[]) => {
      if (title === FETCH_MSG) buttons?.find((button) => button.text === "Bas")?.onPress?.();
    });
    const res = await printPickProductLabels(
      [{ product_id: "p9", product_name: "Vida", ordered_qty: 1 }],
      { name: "Firma", id: "c1" },
      "S1",
      { client, companyId: "c1" },
    );
    expect(res).toEqual({ count: 1, ok: true });
    expect(alert).toHaveBeenCalledWith(FETCH_MSG, undefined, expect.any(Array), expect.any(Object));
    const [payload] = tsplPayloads();
    expect(payload).toContain("SIZE 50 mm,30 mm");
    expect(payload).toContain("Vida");
    expect(templateLabelDocumentHtml).not.toHaveBeenCalled();
  });

  it("keeps the ethernet and HTML path when the label printer has no host", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue({ host: "  ", port: 9100 });
    get.mockResolvedValue([
      { id: "tpl_def", name: "Varsayılan", is_default: true, width_mm: 50, height_mm: 30 },
    ]);
    const res = await printPickProductLabels([line], { name: "Firma", id: "c1" }, "S1", {
      client,
      companyId: "c1",
    });
    expect(res).toEqual({ count: 1, ok: true });
    expect(written).toHaveLength(0);
    expect(tryPrintLabelEthernet).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({ name: "MDF" }),
      copies: 1,
      client,
    }));
    expect(templateLabelDocumentHtml).toHaveBeenCalled();
  });

  it("throws when the IP product label fails and does not fall back to HTML", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue({ ...printerSettings, host: "10.0.0.5" });
    tcpFail = new Error("yazıcı kapalı");
    get.mockResolvedValue([
      { id: "tpl_def", name: "Varsayılan", is_default: true, width_mm: 50, height_mm: 30 },
    ]);
    await expect(printPickProductLabels([
      { ...line, ordered_qty: 2 },
    ], { name: "Firma", id: "c1" }, "S1", {
      client,
      companyId: "c1",
    })).rejects.toThrow("yazıcı kapalı");
    expect(written).toHaveLength(0);
    expect(templateLabelDocumentHtml).not.toHaveBeenCalled();
    expect(tryPrintLabelEthernet).not.toHaveBeenCalled();
  });
});
