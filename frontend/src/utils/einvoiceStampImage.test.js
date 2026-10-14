import {
  STAMP_MAX_BYTES,
  STAMP_MAX_WIDTH_PX,
  knockoutNearWhite,
  prepareStampFile,
  scaledStampSize,
  stampOverLimitWarning,
  stampPayloadBytes,
  stampWithinLimit,
} from "./einvoiceStampImage";

const SMALL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function installCanvas(toDataURL) {
  const widths = [];
  let last = null;
  const orig = document.createElement.bind(document);
  jest.spyOn(document, "createElement").mockImplementation((tag) => {
    if (String(tag).toLowerCase() !== "canvas") return orig(tag);
    const canvas = {
      _w: 0,
      _h: 0,
      lastImage: null,
      getContext() {
        return {
          clearRect() {},
          fillRect() {},
          drawImage() {},
          getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255, 180, 20, 20, 255]) }),
          putImageData(image) { canvas.lastImage = image; },
        };
      },
      toDataURL,
    };
    Object.defineProperty(canvas, "width", {
      get() { return canvas._w; },
      set(v) { canvas._w = v; widths.push(v); },
    });
    Object.defineProperty(canvas, "height", {
      get() { return canvas._h; },
      set(v) { canvas._h = v; },
    });
    last = canvas;
    return canvas;
  });
  return { widths, canvas: () => last };
}

describe("stamp image limits", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.createImageBitmap;
  });

  test("scaledStampSize caps width at 400 px", () => {
    expect(scaledStampSize(900, 300, STAMP_MAX_WIDTH_PX)).toEqual({ width: 400, height: 133 });
    expect(scaledStampSize(200, 80)).toEqual({ width: 200, height: 80 });
  });

  test("knockoutNearWhite clears near-white pixels and keeps ink", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 250, 248, 249, 255, 180, 20, 20, 255]);
    knockoutNearWhite({ data });
    expect(Array.from(data)).toEqual([255, 255, 255, 0, 250, 248, 249, 0, 180, 20, 20, 255]);
  });

  test("stampWithinLimit rejects http and oversized payloads", () => {
    expect(stampWithinLimit(SMALL_PNG)).toBe(true);
    expect(stampPayloadBytes(SMALL_PNG)).toBeLessThan(STAMP_MAX_BYTES);
    expect(stampWithinLimit("https://cdn.example/stamp.png")).toBe(false);
    const huge = `data:image/jpeg;base64,${"A".repeat(210000)}`;
    expect(stampPayloadBytes(huge)).toBeGreaterThan(STAMP_MAX_BYTES);
    expect(stampWithinLimit(huge)).toBe(false);
    expect(stampOverLimitWarning()).toMatch(/150 KB/);
  });

  test("prepareStampFile shrinks to 400 px and embeds a data URI", async () => {
    const calls = [];
    const { widths } = installCanvas((mime, quality) => {
      calls.push([mime, quality]);
      return SMALL_PNG;
    });
    global.createImageBitmap = jest.fn(async () => ({ width: 900, height: 300, close: jest.fn() }));
    const file = new File([new Uint8Array([1, 2, 3])], "kase.jpg", { type: "image/jpeg" });
    const out = await prepareStampFile(file);
    expect(out.warning).toBe("");
    expect(out.dataUrl).toBe(SMALL_PNG);
    expect(widths[0]).toBe(400);
    expect(calls[0][0]).toBe("image/jpeg");
  });

  test("prepareStampFile knocks out white into a PNG", async () => {
    const { canvas } = installCanvas(() => SMALL_PNG);
    global.createImageBitmap = jest.fn(async () => ({ width: 120, height: 80, close: jest.fn() }));
    const file = new File([new Uint8Array([1])], "kase.png", { type: "image/png" });
    const out = await prepareStampFile(file, { knockoutWhite: true });
    expect(out.dataUrl).toBe(SMALL_PNG);
    expect(Array.from(canvas().lastImage.data)).toEqual([255, 255, 255, 0, 180, 20, 20, 255]);
  });

  test("prepareStampFile warns and drops the image when it stays over 150 KB", async () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(210000)}`;
    installCanvas(() => huge);
    global.createImageBitmap = jest.fn(async () => ({ width: 800, height: 800, close: jest.fn() }));
    const file = new File([new Uint8Array(4000)], "buyuk.jpg", { type: "image/jpeg" });
    const out = await prepareStampFile(file);
    expect(out.dataUrl).toBe("");
    expect(out.warning).toBe(stampOverLimitWarning());
    expect(stampPayloadBytes(huge)).toBeGreaterThan(STAMP_MAX_BYTES);
  });

  test("prepareStampFile rejects files that are not PNG or JPG", async () => {
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    const out = await prepareStampFile(pdf);
    expect(out.dataUrl).toBe("");
    expect(out.warning).toMatch(/PNG veya JPG/);
  });
});
