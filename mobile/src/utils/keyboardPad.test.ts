import { contentBottomPad, SCREEN_BASE_PAD } from "./keyboardPad";

describe("keyboardPad", () => {
  it("lifts Android content by the IME height", () => {
    expect(contentBottomPad(SCREEN_BASE_PAD, 320, "android")).toBe(SCREEN_BASE_PAD + 320);
  });

  it("leaves iOS padding to KeyboardAvoidingView", () => {
    expect(contentBottomPad(SCREEN_BASE_PAD, 320, "ios")).toBe(SCREEN_BASE_PAD);
  });

  it("keeps the base pad when the keyboard is closed", () => {
    expect(contentBottomPad(40, 0, "android")).toBe(40);
  });
});
