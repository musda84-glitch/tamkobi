import { applyB2BScan, findCatalogByScan, normalizeScanText, parseDraftQty, qtyDraftOnBlur, qtyDraftOnFocus, qtyDraftShown } from "./b2bSearch";

describe("qty draft focus", () => {
  test("clears on focus and restores 1 on empty blur", () => {
    expect(qtyDraftShown({}, "p1")).toBe("1");
    expect(qtyDraftShown({ p1: "" }, "p1")).toBe("");
    expect(qtyDraftShown({ p1: "12" }, "p1")).toBe("12");
    expect(qtyDraftOnFocus()).toBe("");
    expect(qtyDraftOnBlur("")).toBe("1");
    expect(qtyDraftOnBlur("8")).toBe("8");
  });
});

describe("applyB2BScan", () => {
  const rows = [
    { id: "1", name: "Kiler Rafı", sku: "KLM", barcode: "869", in_stock: true },
    { id: "2", name: "Masa", sku: "MS-1", barcode: "111", in_stock: true },
  ];

  test("strips GS1 and matches barcode", () => {
    expect(normalizeScanText("]C1869")).toBe("869");
    expect(parseDraftQty("4")).toBe(4);
    expect(findCatalogByScan(rows, "]C1869")?.id).toBe("1");
  });

  test("adds the scan multiplier", () => {
    const hit = applyB2BScan({ products: rows, code: "111", qty: "4", allowOrders: true });
    expect(hit).toMatchObject({ action: "add", qty: 4, message: "Masa sepete eklendi (4)" });
    expect(hit.product.id).toBe("2");
  });

  test("misses unknown codes and filters when orders are closed", () => {
    expect(applyB2BScan({ products: rows, code: "000", allowOrders: true }).action).toBe("miss");
    expect(applyB2BScan({ products: rows, code: "869", allowOrders: false }).action).toBe("filter");
  });
});
