import { nextStickyFilterHidden } from "./listSticky";

describe("nextStickyFilterHidden", () => {
  it("hides after the page has been scrolled", () => {
    expect(nextStickyFilterHidden(false, 0)).toBe(false);
    expect(nextStickyFilterHidden(false, 20)).toBe(false);
    expect(nextStickyFilterHidden(false, 40)).toBe(true);
  });

  it("stays hidden until the list is near the top again", () => {
    expect(nextStickyFilterHidden(true, 20)).toBe(true);
    expect(nextStickyFilterHidden(true, 8)).toBe(false);
  });
});
