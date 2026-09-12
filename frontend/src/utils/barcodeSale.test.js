import { barcodeSaleLine, barcodeSalePayload, findRetailContact, pickCashAccount, RETAIL_CONTACT_NAME } from "./barcodeSale";

test("barcodeSaleLine uses sale price and quantity", () => {
  const line = barcodeSaleLine({ id: "p1", name: "Kalem", sale_price: 100, vat_rate: 20, unit: "Adet" }, 2);
  expect(line.quantity).toBe(2);
  expect(line.unit_price).toBe(100);
  expect(line.total).toBe(200);
  expect(line.total_incl).toBe(240);
});

test("barcodeSalePayload perakende is paid sales invoice", () => {
  const payload = barcodeSalePayload({
    companyId: "c1",
    contact: { id: "r1", name: RETAIL_CONTACT_NAME, tax_number_or_id: "11111111111" },
    product: { id: "p1", name: "Kalem", sale_price: 50, vat_rate: 20 },
    quantity: 1,
    mode: "retail",
  });
  expect(payload.invoice_type).toBe("sales");
  expect(payload.status).toBe("approved");
  expect(payload.payment_status).toBe("paid");
  expect(payload.contact_id).toBe("r1");
  expect(payload.items).toHaveLength(1);
});

test("findRetailContact and pickCashAccount helpers", () => {
  expect(findRetailContact([{ id: "1", name: "Perakende Müşteri", tax_number_or_id: "11111111111" }])?.id).toBe("1");
  expect(pickCashAccount([{ id: "b", type: "bank" }, { id: "k", type: "cash_box", account_name: "Ana Kasa" }])?.id).toBe("k");
});
