import { mergeInvoiceItemsIntoOrder } from "./printOrderDoc";

describe("mergeInvoiceItemsIntoOrder", () => {
  it("prefers invoice line names and product ids for print", () => {
    const order = {
      id: "o1",
      order_number: "B2B-1",
      shipping_address: "Adres 1",
      items: [
        { name: "Eski Ad", product_id: "", sku: "S1", quantity: 1 },
      ],
    };
    const invoice = {
      items: [
        { name: "Yeni Ürün Adı", product_id: "p9", sku: "S1", quantity: 2, unit_price: 10 },
      ],
      shipping_address: "Fatura Adres",
    };
    const doc = mergeInvoiceItemsIntoOrder(order, invoice);
    expect(doc.items[0].name).toBe("Yeni Ürün Adı");
    expect(doc.items[0].product_id).toBe("p9");
    expect(doc.items[0].quantity).toBe(2);
    expect(doc.shipping_address).toBe("Adres 1");
    expect(doc.order_number).toBe("B2B-1");
  });

  it("returns order copy when invoice has no items", () => {
    const order = { id: "o1", items: [{ name: "A" }] };
    expect(mergeInvoiceItemsIntoOrder(order, null).items[0].name).toBe("A");
    expect(mergeInvoiceItemsIntoOrder(order, { items: [] }).items[0].name).toBe("A");
  });
});
