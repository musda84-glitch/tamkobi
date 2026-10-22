import { fitChipCount, roleSummary, summaryChipText, summaryChips } from "./roleEditorModel";

test("şerit etiketleri özet cümlelerinden kısaltılır", () => {
  const { can, cannot } = roleSummary(
    { "/invoices": "edit", "/banking": "view", "/cheques": "view", "/stock": "view", "/settings": "none" },
    { view_prices: true },
  );
  expect(can).toContain("Fatura kesebilir, e-Fatura gönderebilir");
  expect(summaryChipText("Fatura kesebilir, e-Fatura gönderebilir")).toBe("Fatura keser");
  expect(summaryChipText("Faturaları görür; yeni fatura kesemez")).toBe("Faturaları görür");
  expect(summaryChipText("Kayıt silemez")).toBe("Silemez");
  expect(summaryChipText("Fiyatları görür (gizlemek için Gelişmiş)")).toBe("Fiyat gizli değil");
  expect(summaryChipText("Banka, çek, stok görür")).toBe("Banka·çek·stok görür");
  expect(summaryChipText("Üretim, personel, ayarlar kapalı")).toBe("Üretim·personel·ayarlar kapalı");

  const chips = summaryChips(
    { "/invoices": "view", "/contacts": "edit", "/orders": "edit", "/quotes": "edit" },
    { view_prices: false },
  );
  expect(chips.chips.map((chip) => `${chip.tone}:${chip.label}`)).toEqual(
    chips.can.map((line) => `can:${summaryChipText(line)}`).concat(
      chips.cannot.map((line) => `cannot:${summaryChipText(line)}`),
    ),
  );
  expect(chips.chips.some((chip) => chip.label === "Fiyat gizli" && chip.tone === "cannot")).toBe(true);
});

test("sığmayan etiketler +N için yer bırakır", () => {
  expect(fitChipCount([], 200)).toBe(0);
  expect(fitChipCount([80, 80, 80], 0)).toBe(3);
  expect(fitChipCount([80, 80, 80, 80], 80 + 6 + 80 + 6 + 40, 40)).toBe(2);
  expect(fitChipCount([40, 40], 40 + 6 + 40, 40)).toBe(2);
  expect(fitChipCount([200], 50, 40)).toBe(0);
});
