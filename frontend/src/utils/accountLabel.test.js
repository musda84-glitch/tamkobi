import {
  accountCardLabels,
  accountDisplayLabel,
  accountTypeLabel,
  duplicateRefMessage,
  maskedRef,
} from "./accountLabel";

const IBAN = "TR330006200519786457841234";

test("hesap türleri Türkçe", () => {
  expect(accountTypeLabel("bank")).toBe("Banka hesabı");
  expect(accountTypeLabel("cash_box")).toBe("Kasa");
  expect(accountTypeLabel("cash")).toBe("Kasa");
  expect(accountTypeLabel("pos")).toBe("POS");
  expect(accountTypeLabel("okc_pos")).toBe("ÖKC");
  expect(accountTypeLabel("credit_card")).toBe("Kredi kartı");
});

test("etiket banka adı, hesap adı ve son 4 hane; tam IBAN yok", () => {
  const label = accountDisplayLabel({
    bank_name: "Kuveyt Türk",
    account_name: "Vadesiz TL Hesabı",
    iban: IBAN,
    type: "bank",
    is_integrated: true,
  });
  expect(label).toBe("Kuveyt Türk · Vadesiz TL Hesabı · …1234 · entegre");
  expect(label).not.toContain(IBAN);
  expect(maskedRef(IBAN)).toBe("…1234");
});

test("kart etiketi banka önekini temizler, maske ayrı kalır", () => {
  const labels = accountCardLabels({
    bank_name: "Türkiye İş Bankası",
    account_name: "Türkiye İş Bankası Ticari Vadesiz TL Hesabı",
    masked_ref: "…1326",
    type: "bank",
  });
  expect(labels.bank).toBe("İş Bankası");
  expect(labels.name).toBe("Ticari Vadesiz TL Hesabı");
  expect(labels.ref).toBe("…1326");
  expect(accountDisplayLabel({
    bank_name: "Türkiye İş Bankası",
    account_name: "Türkiye İş Bankası Ticari Vadesiz TL Hesabı",
    masked_ref: "…1326",
    type: "bank",
  })).toBe("Türkiye İş Bankası · Türkiye İş Bankası Ticari Vadesiz TL Hesabı · …1326");
});

test("uyarı metni banka adı ve son 4 hane", () => {
  const msg = duplicateRefMessage("IBAN", [
    { bank_name: "Kuveyt Türk" },
    { bank_name: "Enpara" },
  ], "…1326");
  expect(msg).toBe("Aynı IBAN 2 hesaba bağlı: Kuveyt Türk · …1326, Enpara · …1326.");
  expect(msg).not.toContain("TR");
});
