import { fmtMoney, getPriceDecimals, idOf, setPriceDecimals } from "./money";

afterEach(() => {
  setPriceDecimals(2);
});

describe("fmtMoney", () => {
  it("formats TRY with two decimals", () => {
    expect(getPriceDecimals()).toBe(2);
    expect(fmtMoney(1234.5)).toMatch(/1.?234,50 ₺/);
    expect(fmtMoney(null)).toBe("0,00 ₺");
  });

  it("uses currency code for non-TRY", () => {
    expect(fmtMoney(10, "USD")).toMatch(/10,00 USD/);
  });

  it("follows the company price precision used on web", () => {
    setPriceDecimals(4);
    expect(fmtMoney(12.5)).toMatch(/12,5000 ₺/);
    setPriceDecimals(9);
    expect(getPriceDecimals()).toBe(4);
    setPriceDecimals(0);
    expect(fmtMoney(12.4)).toMatch(/12 ₺/);
  });
});

describe("idOf", () => {
  it("prefers id then _id", () => {
    expect(idOf({ id: "a", _id: "b" })).toBe("a");
    expect(idOf({ _id: "b" })).toBe("b");
    expect(idOf(null)).toBe("");
  });
});
