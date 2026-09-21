import {
  balanceSentence,
  isOrderQuotePrint,
  lineTotalIncl,
  printDiscountLabel,
  printNetAmount,
  printQtyLabel,
  printShelfLabel,
  printVatLines,
  vatRateLabel,
} from "./printFormLayout";

describe("printFormLayout", () => {
  it("uses the compact print form for order and quote only", () => {
    expect(isOrderQuotePrint("order")).toBe(true);
    expect(isOrderQuotePrint("quote")).toBe(true);
    expect(isOrderQuotePrint("invoice")).toBe(false);
    expect(isOrderQuotePrint("dispatch")).toBe(false);
  });

  it("prints quantity with a short unit", () => {
    expect(printQtyLabel(1, "Adet")).toBe("1 ad");
    expect(printQtyLabel(2, "")).toBe("2 ad");
    expect(printQtyLabel(3, "kg")).toBe("3 kg");
  });

  it("groups VAT by rate and prefers the document vat total", () => {
    const items = [
      { vat_rate: 10, total: 290.91, total_incl: 320 },
      { vat_rate: 10, total: 290.91, total_incl: 320 },
    ];
    expect(printVatLines({ vat_total: 58.18 }, items)).toEqual([{ rate: 10, amount: 58.18 }]);
    expect(vatRateLabel(10)).toBe("KDV (%10)");
    expect(printNetAmount({ subtotal: 581.82 }, items)).toBe(581.82);
  });

  it("keeps mixed VAT rates on separate lines", () => {
    const lines = printVatLines({}, [
      { vat_rate: 10, total: 100, vat_amount: 10 },
      { vat_rate: 20, total: 100, vat_amount: 20 },
    ]);
    expect(lines).toEqual([{ rate: 10, amount: 10 }, { rate: 20, amount: 20 }]);
  });

  it("includes VAT in line totals and reads only a real shelf", () => {
    expect(lineTotalIncl({ total: 100, vat_rate: 20 })).toBe(120);
    expect(lineTotalIncl({ total: 100, total_incl: 110, vat_rate: 20 })).toBe(110);
    expect(printDiscountLabel(0)).toBe("0");
    expect(printDiscountLabel(12.5)).toBe("12,5");
    expect(printShelfLabel({ name: "Ürün" }, { barcode: "868" })).toBe("");
    expect(printShelfLabel({}, { raf_yeri: "A-12" })).toBe("A-12");
  });

  it("writes the balance sentence with TL, not the lira sign", () => {
    expect(balanceSentence(1240)).toBe("Güncel bakiyeniz: 1.240,00 TL");
    expect(balanceSentence(null)).toBe("");
  });
});
