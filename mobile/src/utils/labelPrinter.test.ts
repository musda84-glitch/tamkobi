import {
  defaultLabelPrinter,
  fromCompanyLabelPrinter,
  labelPrinterConfigError,
  normalizeLabelPrinter,
  printTemplateLabel,
  printerErrorMessage,
  sendRawToPrinter,
  toCompanyLabelPrinter,
  type TcpConnect,
} from "./labelPrinter";

function scriptedConnect(mode: "ok" | "refuse" | "hang"): TcpConnect {
  return () => {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const sock = {
      written: null as Uint8Array | null,
      write(data: Uint8Array, onFlushed?: () => void) {
        sock.written = data;
        onFlushed?.();
      },
      on(event: string, cb: (arg?: unknown) => void) {
        handlers[event] = cb;
      },
      destroy() {},
    };
    queueMicrotask(() => {
      if (mode === "ok") handlers.connect?.();
      if (mode === "refuse") handlers.error?.({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 192.168.1.117:9100" });
    });
    return sock;
  };
}

describe("label printer settings", () => {
  it("defaults to XP-490B on port 9100 at 203 dpi", () => {
    const d = defaultLabelPrinter();
    expect(d.name).toContain("XP-490B");
    expect(d.port).toBe(9100);
    expect(d.dpi).toBe(203);
    expect(d.widthMm).toBeGreaterThan(0);
    expect(d.heightMm).toBeGreaterThan(0);
  });

  it("normalizes serial baud and company payload", () => {
    expect(normalizeLabelPrinter({ host: " 192.168.1.117 ", port: 9600, dpi: 300 }).port).toBe(9100);
    expect(normalizeLabelPrinter({ host: "192.168.1.117", port: 9100, dpi: 300 }).dpi).toBe(300);
    const saved = normalizeLabelPrinter({
      name: "Depo",
      host: "192.168.1.117",
      port: 9100,
      widthMm: 100,
      heightMm: 40,
      gapMm: 3,
      dpi: 203,
      textMode: "codepage",
    });
    const wire = toCompanyLabelPrinter(saved);
    expect(wire).toMatchObject({ host: "192.168.1.117", port: 9100, width_mm: 100, height_mm: 40, gap_mm: 3, dpi: 203 });
    expect(fromCompanyLabelPrinter(wire).host).toBe("192.168.1.117");
    expect(labelPrinterConfigError({ host: "", port: 9100 })).toMatch(/IP/);
    expect(labelPrinterConfigError({ host: "192.168.1.117", port: 9600 })).toMatch(/9100|seri baud/);
  });
});

describe("template label send", () => {
  it("sends template width, height and elements instead of the printer stock size", async () => {
    let captured: Uint8Array | null = null;
    const connect: TcpConnect = () => ({
      write(data, onFlushed) {
        captured = Uint8Array.from(data);
        onFlushed?.();
      },
      on(event, cb) {
        if (event === "connect") queueMicrotask(() => cb());
      },
      destroy() {},
    });
    const settings = normalizeLabelPrinter({
      host: "192.168.1.117",
      port: 9100,
      widthMm: 100,
      heightMm: 50,
      gapMm: 2,
      textMode: "codepage",
    });
    await printTemplateLabel({
      settings,
      copies: 2,
      connect,
      companyName: "TamKobi",
      product: { name: "Şişe", sku: "S1", barcode: "ABC", sale_price: 10 },
      tpl: {
        width_mm: 60,
        height_mm: 40,
        elements: [
          { type: "field", field: "name", x: 2, y: 2, font: 10 },
          { type: "field", field: "company", x: 2, y: 8, font: 7 },
          { type: "barcode", x: 2, y: 14, h: 8, showText: false },
        ],
      },
    });
    const text = new TextDecoder("latin1").decode(captured || new Uint8Array());
    expect(text).toContain("SIZE 60 mm,40 mm");
    expect(text).not.toContain("SIZE 100 mm,50 mm");
    expect(text).toContain("CODEPAGE 1254");
    expect(text).toContain("TamKobi");
    expect(text).toContain("PRINT 2,1");
    expect(text).toContain(",0,0,2,2,\"ABC\"");
    expect(Array.from(captured || [])).toEqual(expect.arrayContaining([0xde, 0x69, 0xfe, 0x65]));
  });
});

describe("printer TCP errors", () => {
  const target = { host: "192.168.1.117", port: 9100, bytes: Uint8Array.from([65, 66]) };

  it("names a timeout", async () => {
    await expect(sendRawToPrinter({ ...target, timeoutMs: 30, connect: scriptedConnect("hang") })).rejects.toThrow(
      /zaman aşımı/i,
    );
    expect(printerErrorMessage({ code: "ETIMEDOUT" }, target.host, target.port)).toMatch(/192\.168\.1\.117:9100/);
  });

  it("names a refused connection", async () => {
    await expect(sendRawToPrinter({ ...target, connect: scriptedConnect("refuse") })).rejects.toThrow(/reddetti/i);
  });

  it("writes the payload when the socket connects", async () => {
    const connect = scriptedConnect("ok");
    const result = await sendRawToPrinter({ ...target, connect });
    expect(result.bytes).toBe(2);
  });

  it("refuses an empty host before opening a socket", async () => {
    await expect(sendRawToPrinter({ host: "", port: 9100, bytes: Uint8Array.from([1]), connect: scriptedConnect("ok") }))
      .rejects.toThrow(/IP/);
  });
});
