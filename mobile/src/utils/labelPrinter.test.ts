import {
  defaultLabelPrinter,
  fromCompanyLabelPrinter,
  labelPrinterConfigError,
  normalizeLabelPrinter,
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
