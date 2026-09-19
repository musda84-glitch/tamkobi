import { code128Bits, code128Svg } from "./code128";

describe("code128", () => {
  it("encodes start, payload, checksum and stop", () => {
    const bits = code128Bits("ABC");
    expect(bits.startsWith("11010010000")).toBe(true);
    expect(bits.endsWith("1100011101011")).toBe(true);
    expect(bits.length).toBeGreaterThan(40);
    expect(/[^01]/.test(bits)).toBe(false);
  });

  it("renders an SVG barcode with the human-readable value", () => {
    const svg = code128Svg("8690001928371");
    expect(svg).toContain("<svg");
    expect(svg).toContain("8690001928371");
    expect(svg).toContain("<rect");
  });

  it("returns empty svg for a blank value", () => {
    expect(code128Svg("")).toBe("");
    expect(code128Svg("   ")).toBe("");
  });
});
