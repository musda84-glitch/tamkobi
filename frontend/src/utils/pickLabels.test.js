import { expandPickLabelJobs, labelCopyCount } from "./pickLabels";

test("prints one label per ordered unit", () => {
  expect(labelCopyCount({ ordered_qty: 3 })).toBe(3);
  expect(labelCopyCount({ ordered_qty: 0 })).toBe(1);
  expect(expandPickLabelJobs([
    { product_name: "Vida", sku: "V-1", barcode: "8690001", ordered_qty: 2 },
    { product_name: "Somun", sku: "S-1", ordered_qty: 1 },
  ])).toEqual([
    { name: "Vida", sku: "V-1", code: "8690001" },
    { name: "Vida", sku: "V-1", code: "8690001" },
    { name: "Somun", sku: "S-1", code: "S-1" },
  ]);
});
