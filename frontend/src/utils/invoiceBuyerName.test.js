import { barcodeSalePayload, invoiceFormPatchForRetail } from "./barcodeSale";
import { invoiceBuyerName, previewBuyerLabel } from "./invoiceBuyerName";

const PERSON = "Cüneyt Atman";
const TITLE = "Yılmaz Desing Alüminyum Cam İnşaat Gıda San. Ve Tic. Ltd.";
const GIB = "Yılmaz Design Alüminyum Ltd. Şti.";

test("ticari ünvan doluysa alıcı ünvanıdır", () => {
  const name = invoiceBuyerName({
    name: PERSON,
    company_title: TITLE,
    tax_number_or_id: "1234567890",
  });
  expect(name).toBe(TITLE);
  expect(name).not.toContain("Cüneyt");
});

test("ünvan boşsa cari adı kalır", () => {
  expect(invoiceBuyerName({ name: PERSON, company_title: "" })).toBe(PERSON);
  expect(invoiceBuyerName({ name: "Test Cari A.Ş.", tax_number_or_id: "1234567890" })).toBe("Test Cari A.Ş.");
});

test("gerçek VKN ve GİB ünvanı, ticari ünvan boşsa GİB ünvanı yazılır", () => {
  expect(invoiceBuyerName(
    { name: PERSON, tax_number_or_id: "1234567890" },
    { gibTitle: GIB },
  )).toBe(GIB);
  expect(invoiceBuyerName({
    name: PERSON,
    tax_number_or_id: "11111111111",
    gib_title: GIB,
  })).toBe(PERSON);
});

test("önizleme kayıtlı cari ünvanını, yoksa faturadaki adı gösterir", () => {
  const contacts = [{ id: "c1", name: PERSON, company_title: TITLE, tax_number_or_id: "1234567890" }];
  expect(previewBuyerLabel({ contact_id: "c1", contact_name: PERSON }, contacts)).toBe(TITLE);
  expect(previewBuyerLabel({ contact_id: "yok", contact_name: PERSON }, contacts)).toBe(PERSON);
  expect(previewBuyerLabel({
    contact_id: "c2",
    contact_name: PERSON,
    contact_tax_id: "1234567890",
    gib_title: GIB,
  }, [{ id: "c2", name: PERSON, tax_number_or_id: "1234567890" }])).toBe(GIB);
});

test("barkod satışı ve perakende form yaması ünvanı kullanır", () => {
  const payload = barcodeSalePayload({
    companyId: "c1",
    contact: { id: "c1", name: PERSON, company_title: TITLE, tax_number_or_id: "1234567890" },
    product: { id: "p1", name: "Kalem", sale_price: 10, vat_rate: 20 },
    quantity: 1,
    mode: "account",
  });
  expect(payload.contact_name).toBe(TITLE);
  const retail = invoiceFormPatchForRetail(
    { id: "r1", name: "Perakende Müşteri", tax_number_or_id: "11111111111", company_title: "" },
    { invoice_type: "sales", e_type: "e_archive" },
  );
  expect(retail.contact_name).toBe("Perakende Müşteri");
});
