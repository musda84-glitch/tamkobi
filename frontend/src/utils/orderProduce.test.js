import { buildProduceFromOrderPayload, orderLineCanProduce, producibleLinesForOrder, resolveOrderLineProduct } from "./orderProduce";

describe("orderProduce", () => {
  const catalog = [
    { id: "p1", sku: "DRA-W", name: "Duvar Rafı", type: "product", stock_quantity: 2 },
    { id: "p2", sku: "RAW-1", name: "Levha", type: "raw_material" },
    { id: "p3", sku: "SVC", name: "Montaj", type: "service" },
  ];

  it("resolves by product_id or sku", () => {
    expect(resolveOrderLineProduct({ product_id: "p1" }, catalog)?.sku).toBe("DRA-W");
    expect(resolveOrderLineProduct({ sku: "RAW-1" }, catalog)?.id).toBe("p2");
    expect(resolveOrderLineProduct({ sku: "NOPE" }, catalog)).toBeNull();
  });

  it("allows produce only for non-service non-raw", () => {
    expect(orderLineCanProduce(catalog[0])).toBe(true);
    expect(orderLineCanProduce(catalog[1])).toBe(false);
    expect(orderLineCanProduce(catalog[2])).toBe(false);
  });

  it("builds plan qty and notes from order line", () => {
    const payload = buildProduceFromOrderPayload(
      { order_number: "SIP-9", customer_name: "Ahmet" },
      { quantity: 3 },
      catalog[0],
    );
    expect(payload._planQty).toBe(3);
    expect(payload._planNotes).toContain("SIP-9");
    expect(payload._planNotes).toContain("Ahmet");
    expect(buildProduceFromOrderPayload({}, { quantity: 1 }, catalog[1])).toBeNull();
  });

  it("lists producible lines for order action", () => {
    const lines = producibleLinesForOrder(
      {
        order_number: "S1",
        items: [
          { product_id: "p1", quantity: 2, product_name: "Duvar Rafı" },
          { product_id: "p2", quantity: 1, product_name: "Levha" },
          { product_id: "p3", quantity: 1, product_name: "Montaj" },
        ],
      },
      catalog,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toContain("Duvar Rafı");
    expect(lines[0].product._planQty).toBe(2);
  });
});
