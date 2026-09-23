import { filterMissingByOrder, missingLinesForOrder } from "./missingOrderLines";

const items = [
  {
    key: "a",
    product_id: "p1",
    product_name: "Masa",
    missing_qty: 3,
    order_ids: ["o1"],
    sources: [{ type: "order_pick", order_id: "o1", order_number: "ORD-1", missing_qty: 2 }],
  },
  {
    key: "b",
    product_id: "p2",
    product_name: "Sandalye",
    missing_qty: 5,
    order_ids: ["o1", "o2"],
    sources: [
      { type: "order_pick", order_id: "o1", order_number: "ORD-1", missing_qty: 1 },
      { type: "order_pick", order_id: "o2", order_number: "ORD-2", missing_qty: 4 },
    ],
  },
  {
    key: "c",
    product_name: "Depo eksik bildirim",
    order_ids: ["o1"],
    sources: [{ order_id: "o1", missing_qty: 9 }],
  },
];

test("missingLinesForOrder returns per-order qty", () => {
  const lines = missingLinesForOrder(items, { order_id: "o1" });
  expect(lines.map((l) => l.product_name)).toEqual(["Masa", "Sandalye"]);
  expect(lines.find((l) => l.product_id === "p1").missing_qty).toBe(2);
  expect(lines.find((l) => l.product_id === "p2").missing_qty).toBe(1);
});

test("filterMissingByOrder hides other orders and depo labels", () => {
  expect(filterMissingByOrder(items, "o2").map((i) => i.key)).toEqual(["b"]);
  expect(filterMissingByOrder(items, "").map((i) => i.key)).toEqual(["a", "b"]);
});
