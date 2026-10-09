/**
 * @jest-environment jsdom
 */
import {
  applyPrinterPreset,
  buildEscPosLabel,
  buildTsplLabel,
  defaultEthernetPrinter,
  escapeTsplText,
  ethernetPrinterConfigError,
  isBridgeUrlOnPrinterHost,
  isBridgeUrlPrinterRawPort,
  isSerialBaudPort,
  loadEthernetPrinter,
  mmToDots,
  normalizeEthernetPort,
  sanitizeBarcodeData,
  saveEthernetPrinter,
  suggestedBridgeUrl,
} from "./ethernetPrinter";

describe("ethernetPrinter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("mmToDots at 203 dpi", () => {
    expect(mmToDots(25.4, 203)).toBe(203);
    expect(mmToDots(10, 203)).toBe(80);
  });

  test("escape and sanitize", () => {
    expect(escapeTsplText('Ab"c\n')).toBe("Ab'c");
    expect(sanitizeBarcodeData("DL120-ANT-G74!")).toBe("DL120-ANT-G74");
  });

  test("buildTsplLabel includes SIZE BARCODE PRINT", () => {
    const cmd = buildTsplLabel({
      product: { name: "Profil", sku: "DL120", barcode: "8690001", sale_price: 12.5 },
      tpl: { width_mm: 100, height_mm: 30 },
      copies: 2,
      dpi: 203,
    });
    expect(cmd).toContain("SIZE 100 mm,30 mm");
    expect(cmd).toContain('BARCODE');
    expect(cmd).toContain("8690001");
    expect(cmd).toContain("PRINT 2,1");
  });

  test("buildTsplLabel uses template elements", () => {
    const cmd = buildTsplLabel({
      product: { name: "X", barcode: "ABC123" },
      company: { name: "Firma" },
      tpl: {
        width_mm: 50,
        height_mm: 30,
        elements: [
          { type: "field", field: "name", x: 2, y: 2, font: 10 },
          { type: "barcode", x: 2, y: 10, h: 12, showText: true },
        ],
      },
      copies: 1,
    });
    expect(cmd).toContain("TEXT");
    expect(cmd).toContain("ABC123");
  });

  test("buildEscPosLabel emits init and barcode", () => {
    const cmd = buildEscPosLabel({ product: { name: "Test", barcode: "12345" }, copies: 1 });
    expect(cmd).toContain("\x1b@");
    expect(cmd).toContain("Test");
    expect(cmd).toContain("12345");
  });

  test("save/load settings and preset", () => {
    saveEthernetPrinter({ host: "192.168.1.50", enabled: true });
    expect(loadEthernetPrinter().host).toBe("192.168.1.50");
    expect(loadEthernetPrinter().enabled).toBe(true);
    const next = applyPrinterPreset(loadEthernetPrinter(), "xprinter-xp-490b");
    expect(next.model).toBe("XP-490B");
    expect(next.port).toBe(9100);
    expect(defaultEthernetPrinter().protocol).toBe("tspl");
  });

  test("detects bridge URL wrongly set to printer :9100", () => {
    const bad = {
      host: "192.168.1.117",
      port: 9100,
      mode: "bridge",
      bridgeUrl: "http://192.168.1.117:9100",
    };
    expect(isBridgeUrlPrinterRawPort(bad)).toBe(true);
    expect(isBridgeUrlOnPrinterHost(bad)).toBe(true);
    expect(ethernetPrinterConfigError(bad)).toMatch(/Köprü URL yazıcı/);
    const fixed = saveEthernetPrinter(bad);
    expect(fixed.bridgeUrl).toBe(suggestedBridgeUrl("192.168.1.117"));
    expect(fixed.bridgeUrl).toContain(":19100");
    expect(isBridgeUrlOnPrinterHost(fixed)).toBe(false);
  });

  test("serial baud 9600 normalizes to Ethernet 9100", () => {
    expect(isSerialBaudPort(9600)).toBe(true);
    expect(normalizeEthernetPort(9600)).toBe(9100);
    expect(ethernetPrinterConfigError({ host: "192.168.1.117", port: 9600, mode: "api" })).toMatch(/9600|seri baud|9100/i);
    const fixed = saveEthernetPrinter({ host: "192.168.1.117", port: 9600, mode: "api" });
    expect(fixed.port).toBe(9100);
    localStorage.setItem(
      "tamkobi_ethernet_printer",
      JSON.stringify({ host: "192.168.1.117", port: 9600, mode: "api" }),
    );
    expect(loadEthernetPrinter().port).toBe(9100);
  });

  test("bridge URL on printer host with :19100 is still wrong", () => {
    const bad = {
      host: "192.168.1.117",
      port: 9100,
      mode: "bridge",
      bridgeUrl: "http://192.168.1.117:19100",
    };
    expect(isBridgeUrlOnPrinterHost(bad)).toBe(true);
    expect(ethernetPrinterConfigError(bad)).toMatch(/Köprü URL yazıcı/);
    const fixed = saveEthernetPrinter(bad);
    expect(fixed.bridgeUrl).toBe("http://127.0.0.1:19100");
    expect(isBridgeUrlOnPrinterHost(fixed)).toBe(false);
  });
});
