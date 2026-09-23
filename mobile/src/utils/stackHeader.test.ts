import { headerBackAction } from "./stackHeader";

describe("headerBackAction", () => {
  it("goes back when the stack has history", () => {
    expect(headerBackAction(true, "/surveys")).toBe("back");
  });

  it("falls back to the list when there is no history", () => {
    expect(headerBackAction(false, "/surveys")).toBe("/surveys");
  });
});
