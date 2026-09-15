import { describe, expect, test } from "@jest/globals";
import { packageDefaultsFromOrder, mergeItemPackageFromProduct } from "./ShipmentPackageFields";

describe("packageDefaultsFromOrder", () => {
  test("pulls desi/weight/dims from stock cards when order lines lack them", () => {
    const order = {
      items: [
        { product_id: "p1", quantity: 2 },
        { product_id: "p2", quantity: 1, desi: 0.5 },
      ],
    };
    const products = {
      p1: { desi: 1.2, weight: 0.4, length: 30, width: 20, height: 10, package_count: 1 },
      p2: { desi: 0.5, weight: 0.2 },
    };
    const form = packageDefaultsFromOrder(order, products);
    expect(Number(form.desi)).toBeCloseTo(1.2 * 2 + 0.5, 5);
    expect(Number(form.weight)).toBeCloseTo(0.4 * 2 + 0.2, 5);
    expect(form.length).toBe(""); // mixed dims → leave empty
  });

  test("uses shared dims when all lines match", () => {
    const order = { items: [{ product_id: "p1", quantity: 1 }] };
    const products = { p1: { desi: 2, length: 40, width: 30, height: 20, package_count: 2 } };
    const form = packageDefaultsFromOrder(order, products);
    expect(form.length).toBe("40");
    expect(form.width).toBe("30");
    expect(form.height).toBe("20");
    expect(form.package_count).toBe(2);
  });

  test("mergeItemPackageFromProduct does not overwrite existing line values", () => {
    const merged = mergeItemPackageFromProduct({ desi: 9, quantity: 1 }, { desi: 1, weight: 2 });
    expect(merged.desi).toBe(9);
    expect(merged.weight).toBe(2);
  });
});
