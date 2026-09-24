import { qtyDraftOnBlur, qtyDraftOnFocus, qtyDraftShown } from "./b2bSearch";

describe("qty draft focus", () => {
  test("clears on focus and restores 1 on empty blur", () => {
    expect(qtyDraftShown({}, "p1")).toBe("1");
    expect(qtyDraftShown({ p1: "" }, "p1")).toBe("");
    expect(qtyDraftShown({ p1: "12" }, "p1")).toBe("12");
    expect(qtyDraftOnFocus()).toBe("");
    expect(qtyDraftOnBlur("")).toBe("1");
    expect(qtyDraftOnBlur("8")).toBe("8");
  });
});
