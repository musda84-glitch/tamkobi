import { parseScanQtyInput, scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "./scanQty";

describe("scanQty draft", () => {
  test("clears on focus and restores 1 on empty blur", () => {
    expect(scanQtyShown(undefined)).toBe("1");
    expect(scanQtyShown("")).toBe("");
    expect(scanQtyShown("12")).toBe("12");
    expect(scanQtyOnFocus()).toBe("");
    expect(scanQtyOnBlur("")).toBe("1");
    expect(scanQtyOnBlur("8")).toBe("8");
    expect(parseScanQtyInput("")).toBe(1);
  });
});
