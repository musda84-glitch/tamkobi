import { fontFamilyForWeight, shouldReplaceFontFamily, SOFT_FONT, typeface } from "./softFont";

describe("softFont", () => {
  it("maps numeric and named weights onto Nunito faces", () => {
    expect(fontFamilyForWeight(undefined)).toBe(SOFT_FONT.regular);
    expect(fontFamilyForWeight("400")).toBe(SOFT_FONT.regular);
    expect(fontFamilyForWeight("normal")).toBe(SOFT_FONT.regular);
    expect(fontFamilyForWeight("500")).toBe(SOFT_FONT.medium);
    expect(fontFamilyForWeight("600")).toBe(SOFT_FONT.semibold);
    expect(fontFamilyForWeight("700")).toBe(SOFT_FONT.bold);
    expect(fontFamilyForWeight("bold")).toBe(SOFT_FONT.bold);
    expect(fontFamilyForWeight("800")).toBe(SOFT_FONT.extrabold);
    expect(fontFamilyForWeight("900")).toBe(SOFT_FONT.black);
    expect(fontFamilyForWeight(800)).toBe(SOFT_FONT.extrabold);
  });

  it("keeps icon and monospace families", () => {
    expect(shouldReplaceFontFamily(undefined)).toBe(true);
    expect(shouldReplaceFontFamily("")).toBe(true);
    expect(shouldReplaceFontFamily("system-ui, Segoe UI")).toBe(true);
    expect(shouldReplaceFontFamily("ionicons")).toBe(false);
    expect(shouldReplaceFontFamily("Ionicons")).toBe(false);
    expect(shouldReplaceFontFamily("Menlo")).toBe(false);
    expect(shouldReplaceFontFamily("ui-monospace, monospace")).toBe(false);
  });

  it("returns a style that only sets the matching face", () => {
    expect(typeface("800")).toEqual({ fontFamily: SOFT_FONT.extrabold });
    expect(typeface()).toEqual({ fontFamily: SOFT_FONT.regular });
  });
});
