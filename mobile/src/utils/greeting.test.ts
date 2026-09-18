import { firstName, greetingLine } from "./greeting";

describe("firstName", () => {
  it("keeps only the given name", () => {
    expect(firstName("Mustafa Demir")).toBe("Mustafa");
    expect(firstName("  Mustafa  ")).toBe("Mustafa");
    expect(firstName("")).toBe("");
  });
});

describe("greetingLine", () => {
  it("formats the compact header greeting", () => {
    expect(greetingLine("Mustafa Demir")).toBe("Merhaba, Mustafa");
    expect(greetingLine(null)).toBe("Merhaba");
  });
});
