import { parseScanQtyInput, scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "./scanQty";

describe("scanQty draft", () => {
  it("shows 1 until the field is focused to empty", () => {
    expect(scanQtyShown(undefined)).toBe("1");
    expect(scanQtyShown(null)).toBe("1");
    expect(scanQtyShown("1")).toBe("1");
    expect(scanQtyShown("")).toBe("");
    expect(scanQtyShown("12")).toBe("12");
  });

  it("clears on focus and restores 1 on empty blur", () => {
    expect(scanQtyOnFocus()).toBe("");
    expect(scanQtyOnBlur("")).toBe("1");
    expect(scanQtyOnBlur("8")).toBe("8");
    expect(parseScanQtyInput("")).toBe(1);
    expect(parseScanQtyInput("4")).toBe(4);
  });
});
