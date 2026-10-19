import { bankCodeFromIban, bankLogoInfo } from "./bankLogo";

const ISBANK_IBAN = "TR33 0006 4000 0011 2345 6789 01";
const KUVEYT_IBAN = "TR33 0020 5000 0011 2345 6789 01";
const UNKNOWN_IBAN = "TR00 0999 9000 0011 2345 6789 01";

test("boşluklu İş Bankası IBAN'ı 0064 ve kısa ad döner", () => {
  expect(bankCodeFromIban(ISBANK_IBAN)).toBe("0064");
  const info = bankLogoInfo({ iban: ISBANK_IBAN });
  expect(info.short).toBe("İş Bankası");
  expect(info.code).toBe("0064");
  expect(info.src).toBe("/bank-logos/0064.svg");
});

test("Kuveyt Türk IBAN'ındaki 00205 kodu 0205 olur", () => {
  expect(bankCodeFromIban(KUVEYT_IBAN)).toBe("0205");
  expect(bankLogoInfo({ iban: KUVEYT_IBAN }).code).toBe("0205");
  expect(bankLogoInfo({ iban: KUVEYT_IBAN }).short).toBe("Kuveyt Türk");
});

test("bilinmeyen kod ve banka adı yoksa logo bilgisi null", () => {
  expect(bankCodeFromIban(UNKNOWN_IBAN)).toBe("9999");
  expect(bankLogoInfo({ iban: UNKNOWN_IBAN })).toBeNull();
  expect(bankLogoInfo({})).toBeNull();
  expect(bankLogoInfo(null)).toBeNull();
});

test("geçersiz veya kısa IBAN null", () => {
  expect(bankCodeFromIban("")).toBeNull();
  expect(bankCodeFromIban(null)).toBeNull();
  expect(bankCodeFromIban("TR33")).toBeNull();
  expect(bankCodeFromIban("TR33 0006 4")).toBeNull();
  expect(bankCodeFromIban("DE89370400440532013000")).toBeNull();
  expect(bankLogoInfo({ iban: "TR123" })).toBeNull();
});

test("IBAN yokken banka adından kod bulunur; Ziraat Katılım 0010 değildir", () => {
  expect(bankLogoInfo({ bank_name: "Türkiye İş Bankası" }).code).toBe("0064");
  expect(bankLogoInfo({ bank_name: "Kuveyt Türk Katılım" }).code).toBe("0205");
  const katilim = bankLogoInfo({ bank_name: "Ziraat Katılım" });
  expect(katilim.code).toBe("0209");
  expect(katilim.code).not.toBe("0010");
  expect(bankLogoInfo({ bank_name: "Ziraat Bankası" }).code).toBe("0010");
});
