import { amountInWords } from "./amountInWords";

describe("amountInWords", () => {
  test("0", () => {
    expect(amountInWords(0)).toBe("Yalnız: Sıfır Türk Lirası");
    expect(amountInWords(0)).not.toMatch(/Kuruş/);
  });

  test("1", () => {
    expect(amountInWords(1)).toBe("Yalnız: Bir Türk Lirası");
  });

  test("10", () => {
    expect(amountInWords(10)).toBe("Yalnız: On Türk Lirası");
  });

  test("100", () => {
    expect(amountInWords(100)).toBe("Yalnız: Yüz Türk Lirası");
    expect(amountInWords(100)).not.toMatch(/Bir Yüz/);
  });

  test("1000 Bin, bir bin değil", () => {
    expect(amountInWords(1000)).toBe("Yalnız: Bin Türk Lirası");
    expect(amountInWords(1000).toLocaleLowerCase("tr-TR")).not.toContain("bir bin");
  });

  test("1001", () => {
    expect(amountInWords(1001)).toBe("Yalnız: Bin Bir Türk Lirası");
  });

  test("12.345,67", () => {
    expect(amountInWords(12345.67)).toBe(
      "Yalnız: On İki Bin Üç Yüz Kırk Beş Türk Lirası Altmış Yedi Kuruş",
    );
  });

  test("1.000.000", () => {
    expect(amountInWords(1000000)).toBe("Yalnız: Bir Milyon Türk Lirası");
    expect(amountInWords(1000000)).not.toMatch(/Kuruş/);
  });

  test("1.250.000,50", () => {
    expect(amountInWords(1250000.5)).toBe(
      "Yalnız: Bir Milyon İki Yüz Elli Bin Türk Lirası Elli Kuruş",
    );
  });

  test("negatif ve NaN güvenliği", () => {
    expect(amountInWords(-10)).toBe(amountInWords(10));
    expect(amountInWords(-12345.67)).toBe(amountInWords(12345.67));
    expect(amountInWords(NaN)).toBe("Yalnız: Sıfır Türk Lirası");
    expect(amountInWords(undefined)).toBe("Yalnız: Sıfır Türk Lirası");
    expect(amountInWords(null)).toBe("Yalnız: Sıfır Türk Lirası");
    expect(amountInWords("abc")).toBe("Yalnız: Sıfır Türk Lirası");
  });

  test("TRY dışı birim kodu", () => {
    expect(amountInWords(10.5, "usd")).toBe("Yalnız: On USD Elli Cent");
    expect(amountInWords(10.5, "EUR")).toBe("Yalnız: On EUR Elli Cent");
    expect(amountInWords(100, "EUR")).toBe("Yalnız: Yüz EUR");
    expect(amountInWords(10.5, "GBP")).toBe("Yalnız: On GBP 50/100");
    expect(amountInWords(10.05, "CHF")).toBe("Yalnız: On CHF 05/100");
  });
});
