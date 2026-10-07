import {
  barcodeSaleLine,
  barcodeSalePayload,
  findRetailContact,
  invoiceFormPatchForRetail,
  pickCashAccount,
  RETAIL_CONTACT_NAME,
  RETAIL_CONTACT_TAX,
  retailContactCreatePayload,
} from "./barcodeSale";

describe("barcodeSale", () => {
  it("builds line from sale price and quantity", () => {
    const line = barcodeSaleLine({ id: "p1", name: "Kalem", sale_price: 100, vat_rate: 20, unit: "Adet" }, 2);
    expect(line.quantity).toBe(2);
    expect(line.unit_price).toBe(100);
    expect(line.product_id).toBe("p1");
  });

  it("builds paid perakende invoice payload", () => {
    const payload = barcodeSalePayload({
      companyId: "c1",
      contact: { id: "r1", name: RETAIL_CONTACT_NAME, tax_number_or_id: RETAIL_CONTACT_TAX },
      product: { id: "p1", name: "Kalem", sale_price: 100, vat_rate: 20 },
      quantity: 1,
      mode: "retail",
    });
    expect(payload.payment_status).toBe("paid");
    expect(payload.source_channel).toBe("barcode_retail");
    expect(payload.e_type).toBe("e_archive");
    expect(payload.paid_amount).toBeGreaterThan(0);
  });

  it("finds retail contact and cash account", () => {
    expect(findRetailContact([{ name: "Perakende Müşteri", tax_number_or_id: RETAIL_CONTACT_TAX }])?.name).toBe(RETAIL_CONTACT_NAME);
    expect(pickCashAccount([{ type: "bank", name: "Banka" }, { type: "cash", name: "Kasa" }])?.name).toBe("Kasa");
    expect(retailContactCreatePayload("c1").tax_number_or_id).toBe(RETAIL_CONTACT_TAX);
    expect(invoiceFormPatchForRetail({ id: "r1", name: RETAIL_CONTACT_NAME }, { invoice_type: "sales", e_type: "e_invoice" }).e_type).toBe("e_archive");
  });
});
