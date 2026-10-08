import { hydratePrintItemImages, mergeInvoiceItemsIntoOrder } from "./printOrderDoc";

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

  it("keeps order image when matched by product_id even if index shifted", () => {
    const order = {
      items: [
        { name: "A", product_id: "p1", image_url: "/a.webp" },
        { name: "B", product_id: "p2", thumbnail_url: "/b.webp" },
      ],
    };
    const invoice = {
      items: [
        { name: "B Yeni", product_id: "p2", quantity: 1 },
        { name: "A Yeni", product_id: "p1", quantity: 1 },
      ],
    };
    const doc = mergeInvoiceItemsIntoOrder(order, invoice);
    expect(doc.items[0].thumbnail_url).toBe("/b.webp");
    expect(doc.items[1].image_url).toBe("/a.webp");
  });

  it("returns order copy when invoice has no items", () => {
    const order = { id: "o1", items: [{ name: "A" }] };
    expect(mergeInvoiceItemsIntoOrder(order, null).items[0].name).toBe("A");
    expect(mergeInvoiceItemsIntoOrder(order, { items: [] }).items[0].name).toBe("A");
  });
});

describe("hydratePrintItemImages", () => {
  it("stamps thumbnail from product by id and name", () => {
    const items = [
      { name: "Kitap", product_id: "p1" },
      { name: "Namaz Kıble", product_id: "" },
    ];
    const products = [
      { id: "p1", thumbnail_url: "/t1.webp", image_url: "/f1.webp" },
      { name: "Namaz Kıble", image_url: "/n.webp" },
    ];
    const out = hydratePrintItemImages(items, products);
    expect(out[0].thumbnail_url).toBe("/t1.webp");
    expect(out[0].image_url).toBe("/f1.webp");
    expect(out[1].image_url).toBe("/n.webp");
  });
});
