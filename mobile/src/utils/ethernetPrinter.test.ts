import {
  buildTsplLabel,
  defaultEthernetPrinter,
  escapeTsplText,
  ethernetPrinterConfigError,
  isBridgeUrlOnPrinterHost,
  isBridgeUrlPrinterRawPort,
  isSerialBaudPort,
  mmToDots,
  normalizeEthernetPort,
  sanitizeBarcodeData,
} from "./ethernetPrinter";

describe("ethernetPrinter (mobile)", () => {
  it("mmToDots and sanitizers", () => {
    expect(mmToDots(25.4, 203)).toBe(203);
    expect(escapeTsplText('A"B')).toBe("A'B");
    expect(sanitizeBarcodeData("SKU-1!")).toBe("SKU-1");
  });

  it("buildTsplLabel for XP-490B style", () => {
    const cmd = buildTsplLabel({
      product: { name: "Profil", sku: "DL120", barcode: "8690001" },
      tpl: { width_mm: 100, height_mm: 30 },
      copies: 1,
      dpi: 203,
    });
    expect(cmd).toContain("SIZE 100 mm,30 mm");
    expect(cmd).toContain("8690001");
    expect(cmd).toContain("PRINT 1,1");
  });

  it("default prefers bridge on mobile", () => {
    expect(defaultEthernetPrinter().mode).toBe("bridge");
    expect(defaultEthernetPrinter().model).toBe("XP-490B");
  });

  it("rejects bridge URL equal to printer host (any port)", () => {
    const bad9100 = {
      host: "192.168.1.117",
      port: 9100,
      mode: "bridge" as const,
      bridgeUrl: "http://192.168.1.117:9100",
    };
    const bad19100 = {
      host: "192.168.1.117",
      port: 9100,
      mode: "bridge" as const,
      bridgeUrl: "http://192.168.1.117:19100",
    };
    expect(isBridgeUrlPrinterRawPort(bad9100)).toBe(true);
    expect(isBridgeUrlOnPrinterHost(bad19100)).toBe(true);
    expect(ethernetPrinterConfigError(bad19100)).toMatch(/Köprü URL yazıcı/);
  });

  it("serial baud 9600 normalizes to 9100", () => {
    expect(isSerialBaudPort(9600)).toBe(true);
    expect(normalizeEthernetPort(9600)).toBe(9100);
    expect(ethernetPrinterConfigError({ host: "192.168.1.117", port: 9600, mode: "api" })).toMatch(/9100|seri baud/i);
  });
});
