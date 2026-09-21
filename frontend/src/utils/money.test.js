import { clampPriceDecimals, fmtMoney, formatTrAmount, getPriceDecimals, inputStepForPrice, priceInputStep, setPriceDecimals } from "./money";

afterEach(() => {
  setPriceDecimals(2);
});

describe("price decimals", () => {
  it("defaults to kuruş (2) like e-invoice and Paraşüt", () => {
    expect(getPriceDecimals()).toBe(2);
    expect(formatTrAmount(1250.5)).toMatch(/1.?250,50/);
    expect(fmtMoney(10, "USD")).toMatch(/10,00 USD/);
    expect(priceInputStep()).toBe("0.01");
  });

  it("clamps to 0–4 and formats unit prices at 4 digits", () => {
    expect(clampPriceDecimals("9")).toBe(4);
    expect(clampPriceDecimals(-3)).toBe(0);
    expect(clampPriceDecimals("x")).toBe(2);
    expect(setPriceDecimals(4)).toBe(4);
    expect(formatTrAmount(12.5)).toMatch(/12,5000/);
    expect(fmtMoney(null)).toMatch(/0,0000 ₺/);
    expect(priceInputStep()).toBe("0.0001");
    setPriceDecimals(0);
    expect(formatTrAmount(12.9)).toMatch(/13/);
    expect(priceInputStep()).toBe("1");
  });

  it("lets a back-calculated net price through when it is off the company step", () => {
    setPriceDecimals(2);
    expect(inputStepForPrice(260)).toBe("0.01");
    expect(inputStepForPrice(236.36)).toBe("0.01");
    expect(inputStepForPrice(236.3636)).toBe("any");
    setPriceDecimals(0);
    expect(inputStepForPrice(260)).toBe("1");
    expect(inputStepForPrice(236.3636)).toBe("any");
    setPriceDecimals(4);
    expect(inputStepForPrice(236.3636)).toBe("0.0001");
  });
});
