import {
  contentBottomPad,
  focusedFieldScrollDelta,
  keyboardTopFromEvent,
  keyboardTopFromVisualViewport,
  loginSheetJustify,
  nextScrollY,
  SCREEN_BASE_PAD,
  webKeyboardHeight,
} from "./keyboardPad";

describe("keyboardPad", () => {
  it("lifts Android and web content by the IME height", () => {
    expect(contentBottomPad(SCREEN_BASE_PAD, 320, "android")).toBe(SCREEN_BASE_PAD + 320);
    expect(contentBottomPad(SCREEN_BASE_PAD, 280, "web")).toBe(SCREEN_BASE_PAD + 280);
  });

  it("leaves iOS padding to KeyboardAvoidingView", () => {
    expect(contentBottomPad(SCREEN_BASE_PAD, 320, "ios")).toBe(SCREEN_BASE_PAD);
  });

  it("keeps the base pad when the keyboard is closed", () => {
    expect(contentBottomPad(40, 0, "android")).toBe(40);
    expect(contentBottomPad(40, 0, "web")).toBe(40);
  });

  it("scrolls a covered field into the band above the keyboard", () => {
    expect(focusedFieldScrollDelta(700, 500, 24)).toBe(224);
    expect(focusedFieldScrollDelta(400, 500, 24)).toBe(0);
    expect(focusedFieldScrollDelta(0, 500)).toBe(0);
    expect(nextScrollY(80, 224)).toBe(304);
    expect(nextScrollY(80, 224, 200)).toBe(200);
    expect(nextScrollY(10, -40)).toBe(0);
  });

  it("reads the keyboard top from the IME event or the visual viewport", () => {
    expect(keyboardTopFromEvent(520, 300, 820)).toBe(520);
    expect(keyboardTopFromEvent(undefined, 300, 820)).toBe(520);
    expect(keyboardTopFromVisualViewport(800, 480, 0)).toBe(480);
    expect(webKeyboardHeight(800, 480, 0)).toBe(320);
    expect(webKeyboardHeight(800, 780, 0)).toBe(0);
    expect(loginSheetJustify(0)).toBe("center");
    expect(loginSheetJustify(280)).toBe("flex-end");
  });
});
