import { fmtMoney, formatMoneyInput, getPriceDecimals, idOf, parseMoneyInput, sanitizeMoneyInput, setPriceDecimals } from "./money";

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

describe("money input draft", () => {
  it("keeps in-progress decimals and parses comma or dot", () => {
    expect(sanitizeMoneyInput("2.")).toBe("2.");
    expect(sanitizeMoneyInput("2,")).toBe("2,");
    expect(sanitizeMoneyInput("2.10")).toBe("2.10");
    expect(sanitizeMoneyInput("12a.3b0")).toBe("12.30");
    expect(parseMoneyInput("2.")).toBe(2);
    expect(parseMoneyInput("2,10")).toBe(2.1);
    expect(parseMoneyInput("2.10")).toBe(2.1);
    expect(parseMoneyInput("")).toBe(0);
    expect(formatMoneyInput(2.1)).toBe("2.10");
    expect(formatMoneyInput(5.05)).toBe("5.05");
  });
});

describe("idOf", () => {
  it("prefers id then _id", () => {
    expect(idOf({ id: "a", _id: "b" })).toBe("a");
    expect(idOf({ _id: "b" })).toBe("b");
    expect(idOf(null)).toBe("");
  });
});
