import { punchLabelClass, punchLabelColor, punchLabelTone } from "./punchLabels";

describe("punchLabels", () => {
  test("colors check-in green and check-out red", () => {
    expect(punchLabelTone("Çıkış saati düzelt")).toBe("out");
    expect(punchLabelTone("Giriş saati")).toBe("in");
    expect(punchLabelTone("GİRİŞ")).toBe("in");
    expect(punchLabelTone("Planlanan saat")).toBeNull();
    expect(punchLabelColor("Çıkış")).toBe("#BE123C");
    expect(punchLabelColor("Giriş")).toBe("#047857");
    expect(punchLabelClass("Giriş saati")).toBe("text-emerald-700");
    expect(punchLabelClass("Çıkış saati")).toBe("text-rose-700");
  });
});
