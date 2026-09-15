import { fmtMoney, idOf } from "./money";

describe("fmtMoney", () => {
  it("formats TRY with two decimals", () => {
    expect(fmtMoney(1234.5)).toMatch(/1.?234,50 ₺/);
    expect(fmtMoney(null)).toBe("0,00 ₺");
  });

  it("uses currency code for non-TRY", () => {
    expect(fmtMoney(10, "USD")).toMatch(/10,00 USD/);
  });
});

describe("idOf", () => {
  it("prefers id then _id", () => {
    expect(idOf({ id: "a", _id: "b" })).toBe("a");
    expect(idOf({ _id: "b" })).toBe("b");
    expect(idOf(null)).toBe("");
  });
});
