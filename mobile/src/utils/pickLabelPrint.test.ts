const alert = jest.fn();
const get = jest.fn();
const templateLabelDocumentHtml = jest.fn((..._args: unknown[]) => ({ html: "<html></html>", widthMm: 50, heightMm: 30 }));

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Alert: {
    alert: (...args: unknown[]) => alert(...args),
  },
}));

jest.mock("../api/client", () => ({
  get: (...args: unknown[]) => get(...args),
}));

jest.mock("./ethernetPrinter", () => ({
  tryPrintLabelEthernet: jest.fn(async () => false),
}));

jest.mock("./labelPrinter", () => ({
  resolveLabelPrinter: jest.fn(async () => ({ host: "", port: 9100 })),
  printProductLabel: jest.fn(async () => ({ bytes: 1 })),
  printShipmentLabels: jest.fn(async () => ({ bytes: 1 })),
}));

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
import { printProductLabel, printShipmentLabels, resolveLabelPrinter } from "./labelPrinter";
import { loadTemplates, printPickProductLabels } from "./pickLabelPrint";

const client = { baseUrl: "https://example.com", token: null };
const FETCH_MSG = "Etiket şablonları alınamadı (oturum/firma). Hazır şablonla basılsın mı?";

type AlertButton = { text?: string; style?: string; onPress?: () => void };

beforeEach(() => {
  alert.mockReset();
  get.mockReset();
  templateLabelDocumentHtml.mockClear();
  (resolveLabelPrinter as jest.Mock).mockReset();
  (resolveLabelPrinter as jest.Mock).mockResolvedValue({ host: "", port: 9100 });
  (printProductLabel as jest.Mock).mockReset();
  (printProductLabel as jest.Mock).mockResolvedValue({ bytes: 1 });
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
    (resolveLabelPrinter as jest.Mock).mockResolvedValue({
      host: "192.168.1.117",
      port: 9100,
      widthMm: 100,
      heightMm: 50,
    });
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
    expect(printProductLabel).toHaveBeenCalledTimes(2);
    expect(printProductLabel).toHaveBeenNthCalledWith(1, {
      settings: expect.objectContaining({ host: "192.168.1.117" }),
      copies: 2,
      product: {
        name: "MDF",
        sku: "MDF-18",
        barcode: "869111",
        price: 125.5,
      },
    });
    expect(printProductLabel).toHaveBeenNthCalledWith(2, {
      settings: expect.objectContaining({ host: "192.168.1.117" }),
      copies: 1,
      product: {
        name: "Vida",
        sku: "V-1",
        barcode: "V-1",
        price: null,
      },
    });
    expect(printShipmentLabels).not.toHaveBeenCalled();
    expect(templateLabelDocumentHtml).not.toHaveBeenCalled();
    expect(tryPrintLabelEthernet).not.toHaveBeenCalled();
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
    expect(printProductLabel).not.toHaveBeenCalled();
    expect(tryPrintLabelEthernet).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({ name: "MDF" }),
      copies: 1,
      client,
    }));
    expect(templateLabelDocumentHtml).toHaveBeenCalled();
  });

  it("throws when the IP product label fails and does not fall back to HTML", async () => {
    (resolveLabelPrinter as jest.Mock).mockResolvedValue({ host: "10.0.0.5", port: 9100 });
    (printProductLabel as jest.Mock).mockRejectedValue(new Error("yazıcı kapalı"));
    get.mockResolvedValue([
      { id: "tpl_def", name: "Varsayılan", is_default: true, width_mm: 50, height_mm: 30 },
    ]);
    await expect(printPickProductLabels([
      { ...line, ordered_qty: 2 },
    ], { name: "Firma", id: "c1" }, "S1", {
      client,
      companyId: "c1",
    })).rejects.toThrow("yazıcı kapalı");
    expect(printProductLabel).toHaveBeenCalledTimes(1);
    expect(templateLabelDocumentHtml).not.toHaveBeenCalled();
    expect(tryPrintLabelEthernet).not.toHaveBeenCalled();
  });
});
