import { bankLinkWarnings } from "./bankLinkWarnings";

const IBAN = "TR330006100519786457841326";
const OTHER = "TR110006200000000000000001";

test("farklı bankada aynı hesap adı uyarı vermez", () => {
  const warnings = bankLinkWarnings(
    [
      { id: "c1", linked_account_id: "a1" },
      { id: "c2", linked_account_id: "a2" },
    ],
    [
      { id: "a1", bank_name: "Kuveyt Türk", account_name: "Vadesiz TL Hesabı", iban: OTHER, type: "bank" },
      { id: "a2", bank_name: "Enpara", account_name: "Vadesiz TL Hesabı", iban: IBAN, type: "bank" },
    ],
  );
  expect(warnings).toEqual([]);
});

test("aynı IBAN birden fazla hesapta uyarı verir; tam IBAN yazılmaz", () => {
  const warnings = bankLinkWarnings(
    [
      { id: "c1", linked_account_id: "a1", bank_account_number: IBAN },
      { id: "c2", linked_account_id: "a2", bank_account_number: `TR33 0006 1005 1978 6457 8413 26` },
    ],
    [
      { id: "a1", bank_name: "Kuveyt Türk", account_name: "Vadesiz TL Hesabı", iban: IBAN, type: "bank" },
      { id: "a2", bank_name: "Enpara", account_name: "Vadesiz TL Hesabı", iban: IBAN, type: "bank" },
    ],
  );
  expect(warnings.map((w) => w.tur)).toEqual(["cift_iban"]);
  expect(warnings[0].mesaj).toContain("Kuveyt Türk");
  expect(warnings[0].mesaj).toContain("Enpara");
  expect(warnings[0].mesaj).toContain("…1326");
  expect(warnings[0].mesaj).not.toContain(IBAN);
  expect(warnings.some((w) => w.tur === "cift_hesap_adi")).toBe(false);
});

test("aynı hesaba iki bağlantı isim veya IBAN uyarısı açmaz", () => {
  const warnings = bankLinkWarnings(
    [
      { id: "c1", linked_account_id: "a1", bank_account_number: IBAN },
      { id: "c2", linked_account_id: "a1", bank_account_number: IBAN },
    ],
    [{ id: "a1", bank_name: "Enpara", account_name: "Vadesiz TL Hesabı", iban: IBAN }],
  );
  expect(warnings).toEqual([]);
});
