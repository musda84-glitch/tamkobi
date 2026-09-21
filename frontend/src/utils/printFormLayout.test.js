import { balanceSentence, isOrderQuotePrint, printNetAmount, printQtyLabel, printVatLines, vatRateLabel } from "./printFormLayout";

test("order and quote use the compact print form", () => {
  expect(isOrderQuotePrint("order")).toBe(true);
  expect(isOrderQuotePrint("quote")).toBe(true);
  expect(isOrderQuotePrint("invoice")).toBe(false);
  expect(isOrderQuotePrint("dispatch")).toBe(false);
});

test("quantity prints with a short unit", () => {
  expect(printQtyLabel(1, "Adet")).toBe("1 ad");
  expect(printQtyLabel(2, "")).toBe("2 ad");
  expect(printQtyLabel(3, "kg")).toBe("3 kg");
});

test("vat footer groups by rate and prefers the document vat total", () => {
  const items = [
    { vat_rate: 10, total: 290.91, total_incl: 320 },
    { vat_rate: 10, total: 290.91, total_incl: 320 },
  ];
  expect(printVatLines({ vat_total: 58.18 }, items)).toEqual([{ rate: 10, amount: 58.18 }]);
  expect(vatRateLabel(10)).toBe("KDV (%10)");
  expect(printNetAmount({ subtotal: 581.82 }, items)).toBe(581.82);
});

test("mixed vat rates stay on separate lines", () => {
  const lines = printVatLines({}, [
    { vat_rate: 10, total: 100, vat_amount: 10 },
    { vat_rate: 20, total: 100, vat_amount: 20 },
  ]);
  expect(lines).toEqual([{ rate: 10, amount: 10 }, { rate: 20, amount: 20 }]);
});

test("balance sentence uses TL not the lira sign", () => {
  expect(balanceSentence(1240)).toBe("Güncel bakiyeniz: 1.240,00 TL");
  expect(balanceSentence(null)).toBe("");
});
