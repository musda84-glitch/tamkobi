import {
  calcCommission,
  formatSummary,
  grossFromRate,
  validatePosSettlement,
} from "./posSettlement";

test("komisyon brüt ile netin farkıdır", () => {
  expect(calcCommission(49000, 47168.38)).toBe(1831.62);
  expect(calcCommission(100, 90)).toBe(10);
});

test("oran önerisi brütü net / (1 - oran) yapar", () => {
  expect(grossFromRate(47168.38, 0.03738)).toBe(49000);
  expect(grossFromRate(100, 0.1)).toBe(111.11);
  expect(grossFromRate(80, 0)).toBe(80);
});

test("doğrulama bakiye, negatif komisyon ve brüt < net hatalarını yazar", () => {
  expect(validatePosSettlement({
    gross: 50000,
    net: 47168.38,
    commission: 2831.62,
    posBalance: 49000,
    isInflow: true,
  })).toContain("Brüt tutar POS bakiyesini aşıyor.");
  expect(validatePosSettlement({
    gross: 100,
    net: 90,
    commission: -1,
    posBalance: 200,
    isInflow: true,
  })).toContain("Komisyon negatif olamaz.");
  expect(validatePosSettlement({
    gross: 50,
    net: 90,
    commission: 0,
    posBalance: 200,
    isInflow: true,
  })).toContain("Brüt tutar bankaya gelen tutardan küçük olamaz.");
  expect(validatePosSettlement({
    gross: 49000,
    net: 47168.38,
    commission: 1831.62,
    posBalance: 49000,
    isInflow: true,
  })).toEqual([]);
});

test("özet kutusu POS, banka ve masraf komisyonunu yazar", () => {
  const text = formatSummary({ posName: "Sanal POS", gross: 49000, net: 47168.38 });
  expect(text).toContain("Sanal POS");
  expect(text).toContain("Banka");
  expect(text).toContain("Masraf komisyon");
});
