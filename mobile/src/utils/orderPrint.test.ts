import { cargoLabelCode, cargoLabelHtml, cargoLabelText, orderFormHtml, orderFormText } from "./orderPrint";

const order = {
  order_number: "11573451170",
  customer_name: "Hatice YILDIRIM",
  customer_phone: "555",
  shipping_address: "Moda Cad.",
  city: "İstanbul",
  channel: "trendyol",
  cargo_tracking_number: "TR123",
  cargo_barcode: "8690001928371",
  cargo_carrier: "Trendyol Express",
  cargo_label_url: "https://cdn.trendyol.com/label.pdf",
  grand_total: 17550,
  order_date: "2026-09-06",
  items: [{ product_name: "Koltuk", quantity: 1, unit_price: 17550, total_incl: 17550 }],
};

describe("orderPrint", () => {
  it("builds a sipariş formu with totals and customer", () => {
    const html = orderFormHtml(order, { name: "Matek" });
    expect(html).toContain("SİPARİŞ FORMU");
    expect(html).toContain("11573451170");
    expect(html).toContain("Hatice YILDIRIM");
    expect(html).toContain("Koltuk");
    expect(orderFormText(order, { name: "Matek" })).toMatch(/Toplam/);
  });

  it("builds a kargo etiketi with tracking and sender", () => {
    const html = cargoLabelHtml(order, { name: "Matek", address: "Atölye" });
    expect(html).toContain("ALICI");
    expect(html).toContain("8690001928371");
    expect(html).toContain("Matek");
    expect(cargoLabelCode(order)).toBe("8690001928371");
    expect(cargoLabelText(order).includes("8690001928371")).toBe(true);
  });

  it("prefers cargo barcode over tracking for the printed code", () => {
    expect(cargoLabelCode({ cargo_tracking_number: "TR", cargo_barcode: "8691" })).toBe("8691");
    expect(cargoLabelCode({ order_number: "1157" })).toBe("1157");
  });
});
