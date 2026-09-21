import { swipeRevealOutcome, SWIPE_MENU_W } from "./swipeReveal";

describe("swipeRevealOutcome", () => {
  it("opens when dragged past halfway or flicked left", () => {
    expect(swipeRevealOutcome(0, -(SWIPE_MENU_W / 2 + 1), 0)).toBe("open");
    expect(swipeRevealOutcome(0, -20, -0.5)).toBe("open");
  });

  it("closes when released short of the menu", () => {
    expect(swipeRevealOutcome(0, -20, 0)).toBe("close");
    expect(swipeRevealOutcome(-SWIPE_MENU_W, 80, 0)).toBe("close");
  });

  it("treats a tap as press, or closes an already open row", () => {
    expect(swipeRevealOutcome(0, 2, 0)).toBe("press");
    expect(swipeRevealOutcome(-SWIPE_MENU_W, 3, 0)).toBe("close");
  });
});
